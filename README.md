# api.sgummalla.net

| Endpoint | Auth | Description |
|----------|------|-------------|
| `https://api.sgummalla.net/custom/hello-world` | `X-API-Token` or `Authorization: Bearer` | Decrypts token, returns payload |

---

## `GET /custom/hello-world`

Accepts an AES-256-GCM encrypted token from either header — whichever is present:

- `X-API-Token: <token>`
- `Authorization: Bearer <token>`

Decrypts using `SYMMETRIC_KEY` and returns the JSON payload. Invalid or tampered tokens return `401`.

### Token format

```
base64( iv[12 bytes] + authTag[16 bytes] + ciphertext )
```

### Generating a token

**Mac / Linux:**
```bash
export SYMMETRIC_KEY="<your-key-hex>"

node -e "
const c = require('crypto');
const key = Buffer.from(process.env.SYMMETRIC_KEY, 'hex');
const iv = c.randomBytes(12);
const cipher = c.createCipheriv('aes-256-gcm', key, iv);
const payload = JSON.stringify({ sub: 'alice', role: 'admin' });
const ct = Buffer.concat([cipher.update(payload), cipher.final()]);
const tag = cipher.getAuthTag();
console.log(Buffer.concat([iv, tag, ct]).toString('base64'));
"
```

**Windows (PowerShell):**
```powershell
$env:SYMMETRIC_KEY = "<your-key-hex>"

node -e "
const c = require('crypto');
const key = Buffer.from(process.env.SYMMETRIC_KEY, 'hex');
const iv = c.randomBytes(12);
const cipher = c.createCipheriv('aes-256-gcm', key, iv);
const payload = JSON.stringify({ sub: 'alice', role: 'admin' });
const ct = Buffer.concat([cipher.update(payload), cipher.final()]);
const tag = cipher.getAuthTag();
console.log(Buffer.concat([iv, tag, ct]).toString('base64'));
"
```

### Testing

**Mac / Linux:**
```bash
# Via X-API-Token
curl -s -H "X-API-Token: <token>" https://api.sgummalla.net/custom/hello-world

# Via Authorization Bearer
curl -s -H "Authorization: Bearer <token>" https://api.sgummalla.net/custom/hello-world
```

**Windows (PowerShell):**
```powershell
# Via X-API-Token
Invoke-RestMethod -Uri https://api.sgummalla.net/custom/hello-world `
  -Headers @{ "X-API-Token" = "<token>" }

# Via Authorization Bearer
Invoke-RestMethod -Uri https://api.sgummalla.net/custom/hello-world `
  -Headers @{ Authorization = "Bearer <token>" }
```

### Expected response

```json
{
  "sub": "alice",
  "role": "admin"
}
```

### Rotating the symmetric key

**Mac / Linux:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
flyctl secrets set SYMMETRIC_KEY="<new-key>" -a api-sgummalla-net
```

**Windows (PowerShell):**
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
flyctl secrets set SYMMETRIC_KEY="<new-key>" -a api-sgummalla-net
```

---

## Deploy

**Mac / Linux:**
```bash
flyctl deploy --local-only
```

**Windows (PowerShell):**
```powershell
flyctl deploy --local-only
```

## Secrets

| Secret | Description |
|--------|-------------|
| `SYMMETRIC_KEY` | 32-byte AES-256 key as hex — used by `/custom/hello-world` |
