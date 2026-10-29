"""Unit tests for Ed25519 cryptographic certificate signing and tamper detection."""
import copy
from services.signer import (
    get_or_create_keys,
    sign_certificate,
    verify_certificate,
    canonical_payload,
)


def test_ed25519_keygen_and_sign():
    priv, pub = get_or_create_keys()
    assert priv is not None and pub is not None

    cert = {
        "certification_id": "cert-test-001",
        "verdict": "SHIP",
        "spend_usd": 0.0069,
        "candidate_model": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
        "twin_digest": "3ca34e2e70578f836fb1c19587b2cef2dfe4b49ad217ff66ec7d1558f5775378",
    }

    signed = sign_certificate(cert)
    assert signed["signature_algorithm"] == "Ed25519"
    assert "signature" in signed
    assert "public_key_b64" in signed
    assert verify_certificate(signed) is True


def test_tamper_detection_metric():
    cert = {
        "certification_id": "cert-test-002",
        "verdict": "SHIP",
        "evidence": {"metrics": {"latency_p95_ms": 3388.2, "quality_score": 1.0}},
    }
    signed = sign_certificate(cert)
    assert verify_certificate(signed) is True

    # Tamper with metric
    tampered = copy.deepcopy(signed)
    tampered["evidence"]["metrics"]["latency_p95_ms"] = 1200.0
    assert verify_certificate(tampered) is False


def test_tamper_detection_verdict():
    cert = {
        "certification_id": "cert-test-003",
        "verdict": "BLOCK",
        "spend_usd": 0.0028,
    }
    signed = sign_certificate(cert)
    assert verify_certificate(signed) is True

    # Tamper with verdict BLOCK -> SHIP
    tampered = copy.deepcopy(signed)
    tampered["verdict"] = "SHIP"
    assert verify_certificate(tampered) is False


def test_tamper_detection_twin_digest():
    cert = {
        "certification_id": "cert-test-004",
        "verdict": "SHIP",
        "twin_digest": "3ca34e2e70578f836fb1c19587b2cef2dfe4b49ad217ff66ec7d1558f5775378",
    }
    signed = sign_certificate(cert)
    assert verify_certificate(signed) is True

    # Change 1 character in digest
    tampered = copy.deepcopy(signed)
    tampered["twin_digest"] = "4ca34e2e70578f836fb1c19587b2cef2dfe4b49ad217ff66ec7d1558f5775378"
    assert verify_certificate(tampered) is False
