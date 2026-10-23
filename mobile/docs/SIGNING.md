# Release signing — Stracker by DYPOL LABS

The release certificate is **self-signed**. It is not issued by a public certificate
authority, and it proves app identity for sideloaded and Play-distributed builds; it does
not make the app "trusted" in the browser sense.

## Certificate

| Field | Value |
|---|---|
| Common name (CN) | `Rustam Chaturvedi` |
| Organisation (O) | `DYPOL LABS` |
| Locality (L) | `Pimpri-Chinchwad` |
| State (ST) | `Maharashtra` |
| Postal code | `411018` |
| Country (C) | `IN` |
| Distinguished name | `CN=Rustam Chaturvedi, O=DYPOL LABS, L=Pimpri-Chinchwad, ST=Maharashtra, C=IN, postalCode=411018` |
| Key | RSA 4096-bit |
| Signature | SHA-256 with RSA (self-signed) |
| Validity | 2026-10-22 → 2054-03-10 (≈ 10,000 days) |
| Serial | `E1D8E85619FAF21A80D228F647EFC90A4451063` |
| Keystore | PKCS#12, alias `stracker`, one password for store and key |

### SHA-256 fingerprint

```
84:B1:61:59:73:0E:01:D7:A9:64:25:8B:27:32:5E:C3:6D:0A:6A:09:36:A1:AA:CF:DE:86:29:3D:00:0E:DE:7F
```

### SHA-1 fingerprint (legacy tooling only)

```
22:5F:DB:07:A3:92:AE:A0:0D:5A:0D:92:E7:3C:85:D1:14:42:7B:39
```

Verify a built APK against this certificate with:

```bash
# Android build-tools
apksigner verify --print-certs dist/Stracker-release.apk

# or with plain OpenSSL on the exported DER certificate
openssl x509 -inform DER -in dist/keys/stracker-release-cert.der -noout -fingerprint -sha256
```

The APK's signer fingerprint must equal the value above. If it does not, the artifact was
signed with a different key and must not be distributed.

## Files in `dist/keys/`

| File | Purpose |
|---|---|
| `stracker-release.p12` | The keystore. Keep it private; back it up in two places. |
| `stracker-release-cert.pem` | Public certificate (PEM) — safe to publish. |
| `stracker-release-cert.der` | Public certificate (DER) — for `apksigner`/`openssl`. |
| `stracker-release-key.pem` | Encrypted PKCS#8 private key, for rebuilding a JKS if ever needed. |
| `keystore-info.json` | Alias, passwords, fingerprints and the keystore's own SHA-256. |

The keystore password and key password are identical and are recorded in
`keystore-info.json` so the owner can rebuild. Treat that directory as a secret store:
it is excluded from Git (`mobile/dist/**` and `*.p12`/`*.jks`/`*.keystore` are ignored).

## Recovery

If only `stracker-release-key.pem` and the passwords survive, rebuild an equivalent
keystore:

```bash
openssl pkcs12 -export \
  -inkey stracker-release-key.pem -in stracker-release-cert.pem \
  -name stracker -out restored.p12
```

Then point the build at it:

```bash
export STRAKER_KEYSTORE=$PWD/restored.p12
export STRAKER_STORE_PASSWORD=<from keystore-info.json>
export STRAKER_KEY_ALIAS=stracker
export STRAKER_KEY_PASSWORD=<from keystore-info.json>
flutter build apk --release
```

If the keystore itself is lost, no update can be signed for an installed copy: Android
identifies an app by `applicationId` + signing certificate. Keep at least two backups.

## Gradle wiring

`android/app/build.gradle` reads the four values from the environment first and from
`android/key.properties` second:

```properties
storeFile=/absolute/path/to/stracker-release.p12
storePassword=…
keyAlias=stracker
keyPassword=…
```

`storeType` is set to `PKCS12` automatically for `.p12`/`.pfx` files. When none of the four
values is present, the release build stops with a clear message instead of producing a
debug-signed APK.
