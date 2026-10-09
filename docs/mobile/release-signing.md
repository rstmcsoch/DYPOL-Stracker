# Release signing identity and keystore recovery

## Status on 2026-10-09

- **The previous release keystore is lost.** It was created earlier with the subject `CN=Stracker Release` and
  fingerprint `71:d6:e6:10:…:f3:07:f8`. Its files lived in the build workspace's `~/.config/stracker-release/`, and that
  workspace was reset, so the keystore, its password, and its certificate are gone and cannot be recovered from this
  repository. That fingerprint and subject are retired. Do not use them anywhere.
- **A new identity was generated** on 2026-10-09 with the subject requested by the owner (below). It is not in EAS yet.
  EAS can receive it only after the owner signs in to Expo (see `eas-build.md`).
- **The new private material exists only in this sandbox**, in `~/.config/stracker-release/`. It is not in Git, not in
  `mobile/`, and not in any APK. Step 1 under *Owner steps* must be done before this sandbox is discarded. If it is not,
  this identity is gone and a new one must be created (see *Recovery*).

## The identity

| Item | Value |
| --- | --- |
| Purpose | Signs every Stracker release APK. Separate from any other app or development key. |
| Subject | `CN=Rustam Chaturvedi, O=DYPOL LABS, L=Pimpri-Chinchwad, ST=Maharashtra, POSTALCODE=411018, C=IN` (postal code is attribute `2.5.4.17`) |
| Type | Self-signed application-signing certificate. The name is the owner's requested subject; no certificate authority has verified it. |
| Key | RSA 4096-bit. Certificate signature SHA-256 with RSA. |
| Keystore | PKCS#12 (`stracker-release.p12`), alias `stracker-release`, encrypted with AES-256 (PBES2), the default `keytool` produces on JDK 17. |
| Validity | Not before 2026-10-08, not after 2051-10-03 (9,125 days). |
| Serial number | `5D11D9B6755984ED99F316234968A6AE8` |
| **SHA-256 fingerprint** | `9A:77:A2:E1:0E:0E:17:5B:76:FB:8F:F8:15:16:EE:3F:92:BA:6A:A1:DA:83:5E:68:72:7B:82:68:2F:28:18:11` |
| SHA-1 fingerprint | `36:8B:05:3E:08:E1:FB:C8:CD:E4:29:43:F3:92:0B:C7:9C:D9:23:78` |
| Public certificate (committed) | `mobile/release-signing/stracker-release.cert.pem` |

The SHA-256 fingerprint is the value `npm run verify:apk` compares against the certificate inside a downloaded APK. A
mismatch means the APK was not signed with this identity.

The keystore was checked after creation: OpenSSL opened it with its password, found the `stracker-release` key and
certificate, and the certificate matched the committed PEM.

## Owner steps (before the sandbox is discarded)

1. Copy three files out of `~/.config/stracker-release/` on the build machine: `stracker-release.p12`,
   `keystore-password.txt`, and `stracker-release.cert.pem`. Store them in your password manager as attachments on one
   entry titled "Stracker Android release keystore", together with the alias and the SHA-256 fingerprint above. Do not
   paste the password into chat, a ticket, a commit message, `eas.json`, `app.config.ts`, or any committed file.
2. Check the copy. This must print the SHA-256 fingerprint above:

   ```bash
   openssl pkcs12 -in stracker-release.p12 -passin file:keystore-password.txt -clcerts -nokeys \
     | openssl x509 -noout -fingerprint -sha256
   ```

3. Upload the keystore to EAS (`eas-build.md`, step 4). The PKCS#12 keystore has one password, which serves as both the
   store password and the key password.
4. Only after steps 1 to 3 succeed, delete the working copies on the build machine. Keep one offline backup of the
   encrypted `.p12` and its password in a different place from the first.

## Recovery

Losing the keystore means no later update can be signed with this identity. Android refuses to install an update signed
with a different key, so every user would have to uninstall the app first, which deletes its local data.

To restore from the password manager:

1. Store `stracker-release.p12` and its password in a secure location outside the repository.
2. Run the check in step 2 above. The fingerprint must match the value in this document.
3. Re-upload the keystore with `npx eas-cli credentials --platform android`.

If the keystore is lost and no backup exists, do not create a new identity silently. Create one with
`python3 mobile/scripts/create-release-keystore.py --out <directory>` (needs `pip install cryptography`). The script
refuses to overwrite existing files and never prints the key or the password. Then update this document, the committed
public certificate, and the release notes, and tell users they must uninstall the old build before installing the new
one.

## Regenerating the identity

`mobile/scripts/create-release-keystore.py` creates an identity with the subject above, a 4096-bit RSA key, a 25-year
validity, and an AES-256 PKCS#12 keystore. It writes the keystore, its password file, and the public PEM with
restricted permissions (directory 700, files 600), then reopens the keystore to confirm it works.

## What is deliberately not done

- EAS-generated credentials are not used. An identity EAS generates carries EAS's subject, not the one requested for
  this app, so this repository supplies its own keystore.
- No Google Play upload key or Play App Signing enrolment exists yet. Enrol this identity in Play App Signing when the
  app is published, and keep any upload key separate.
- The repository never contains a keystore, a password, or a private key. `.gitignore` ignores `*.p12`, `*.keystore`,
  `*.jks`, and private `*.pem` files; only `release-signing/*.cert.pem` (public certificates) is allowed.
