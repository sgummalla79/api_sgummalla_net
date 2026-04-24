# api.sgummalla.net

Public site: `https://api.sgummalla.net`
mTLS endpoint: `https://api.sgummalla.net:8443`

## mTLS endpoint

The endpoint on port `8443` requires a valid client certificate signed by the private CA.
It returns a JSON object with the presenting certificate's details.

```bash
curl --cert client.crt --key client.key --cacert certs/ca.crt \
  https://api.sgummalla.net:8443
```

---

## Issuing a client certificate

The CA key lives in `certs/ca.key`. It is encrypted in the repo via git-crypt — unlock the repo before using it.

### 1. Generate a client key and CSR

Replace `alice` with the identity name for this client.

```bash
openssl genrsa -out alice.key 2048

openssl req -new -key alice.key -out alice.csr \
  -subj "/CN=alice/O=sgummalla/C=US"
```

### 2. Sign the CSR with the CA

```bash
openssl x509 -req -days 365 -in alice.csr \
  -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial \
  -out alice.crt
```

### 3. Verify the cert

```bash
openssl verify -CAfile certs/ca.crt alice.crt
```

### 4. Test with curl

```bash
curl --cert alice.crt --key alice.key --cacert certs/ca.crt \
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

```bash
# They send you their GPG public key, you import it, then:
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

```bash
flyctl deploy --local-only
```

## Secrets

Three secrets must be set in Fly.io for the mTLS server to start:

| Secret | Description |
|--------|-------------|
| `TLS_CA_CERT` | CA certificate (PEM) used to verify client certs |
| `TLS_SERVER_CERT` | Server certificate (PEM) |
| `TLS_SERVER_KEY` | Server private key (PEM) |

To rotate:

```bash
flyctl secrets set \
  TLS_CA_CERT="$(cat certs/ca.crt)" \
  TLS_SERVER_CERT="$(cat certs/server.crt)" \
  TLS_SERVER_KEY="$(cat certs/server.key)" \
  -a api-sgummalla-net
```
