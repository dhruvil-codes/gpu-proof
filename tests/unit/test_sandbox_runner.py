"""Offline tests for services/sandbox_runner.py (no network, no creds)."""
import os

from services import sandbox_runner as sb


def test_provenance_constants():
    assert sb.PROVENANCE_SIMULATED == "simulated"
    assert sb.PROVENANCE_SANDBOX_MEASURED == "sandbox-measured"


def test_simulated_prepare_and_run(monkeypatch):
    monkeypatch.setenv("USE_SIMULATOR", "true")
    r = sb.get_sandbox_runner()
    assert isinstance(r, sb.SimulatedSandboxRunner)
    prep = r.prepare("python:3.12-slim", "echo hi")
    assert prep.exit_code == 0 and prep.image_uuid
    assert prep.provenance == sb.PROVENANCE_SIMULATED
    res = r.run(sb.SandboxSpec(command="python", args=["-c", "print(1)"]))
    assert res.ok and res.operation_id.startswith("sim-op-")
    # disposable run returns no continuation image
    assert res.image_uuid is None


def test_simulated_persistent_run_returns_image(monkeypatch):
    monkeypatch.setenv("USE_SIMULATOR", "true")
    r = sb.get_sandbox_runner()
    res = r.run(sb.SandboxSpec(command="python", disposable=False))
    assert res.image_uuid is not None


def test_truncation():
    assert len(sb._truncate("x" * (sb.MAX_STREAM_CHARS + 10))) == sb.MAX_STREAM_CHARS


def test_real_runner_refuses_without_creds(monkeypatch):
    monkeypatch.setenv("USE_SIMULATOR", "false")
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    monkeypatch.delenv("NEBIUS_PROJECT_ID", raising=False)
    try:
        sb.get_sandbox_runner(api_key="", project_id="")
    except RuntimeError as e:
        assert "NEBIUS" in str(e)
    else:
        raise AssertionError("expected RuntimeError")
    finally:
        monkeypatch.setenv("USE_SIMULATOR", "true")
