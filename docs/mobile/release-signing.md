# Release signing identity and keystore recovery

## The identity

| Item | Value |
| --- | --- |
| Purpose | Signs every Stracker release APK. Separate from any other app or any development key. |
| Key type | RSA 4096-bit, signature SHA-256 |
| Keystore type | PKCS#12 (`.p12`), alias `stracker-release` |
| Certificate subject | `CN=Stracker Release, O=DYPOL LABS, C=IN` |
| Valid until | 2054-02-24 (generated 2026-10-09, 10,000 days) |
| **Certificate SHA-256 fingerprint** | `71:d6:e6:10:ed:52:df:39:34:a5:f6:67:9c:2d:fd:9f:8d:e2:62:f3:38:84:d2:57:44:1b:ef:a1:81:f3:07:f8` |
| Certificate SHA-1 fingerprint | `8d:a3:f9:bd:80:57:bb:f6:b4:00:12:6a:41:d2:b8:b4:5d:79:9d:47` |
| Public certificate (safe to commit) | `mobile/release-signing/stracker-release.cert.pem` |

The SHA-256 fingerprint is what Google Play and anyone checking an APK compares against. It is also printed by
`npm run verify:apk` when the Android build-tools are installed.

## Where the private material is, and what must happen next

The private key and the keystore password were generated on the build machine and written **outside the
repository**, to `~/.config/stracker-release/` (directory mode 700, files mode 600):

- `stracker-release.p12`: the encrypted keystore (private key and certificate).
- `keystore-password.txt`: its password.

Neither file is in Git, and neither is in `mobile/`. The repository contains only the public certificate.

**Owner action required, once:**

1. Copy both files into your team's password manager or encrypted vault, as attachments to one entry titled
   "Stracker Android release keystore". Record the alias (`stracker-release`) in the same entry.
2. Confirm the copy opens: the keystore unlocks with the password from the entry.
3. Delete the copies on the build machine once EAS holds the identity (see *Upload to EAS* in `eas-build.md`).
4. Keep at least one offline backup of the encrypted `.p12` and its password, in a different place from the other.

Never paste the password into chat, a ticket, a commit message, `eas.json`, `app.config.ts`, or an environment file
that is committed.

## Recovering the keystore

Losing the keystore means no future update can be signed with the same identity. Android then refuses to install
an update over an installed Stracker, and every user would have to uninstall first, losing local data. Keep the
backup described above.

To recover from the vault:

1. Restore `stracker-release.p12` and the password to a secure location, not the repository.
2. Check it: `keytool -list -v -keystore stracker-release.p12 -storetype PKCS12` (asks for the password). The
   SHA-256 must equal the fingerprint above.
3. Re-upload it to EAS with `npx eas-cli credentials --platform android`.

If the keystore is lost **and** no backup exists, do not create a new one silently. Tell the owner that users must
uninstall the old build first, and record the new fingerprint here and in the release notes.

## What is deliberately not done

- The release identity is not shared with EAS by this repository, and the repository never contains a password.
- No Play upload key or App Signing enrolment exists yet. Enrol the identity in Play App Signing when the app is
  published, and keep the upload key separate.
