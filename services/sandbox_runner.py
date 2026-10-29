"""SandboxProof execution path — Nebius Token Factory Sandboxes (Contree).

The sandbox is a fresh microVM per experiment. The host uploads the sealed
workload twin plus the replay harness, injects a per-operation inference key,
runs the replay, and reads back measured metrics. The VM is disposable and
``preserve_env=False``; the key is never persisted and never printed.

Contract (verified with contree-sdk 0.3.6):
- ``prepare`` runs a non-disposable no-op to mint a reusable base image UUID.
- ``run`` starts from that image, uploads files, streams stdout/stderr
  (truncated at 1 MiB), and returns the operation UUID, image UUID, exit code
  and measured sandbox cost.
- provenance: SANDBOX-MEASURED (real isolated run vs hosted endpoints),
  distinct from SIMULATED (deterministic local adapter).
"""
from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field

PROVENANCE_SIMULATED = "simulated"
PROVENANCE_SANDBOX_MEASURED = "sandbox-measured"
PROVENANCE_GPU_MEASURED = "gpu-measured"

MAX_STREAM_CHARS = 1 * 1024 * 1024  # 1 MiB per stream (service max is 10 MiB)
DEFAULT_BASE_IMAGE = "python:3.12-slim"
DEFAULT_TIMEOUT_S = 900


@dataclass
class SandboxSpec:
    base_image: str = DEFAULT_BASE_IMAGE
    command: str = "python"
    args: list = field(default_factory=list)
    shell: str | None = None
    timeout_s: int = DEFAULT_TIMEOUT_S
    disposable: bool = True
    files: dict = field(default_factory=dict)
    env: dict = field(default_factory=dict)


@dataclass
class SandboxResult:
    operation_id: str
    image_uuid: str | None
    exit_code: int
    stdout: str
    stderr: str
    provenance: str = PROVENANCE_SANDBOX_MEASURED
    cost_usd: float = 0.0
    elapsed_s: float = 0.0

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


def _truncate(s: str | None) -> str:
    s = s or ""
    if len(s) > MAX_STREAM_CHARS:
        return s[:MAX_STREAM_CHARS]
    return s


def _redact(value: str, secret: str | None) -> str:
    if secret and secret in value:
        return value.replace(secret, "***")
    return value


class SimulatedSandboxRunner:
    """Deterministic offline stand-in. Real IDs shape, fake execution.

    Used when USE_SIMULATOR=true or creds missing. Never mints real
    evidence — callers must label output SIMULATED. The stdout payload
    matches the real harness contract so host parsing stays one code path.
    """

    def __init__(self) -> None:
        self.n = 0
        self.images: dict[str, dict] = {}

    def prepare(self, base_image: str, shell: str,
                timeout_s: int = DEFAULT_TIMEOUT_S) -> SandboxResult:
        self.n += 1
        op = f"sim-op-{self.n:04d}"
        img = f"sim-img-{self.n:04d}-{uuid.uuid4().hex[:8]}"
        self.images[img] = {"base": base_image, "shell": shell}
        return SandboxResult(op, img, 0, "SIMULATED prepare ok\n", "",
                             PROVENANCE_SIMULATED, 0.0, 0.0)

    def run(self, spec: SandboxSpec,
            image_uuid: str | None = None) -> SandboxResult:
        self.n += 1
        op = f"sim-op-{self.n:04d}"
        env = spec.env or {}
        concurrency = int(env.get("CONCURRENCY", 8) or 8)
        max_tokens = int(env.get("MAX_TOKENS", 256) or 256)
        requests_n = int(env.get("REQUESTS", 40) or 40)
        quality = 0.62 if max_tokens < 128 else 0.93
        p95 = 2600.0 if concurrency > 24 else 900.0
        payload = {
            "ok": True,
            "model": env.get("MODEL", "simulated-model"),
            "config": {"concurrency": concurrency, "max_tokens": max_tokens,
                       "requests": requests_n},
            "metrics": {
                "count": requests_n, "success_rate": 1.0, "error_rate": 0.01,
                "ttft_p50_ms": round(p95 * 0.2, 2), "ttft_p95_ms": round(p95 * 0.2, 2),
                "latency_p50_ms": round(p95 * 0.2, 2), "latency_p95_ms": p95,
                "requests_per_s": round(requests_n / max(0.001, p95 / 1000), 3),
                "tokens_per_s": round(requests_n * 380 / max(0.001, p95 / 1000), 2),
                "total_tokens": requests_n * 380,
                "quality_score": quality,
                "json_success": 0.6 if quality < 0.85 else 0.98,
                "tool_success": 0.55 if quality < 0.85 else 0.95,
                "simulated": True,
            },
            "quality": {"score": quality},
            "requests": [],
            "errors": [],
            "elapsed_s": round(p95 / 1000, 3),
            "simulated": True,
        }
        out = "SIMULATED ... sandbox replay ok ... " + json.dumps(payload) + "\n"
        img = None if spec.disposable else f"sim-img-{self.n:04d}-{uuid.uuid4().hex[:8]}"
        if img:
            self.images[img] = {"base": spec.base_image}
        return SandboxResult(op, img, 0, out, "", PROVENANCE_SIMULATED, 0.0, 0.0)


class ContreeSandboxRunner:
    """Real Contree Sandboxes via contree-sdk (sync client)."""

    def __init__(self, api_key: str | None = None,
                 project_id: str | None = None) -> None:
        self.key = (api_key or "").strip() or os.environ.get("NEBIUS_API_KEY", "")
        self.project = ((project_id or "").strip()
                        or os.environ.get("NEBIUS_PROJECT_ID", ""))
        self._secret = self.key
        if not (self.key and self.project):
            raise RuntimeError("missing NEBIUS_API_KEY/PROJECT_ID for sandboxes")
        try:
            from contree_sdk import ContreeSync  # type: ignore
        except Exception as e:
            raise RuntimeError(f"contree-sdk not installed: {e}") from e
        # Client reads NEBIUS_API_KEY/NEBIUS_PROJECT_ID from env.
        self._client = ContreeSync()

    def _use(self, ref: str):
        return self._client.images.use(ref)

    def _run_once(self, img, *, command: str, args: list, shell: str | None,
                  env: dict, files: dict, timeout_s: int,
                  disposable: bool) -> SandboxResult:
        """Run one operation, capturing the operation UUID the SDK discards."""
        captured: dict[str, str] = {}
        original = self._client._start_operation

        async def wrapped(*a, **kw):
            op = await original(*a, **kw)
            captured["operation_id"] = str(op)
            return op

        self._client._start_operation = wrapped
        try:
            kwargs = {
                "env": dict(env or {}),
                "files": dict(files or {}),
                "timeout": float(timeout_s),
                "disposable": disposable,
                "preserve_env": False,
            }
            if shell is not None:
                req = img.run(shell=shell, **kwargs)
            else:
                req = img.run(command, args=list(args or []), **kwargs)
            done = req.wait()
        finally:
            self._client._start_operation = original

        cost = 0.0
        elapsed = 0.0
        try:
            cost = float(done.result.cost)
        except Exception:  # noqa: BLE001 — lineage must not fail on metadata
            pass
        try:
            elapsed = float(done.elapsed.total_seconds())
        except Exception:  # noqa: BLE001
            pass
        return SandboxResult(
            operation_id=captured.get("operation_id") or str(done.uuid or "unknown"),
            image_uuid=str(done.uuid) if done.uuid else None,
            exit_code=int(done.exit_code or 0),
            stdout=_truncate(_redact(done.stdout, self._secret)),
            stderr=_truncate(_redact(done.stderr, self._secret)),
            provenance=PROVENANCE_SANDBOX_MEASURED,
            cost_usd=round(cost, 6),
            elapsed_s=round(elapsed, 3),
        )

    def prepare(self, base_image: str, shell: str,
                timeout_s: int = DEFAULT_TIMEOUT_S) -> SandboxResult:
        base = self._use(base_image)
        return self._run_once(
            base, command="python", args=[], shell=shell or "mkdir -p /work",
            env={}, files={}, timeout_s=timeout_s, disposable=False)

    def run(self, spec: SandboxSpec,
            image_uuid: str | None = None) -> SandboxResult:
        img = self._use(image_uuid) if image_uuid else self._use(spec.base_image)
        return self._run_once(
            img, command=spec.command, args=spec.args, shell=spec.shell,
            env=spec.env, files=spec.files, timeout_s=spec.timeout_s,
            disposable=spec.disposable)


_SIM_SINGLETON: SimulatedSandboxRunner | None = None


def get_sandbox_runner(api_key: str | None = None,
                       project_id: str | None = None):
    """Simulated when USE_SIMULATOR=true (tests/dev); else real Contree.

    Real path raises RuntimeError when creds/SDK missing — callers fall
    back to simulator explicitly, never silently. The simulated runner
    is a process-wide singleton so operation IDs stay unique per run.
    """
    global _SIM_SINGLETON
    if os.environ.get("USE_SIMULATOR", "true").lower() == "true":
        if _SIM_SINGLETON is None:
            _SIM_SINGLETON = SimulatedSandboxRunner()
        return _SIM_SINGLETON
    return ContreeSandboxRunner(api_key=api_key, project_id=project_id)
