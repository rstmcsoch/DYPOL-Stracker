#!/usr/bin/env python3
"""Create the Stracker Android release signing identity: a PKCS#12 keystore and its public certificate.

Run once, on a trusted machine. The output directory receives:
  stracker-release.p12        private key + certificate (AES-256 encrypted with the password below)
  keystore-password.txt       the keystore/key password (also the only copy outside the keystore)
  stracker-release.cert.pem   the public certificate (safe to commit; see docs/mobile/release-signing.md)

Nothing secret is printed. The script refuses to overwrite an existing identity, because replacing a
signing key breaks in-place updates for every installed copy of the app.

Usage:   python3 mobile/scripts/create-release-keystore.py --out ~/.config/stracker-release
Needs:   pip install cryptography
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import os
import secrets
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

# Subject requested for the Stracker release identity. Self-signed application-signing certificate.
SUBJECT = [
    (NameOID.COMMON_NAME, "Rustam Chaturvedi"),
    (NameOID.ORGANIZATION_NAME, "DYPOL LABS"),
    (NameOID.LOCALITY_NAME, "Pimpri-Chinchwad"),
    (NameOID.STATE_OR_PROVINCE_NAME, "Maharashtra"),
    (NameOID.POSTAL_CODE, "411018"),
    (NameOID.COUNTRY_NAME, "IN"),
]
ALIAS = b"stracker-release"
KEY_BITS = 4096
VALIDITY_DAYS = 9125  # about 25 years, so the signing identity outlives routine device upgrades


def write_private(path: Path, data: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)
    os.chmod(path, 0o600)


def build_certificate(key: rsa.RSAPrivateKey) -> x509.Certificate:
    name = x509.Name([x509.NameAttribute(oid, value) for oid, value in SUBJECT])
    now = dt.datetime.now(dt.timezone.utc)
    return (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=VALIDITY_DAYS))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True, type=Path, help="directory to create (for example ~/.config/stracker-release)")
    args = parser.parse_args()

    out = args.out.expanduser()
    keystore = out / "stracker-release.p12"
    password_file = out / "keystore-password.txt"
    if keystore.exists() or password_file.exists():
        sys.exit(f"refusing to overwrite an existing release identity in {out}")
    out.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(out, 0o700)

    key = rsa.generate_private_key(public_exponent=65537, key_size=KEY_BITS)
    certificate = build_certificate(key)
    password = secrets.token_urlsafe(32)
    keystore_bytes = pkcs12.serialize_key_and_certificates(
        ALIAS, key, certificate, None, serialization.BestAvailableEncryption(password.encode("utf-8"))
    )

    write_private(keystore, keystore_bytes)
    write_private(password_file, (password + "\n").encode("utf-8"))
    public_pem = certificate.public_bytes(serialization.Encoding.PEM)
    (out / "stracker-release.cert.pem").write_bytes(public_pem)

    # Read the keystore back with the password to prove it is usable before reporting success.
    loaded_key, loaded_cert, _ = pkcs12.load_key_and_certificates(keystore_bytes, password.encode("utf-8"))
    assert loaded_key is not None and loaded_cert is not None
    assert loaded_cert.public_bytes(serialization.Encoding.DER) == certificate.public_bytes(serialization.Encoding.DER)

    der = certificate.public_bytes(serialization.Encoding.DER)
    digest = hashlib.sha256(der).hexdigest()
    colon_digest = ":".join(digest[i:i + 2].upper() for i in range(0, len(digest), 2))
    print(f"release identity written to {out}")
    print(f"alias:            {ALIAS.decode()}")
    print(f"subject:          {certificate.subject.rfc4514_string()}")
    print(f"not valid after:  {certificate.not_valid_after_utc.date().isoformat()}")
    print(f"key:              RSA {KEY_BITS}, signature SHA-256 with RSA, PKCS#12 keystore")
    print(f"SHA-256 digest:   {digest}")
    print(f"SHA-256 (colons): {colon_digest}")


if __name__ == "__main__":
    main()
