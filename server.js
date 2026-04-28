const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

const app = express();
const HTTP_PORT = process.env.PORT || 3000;
const CANONICAL_HOST = 'api.sgummallaworks.com';
const CONFIG_PATH = path.join(__dirname, 'config', 'orgs.json');

// ── Org config (loaded from file, kept in memory) ────────────────────────────
let orgConfig = { allowedOrgIds: [] };
try {
  orgConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  // file missing on first run — use default
}

function saveOrgConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(orgConfig, null, 2));
}

// ── Request logger ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - content-type: ${req.headers['content-type'] ?? 'none'}`);
  next();
});

// ── Canonical host redirect ───────────────────────────────────────────────────
app.use((req, res, next) => {
  const host = (req.headers['host'] || '').split(':')[0];
  if (host && host !== CANONICAL_HOST) {
    return res.redirect(301, `https://${CANONICAL_HOST}${req.url}`);
  }
  next();
});

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

// ── Existing routes ───────────────────────────────────────────────────────────

app.get('/custom/hello-world', (req, res) => {
  const auth  = req.headers['authorization'] ?? '';
  const token = req.headers['x-api-token'] ?? (auth.startsWith('Bearer ') ? auth.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'Missing token' });
  if (!process.env.SYMMETRIC_KEY) return res.status(500).json({ error: 'Server misconfigured: SYMMETRIC_KEY not set' });
  try {
    res.json(decrypt(token));
  } catch {
    res.status(401).json({ error: 'Invalid or tampered token' });
  }
});

app.get('/api-docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'swagger.html'));
});

app.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'openapi.json'));
});

// ── Org config endpoints ──────────────────────────────────────────────────────

app.get('/config/orgs', (req, res) => {
  res.json(orgConfig);
});

app.post('/config/orgs', express.json(), (req, res) => {
  const { orgId } = req.body ?? {};
  if (!orgId) return res.status(400).json({ error: 'orgId is required' });
  if (orgConfig.allowedOrgIds.includes(orgId)) {
    return res.status(409).json({ error: 'orgId already exists' });
  }
  orgConfig.allowedOrgIds.push(orgId);
  saveOrgConfig();
  res.status(201).json({ message: 'orgId added', orgId });
});

app.delete('/config/orgs/:orgId', (req, res) => {
  const { orgId } = req.params;
  const index = orgConfig.allowedOrgIds.indexOf(orgId);
  if (index === -1) return res.status(404).json({ error: 'orgId not found' });
  orgConfig.allowedOrgIds.splice(index, 1);
  saveOrgConfig();
  res.json({ message: 'orgId removed', orgId });
});

// ── Salesforce Outbound Message ───────────────────────────────────────────────

const SF_OBJECT_NAME = 'MyObjectTwo__c';

const sfRecords = {};
const processedNotifIds = new Set();

const xmlParser = new xml2js.Parser({
  explicitArray: false,
  tagNameProcessors: [xml2js.processors.stripPrefix],
});

const ACK_TRUE = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:out="http://soap.sforce.com/2005/09/outbound">
  <soapenv:Header/>
  <soapenv:Body>
    <out:notificationsResponse>
      <out:Ack>true</out:Ack>
    </out:notificationsResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

const ACK_FALSE = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:out="http://soap.sforce.com/2005/09/outbound">
  <soapenv:Header/>
  <soapenv:Body>
    <out:notificationsResponse>
      <out:Ack>false</out:Ack>
    </out:notificationsResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

app.post(
  '/cdc/streams',
  express.text({ type: ['text/xml', 'application/xml'] }),
  async (req, res) => {
    res.set('Content-Type', 'text/xml');
    try {
      console.log('SF outbound message body:', req.body);
      const parsed = await xmlParser.parseStringPromise(req.body);
      const notifs = parsed.Envelope.Body.notifications;

      const { allowedOrgIds } = orgConfig;
      if (allowedOrgIds.length > 0 && !allowedOrgIds.includes(notifs.OrganizationId)) {
        console.error(`Rejected outbound message from org: ${notifs.OrganizationId}`);
        return res.send(ACK_FALSE);
      }

      const list = Array.isArray(notifs.Notification) ? notifs.Notification : [notifs.Notification];

      for (const notif of list) {
        const notifId = notif.Id;
        if (processedNotifIds.has(notifId)) continue;

        const obj = notif.sObject;
        sfRecords[notifId] = {
          objectName: SF_OBJECT_NAME,
          id:         obj.Id          ?? null,
          name:       obj.Name        ?? null,
          status:     obj.Status__c   ?? null,
          userCode:   obj.UserCode__c ?? null,
          receivedAt: new Date().toISOString(),
        };
        processedNotifIds.add(notifId);
        console.log(`SF notification ${notifId} stored:`, sfRecords[notifId]);
      }

      res.send(ACK_TRUE);
    } catch (err) {
      console.error('Outbound message error:', err.message);
      res.send(ACK_FALSE);
    }
  }
);

// ── Default — serve index.html ────────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${HTTP_PORT}`);
});
