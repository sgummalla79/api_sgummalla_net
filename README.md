# api.sgummalla.net

| Endpoint | Auth | Description |
|----------|------|-------------|
| `https://api.sgummalla.net/custom/hello-world` | `X-API-Token` or `Authorization: Bearer` | Decrypts token, returns payload |
| `https://api.sgummalla.net:8443` | mTLS client certificate | Returns client cert details |

---

## `GET /custom/hello-world`

Accepts the encrypted token from either header — whichever is present:

- `X-API-Token: <token>`
- `Authorization: Bearer <token>`

Uses **AES-256-GCM** symmetric decryption with `SYMMETRIC_KEY` and returns the decrypted JSON payload.

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

## TLS architecture — how the certs relate

It is important to understand that there are **three separate certs** in this system, each serving a different purpose.

### Port 443 — public HTTPS (Fly.io managed)

```
Browser / API client → api.sgummalla.net:443
                            ↓
                    Fly.io edge terminates TLS
                    using its own Let's Encrypt cert
                            ↓
                    Forwards plain HTTP to Node.js :3000
```

- Cert is **owned and managed by Fly.io** — you never see the private key
- Handles all normal HTTPS traffic (`/custom/hello-world`, public site)

---

### Port 8443 — mTLS (Node.js managed)

```
Salesforce → api.sgummalla.net:8443
                  ↓
          Fly.io does TCP passthrough — TLS is NOT terminated at the edge
                  ↓
          Node.js terminates TLS itself using TLS_SERVER_CERT + TLS_SERVER_KEY
                  ↓
          Node.js asks Salesforce: "show me your client cert"
                  ↓
          Node.js validates client cert against TLS_CA_CERT (your private CA)
                  ↓
          Signed by your CA? → 200   |   Not signed? → 401
```

The three secrets and what they do:

| Secret | Signed by | Purpose |
|--------|-----------|---------|
| `TLS_SERVER_CERT` | **Let's Encrypt** (public CA) | Proves the server's identity to Salesforce. Salesforce trusts this because Let's Encrypt is a public CA. Your private CA has nothing to do with this. |
| `TLS_SERVER_KEY` | — | Private key paired with `TLS_SERVER_CERT` |
| `TLS_CA_CERT` | Self-signed (it IS the CA) | Used only to validate the **client cert** that Salesforce presents. Salesforce's client cert must have been signed by this CA or the connection is rejected. |

**Key point:** `TLS_SERVER_CERT` is **not** signed by your private CA. It is a completely independent Let's Encrypt cert. Your private CA is only used to validate what the client (Salesforce) presents — not the server.

### Salesforce client cert flow

```
1. You extract CSR from Salesforce's JKS
2. You sign the CSR with certs/ca.key  →  produces salesforce.crt
3. Salesforce loads the signed cert back into their JKS
4. When Salesforce calls :8443, it presents this cert
5. Node.js checks: was this cert signed by TLS_CA_CERT?  →  Yes  →  200
```

---

## mTLS endpoint

The endpoint on port `8443` requires a valid client certificate signed by the private CA.
It returns a JSON object with the presenting certificate's details.

**Mac / Linux:**
```bash
curl --cert client.crt --key client.key --cacert certs/ca.crt \
  https://api.sgummalla.net:8443
```

**Windows (PowerShell):**
```powershell
curl --cert client.crt --key client.key --cacert certs/ca.crt `
  https://api.sgummalla.net:8443
```

---

## Issuing a client certificate

The CA key lives in `certs/ca.key`. It is encrypted in the repo via git-crypt — unlock the repo before using it.

### 1. Generate a client key and CSR

Replace `alice` with the identity name for this client.

**Mac / Linux:**
```bash
openssl genrsa -out alice.key 2048

openssl req -new -key alice.key -out alice.csr \
  -subj "/CN=alice/O=sgummalla/C=US"
```

**Windows (PowerShell):**
```powershell
openssl genrsa -out alice.key 2048

openssl req -new -key alice.key -out alice.csr `
  -subj "/CN=alice/O=sgummalla/C=US"
```

### 2. Sign the CSR with the CA

**Mac / Linux:**
```bash
openssl x509 -req -days 365 -in alice.csr \
  -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial \
  -out alice.crt
```

**Windows (PowerShell):**
```powershell
openssl x509 -req -days 365 -in alice.csr `
  -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial `
  -out alice.crt
```

### 3. Verify the cert

**Mac / Linux:**
```bash
openssl verify -CAfile certs/ca.crt alice.crt
```

**Windows (PowerShell):**
```powershell
openssl verify -CAfile certs/ca.crt alice.crt
```

### 4. Test with curl

**Mac / Linux:**
```bash
curl --cert alice.crt --key alice.key --cacert certs/ca.crt \
  https://api.sgummalla.net:8443
```

**Windows (PowerShell):**
```powershell
curl --cert alice.crt --key alice.key --cacert certs/ca.crt `
  https://api.sgummalla.net:8443
```

Expected response:

```json
{
  "subject": { "CN": "alice", "O": "sgummalla", "C": "US" },
  "issuer":  { "CN": "sgummalla-api-ca", "O": "sgummalla", "C": "US" },
  "valid_from": "...",
  "valid_to": "...",
  "serial_number": "...",
  "fingerprint": "...",
  "fingerprint256": "..."
}
```

### 5. Revoking a client (manual)

There is no CRL configured. To revoke access, rotate the CA:

1. Generate a new CA key and cert
2. Re-issue all valid client certs with the new CA
3. Update Fly.io secrets: `TLS_CA_CERT`, `TLS_SERVER_CERT`, `TLS_SERVER_KEY`
4. Redeploy

---

## Encrypted certs (git-crypt)

All files in `certs/` are encrypted with [git-crypt](https://github.com/AGWA/git-crypt) (AES-256)
and are safe to commit. Without the key they are unreadable binary blobs.

### How it works

- Your GPG key is registered as a collaborator.
- git-crypt stores a copy of its own key inside the repo at
  `.git-crypt/keys/default/0/<fingerprint>.gpg`, encrypted with your GPG key.
- On any machine where your GPG private key is present, one command decrypts everything.

### Clone and unlock on a new machine

**Step 1 — export your GPG private key on this machine:**

**Mac / Linux:**
```bash
gpg --export-secret-keys --armor sgummalla.work@gmail.com > sgummalla-gpg-private.asc
```

**Windows (PowerShell):**
```powershell
gpg --export-secret-keys --armor sgummalla.work@gmail.com | Out-File -Encoding ascii sgummalla-gpg-private.asc
```

Transfer `sgummalla-gpg-private.asc` to the new machine securely (AirDrop, encrypted USB, 1Password, etc.).

**Step 2 — on the new machine, import the GPG key:**

**Mac / Linux:**
```bash
gpg --import sgummalla-gpg-private.asc
```

**Windows (PowerShell):**
```powershell
gpg --import sgummalla-gpg-private.asc
```

**Step 3 — clone the repo and unlock:**

**Mac / Linux:**
```bash
git clone <repo-url>
cd api_sgummalla_net
git-crypt unlock
```

**Windows (PowerShell):**
```powershell
git clone <repo-url>
cd api_sgummalla_net
git-crypt unlock
```

That's it — `certs/` will be decrypted automatically using your GPG key.

> Delete `sgummalla-gpg-private.asc` after importing. Do not commit it anywhere.

### Grant access to another person

**Mac / Linux:**
```bash
gpg --import their-key.asc
git-crypt add-gpg-user their@email.com
git push
# They can now run: git-crypt unlock
```

**Windows (PowerShell):**
```powershell
gpg --import their-key.asc
git-crypt add-gpg-user their@email.com
git push
# They can now run: git-crypt unlock
```

### Prerequisites on any new machine

**Mac:**
```bash
brew install git-crypt gnupg
```

**Windows:**
```powershell
winget install --id GnuPG.GnuPG
winget install --id AGWA.git-crypt
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
| `TLS_CA_CERT` | CA certificate (PEM) — used by mTLS server to verify client certs |
| `TLS_SERVER_CERT` | Server certificate (PEM) — mTLS server |
| `TLS_SERVER_KEY` | Server private key (PEM) — mTLS server |

### Rotating the CA (client cert validation)

Only needed if you want to invalidate all existing client certs and re-issue them.

**Mac / Linux:**
```bash
flyctl secrets set \
  TLS_CA_CERT="$(cat certs/ca.crt)" \
  -a api-sgummalla-net
```

**Windows (PowerShell):**
```powershell
flyctl secrets set `
  TLS_CA_CERT=(Get-Content certs/ca.crt -Raw) `
  -a api-sgummalla-net
```

### Rotating the server cert (Let's Encrypt)

`TLS_SERVER_CERT` and `TLS_SERVER_KEY` come from acme.sh, not from `certs/`. Let's Encrypt certs expire every 90 days.

**Mac / Linux:**
```bash
# Re-issue via DNS challenge (update _acme-challenge TXT record when prompted)
~/.acme.sh/acme.sh --renew -d api.sgummalla.net \
  --server letsencrypt \
  --yes-I-know-dns-manual-mode-enough-go-ahead-please --force

# Push new cert to Fly.io
flyctl secrets set \
  TLS_SERVER_CERT="$(cat ~/.acme.sh/api.sgummalla.net_ecc/fullchain.cer)" \
  TLS_SERVER_KEY="$(cat ~/.acme.sh/api.sgummalla.net_ecc/api.sgummalla.net.key)" \
  -a api-sgummalla-net
```

**Windows (PowerShell):**
```powershell
# Re-issue via DNS challenge (update _acme-challenge TXT record when prompted)
~/.acme.sh/acme.sh --renew -d api.sgummalla.net `
  --server letsencrypt `
  --yes-I-know-dns-manual-mode-enough-go-ahead-please --force

# Push new cert to Fly.io
flyctl secrets set `
  TLS_SERVER_CERT=(Get-Content ~/.acme.sh/api.sgummalla.net_ecc/fullchain.cer -Raw) `
  TLS_SERVER_KEY=(Get-Content ~/.acme.sh/api.sgummalla.net_ecc/api.sgummalla.net.key -Raw) `
  -a api-sgummalla-net
```
