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

The CA key lives in `certs/ca.key` — keep it secret, never commit it.

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
