"""Ed25519 cryptographic signing and verification for SandboxProof certificates.

Guarantees tamper-evidence: modifying any metric, gate threshold, candidate model,
or twin digest invalidates the digital signature.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

KEY_DIR = Path(__file__).resolve().parent
PRIVATE_KEY_PATH = KEY_DIR / "cert_private_key.pem"
PUBLIC_KEY_PATH = KEY_DIR / "cert_public_key.pem"


def canonical_payload(cert: dict) -> bytes:
    """Produce deterministic UTF-8 bytes of certificate data excluding the signature field."""
    c = {k: v for k, v in cert.items() if k not in ("signature", "signature_algorithm", "public_key_b64")}
    return json.dumps(c, sort_keys=True, separators=(",", ":")).encode("utf-8")


def get_or_create_keys() -> tuple[ed25519.Ed25519PrivateKey, ed25519.Ed25519PublicKey]:
    """Load or generate the persistent Ed25519 keypair for certificate issuance."""
    if PRIVATE_KEY_PATH.exists() and PUBLIC_KEY_PATH.exists():
        priv_bytes = PRIVATE_KEY_PATH.read_bytes()
        private_key = serialization.load_pem_private_key(priv_bytes, password=None)
        pub_bytes = PUBLIC_KEY_PATH.read_bytes()
        public_key = serialization.load_pem_public_key(pub_bytes)
        return private_key, public_key

    private_key = ed25519.Ed25519PrivateKey.generate()
    public_key = private_key.public_key()

    # Save to disk
    priv_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    PRIVATE_KEY_PATH.write_bytes(priv_pem)
    PUBLIC_KEY_PATH.write_bytes(pub_pem)
    return private_key, public_key


def sign_certificate(cert: dict) -> dict:
    """Sign certificate with Ed25519 private key and embed signature + public key."""
    priv, pub = get_or_create_keys()
    payload = canonical_payload(cert)
    sig_bytes = priv.sign(payload)
    pub_raw = pub.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    signed = dict(cert)
    signed["signature_algorithm"] = "Ed25519"
    signed["public_key_b64"] = base64.b64encode(pub_raw).decode("ascii")
    signed["signature"] = base64.b64encode(sig_bytes).decode("ascii")
    return signed


def verify_certificate(cert: dict, public_key: ed25519.Ed25519PublicKey | None = None) -> bool:
    """Verify Ed25519 signature of certificate against canonical bytes."""
    sig_b64 = cert.get("signature")
    if not sig_b64:
        return False

    try:
        sig_bytes = base64.b64decode(sig_b64)
        if public_key is None:
            pub_b64 = cert.get("public_key_b64")
            if not pub_b64:
                return False
            pub_raw = base64.b64decode(pub_b64)
            public_key = ed25519.Ed25519PublicKey.from_public_bytes(pub_raw)

        payload = canonical_payload(cert)
        public_key.verify(sig_bytes, payload)
        return True
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description="SandboxProof Ed25519 Certificate Verifier")
    parser.add_argument("command", choices=["verify", "sign"], help="Command to run")
    parser.add_argument("file", help="Path to certificate JSON file")
    args = parser.parse_args()

    file_path = Path(args.file)
    if not file_path.exists():
        print(f"Error: file '{file_path}' does not exist.", file=sys.stderr)
        sys.exit(2)

    data = json.loads(file_path.read_text(encoding="utf-8"))
    # Handle both wrapped {'certification': ...} or top-level cert dict
    cert = data.get("certification", data)

    if args.command == "verify":
        ok = verify_certificate(cert)
        if ok:
            print(f"VERIFIED: Certificate '{cert.get('certification_id', 'unknown')}' signature is VALID.")
            sys.exit(0)
        else:
            print(f"FAILED: Certificate '{cert.get('certification_id', 'unknown')}' signature is INVALID or tampered.", file=sys.stderr)
            sys.exit(1)
    elif args.command == "sign":
        signed = sign_certificate(cert)
        if "certification" in data:
            data["certification"] = signed
        else:
            data = signed
        file_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"SIGNED: Certificate signed with Ed25519 key and saved to '{file_path}'.")
        sys.exit(0)


if __name__ == "__main__":
    main()
