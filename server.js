const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = process.env.PORT || 3000;

// ── Symmetric decrypt (AES-256-GCM) ─────────────────────────────────────────
// Token format: base64( iv[12] + authTag[16] + ciphertext )

function decrypt(token) {
  const buf = Buffer.from(token, 'base64');
  const iv         = buf.subarray(0, 12);
  const authTag    = buf.subarray(12, 28);
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

// ── HTTP server ──────────────────────────────────────────────────────────────

const indexHtml   = path.join(__dirname, 'public', 'index.html');
const swaggerHtml = path.join(__dirname, 'public', 'swagger.html');
const openapiJson = path.join(__dirname, 'public', 'openapi.json');

const httpServer = http.createServer((req, res) => {
  // GET /custom/hello-world — token from X-API-Token or Authorization: Bearer
  if (req.method === 'GET' && req.url === '/custom/hello-world') {
    const auth = req.headers['authorization'] ?? '';
    const token = req.headers['x-api-token'] ?? (auth.startsWith('Bearer ') ? auth.slice(7) : null);
    return handleDecrypt(token, res);
  }

  // GET /api-docs  —  Swagger UI
  if (req.method === 'GET' && req.url === '/api-docs') {
    fs.readFile(swaggerHtml, (err, data) => {
      if (err) { res.writeHead(500); res.end('Server error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // GET /openapi.json  —  OpenAPI spec
  if (req.method === 'GET' && req.url === '/openapi.json') {
    fs.readFile(openapiJson, (err, data) => {
      if (err) { res.writeHead(500); res.end('Server error'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  fs.readFile(indexHtml, (err, data) => {
    if (err) { res.writeHead(500); res.end('Server error'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${HTTP_PORT}`);
});
