const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = process.env.PORT || 3000;
const MTLS_PORT = process.env.MTLS_PORT || 8443;

// ── Symmetric decrypt (AES-256-GCM) ─────────────────────────────────────────
// Token format: base64( iv[12] + authTag[16] + ciphertext )

function decrypt(token) {
  const buf = Buffer.from(token, 'base64');
  const iv       = buf.subarray(0, 12);
  const authTag  = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const key = Buffer.from(process.env.SYMMETRIC_KEY, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

function handleDecrypt(token, res) {
  if (!token) return sendJson(res, 401, { error: 'Missing token' });
  if (!process.env.SYMMETRIC_KEY) return sendJson(res, 500, { error: 'Server misconfigured: SYMMETRIC_KEY not set' });
  try {
    sendJson(res, 200, decrypt(token));
  } catch {
    sendJson(res, 401, { error: 'Invalid or tampered token' });
  }
}

// ── Public HTTP server ───────────────────────────────────────────────────────

const indexHtml = path.join(__dirname, 'public', 'index.html');

const httpServer = http.createServer((req, res) => {
  // GET /token  —  token in X-API-Token header
  if (req.method === 'GET' && req.url === '/token') {
    return handleDecrypt(req.headers['x-api-token'], res);
  }

  // GET /auth  —  token in Authorization: Bearer <token>
  if (req.method === 'GET' && req.url === '/auth') {
    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    return handleDecrypt(token, res);
  }

  fs.readFile(indexHtml, (err, data) => {
    if (err) { res.writeHead(500); res.end('Server error'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`HTTP server listening on port ${HTTP_PORT}`);
});

// ── mTLS HTTPS server ────────────────────────────────────────────────────────

const CA_CERT     = process.env.TLS_CA_CERT;
const SERVER_CERT = process.env.TLS_SERVER_CERT;
const SERVER_KEY  = process.env.TLS_SERVER_KEY;

if (!CA_CERT || !SERVER_CERT || !SERVER_KEY) {
  console.warn('TLS_CA_CERT / TLS_SERVER_CERT / TLS_SERVER_KEY not set — mTLS server disabled');
} else {
  const tlsOptions = {
    ca: CA_CERT,
    cert: SERVER_CERT,
    key: SERVER_KEY,
    requestCert: true,
    rejectUnauthorized: true,
  };

  const mtlsServer = https.createServer(tlsOptions, (req, res) => {
    const cert = req.socket.getPeerCertificate(true);

    if (!cert || !cert.subject) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Client certificate required' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      subject:        cert.subject,
      issuer:         cert.issuer,
      valid_from:     cert.valid_from,
      valid_to:       cert.valid_to,
      serial_number:  cert.serialNumber,
      fingerprint:    cert.fingerprint,
      fingerprint256: cert.fingerprint256,
    }, null, 2));
  });

  mtlsServer.listen(MTLS_PORT, '0.0.0.0', () => {
    console.log(`mTLS server listening on port ${MTLS_PORT}`);
  });
}
