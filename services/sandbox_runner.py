"""SandboxProof execution path — Nebius Token Factory Sandboxes (Contree).

Replaces AI Cloud GPU jobs (which need billing + SUBNET_ID) with free
beta Sandboxes: isolated microVMs addressed by operation ID + image UUID.

Contract (matches docs verified Oct 2026):
- each run starts fresh compute from an image; filesystem changes survive
  ONLY when submitted with disposable=False and chained from the returned
  image uuid (SDK default disposable=True discards state).
- run() prepares, wait() submits + waits; the returned object carries
  process result (exit_code/stdout/stderr, truncated 1 MiB) + saved image
  uuid (None when disposable).
- secrets NEVER go inside: preserve_env=False, no NEBIUS/TAVILY keys in
  command/files/stdout. Tavily runs host-side; only cached JSON fixtures
  enter the sandbox.
- provenance: SANDBOX-MEASURED (real isolated run vs hosted TF endpoints),
  distinct from SIMULATED (localhost fake) and GPU-MEASURED (reserved).
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field

PROVENANCE_SIMULATED = "simulated"
PROVENANCE_SANDBOX_MEASURED = "sandbox-measured"
PROVENANCE_GPU_MEASURED = "gpu-measured"

MAX_STREAM_CHARS = 1 * 1024 * 1024  # 1 MiB per stream (service max is 10 MiB)
DEFAULT_BASE_IMAGE = "python:3.12-slim"
DEFAULT_TIMEOUT_S = 120


@dataclass
class SandboxSpec:
    base_image: str = DEFAULT_BASE_IMAGE
    command: str = "python"
    args: list = field(default_factory=list)
    shell: str | None = None
    timeout_s: int = DEFAULT_TIMEOUT_S
    disposable: bool = True
    network_enabled: bool = True


@dataclass
class SandboxResult:
    operation_id: str
    image_uuid: str | None
    exit_code: int
    stdout: str
    stderr: str
    provenance: str = PROVENANCE_SANDBOX_MEASURED

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


def _truncate(s: str | None) -> str:
    s = s or ""
    if len(s) > MAX_STREAM_CHARS:
        return s[:MAX_STREAM_CHARS]
    return s


class SimulatedSandboxRunner:
    """Deterministic offline stand-in. Real IDs shape, fake execution.

    Used when USE_SIMULATOR=true or creds missing. Never mints real
    evidence — callers must label output SIMULATED.
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
                             PROVENANCE_SIMULATED)

    def run(self, spec: SandboxSpec,
            image_uuid: str | None = None) -> SandboxResult:
        self.n += 1
        op = f"sim-op-{self.n:04d}"
        out = f"SIMULATED ... sandbox run ok ({spec.command}) ... PASSED\n"
        img = None if spec.disposable else f"sim-img-{self.n:04d}-{uuid.uuid4().hex[:8]}"
        if img:
            self.images[img] = {"base": spec.base_image}
        return SandboxResult(op, img, 0, out, "", PROVENANCE_SIMULATED)


class ContreeSandboxRunner:
    """Real Contree Sandboxes via contree-sdk (sync client)."""

    def __init__(self, api_key: str | None = None,
                 project_id: str | None = None) -> None:
        self.key = (api_key or "").strip() or os.environ.get("NEBIUS_API_KEY", "")
        self.project = ((project_id or "").strip()
                        or os.environ.get("NEBIUS_PROJECT_ID", ""))
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

    def prepare(self, base_image: str, shell: str,
                timeout_s: int = DEFAULT_TIMEOUT_S) -> SandboxResult:
        base = self._use(base_image)
        # Save filesystem: disposable=False, chain from returned image.
        done = base.run(shell=shell, disposable=False,
                        timeout=float(timeout_s)).wait()
        return SandboxResult(
            operation_id=str(getattr(done, "operation_id", None) or done.uuid or "unknown"),
            image_uuid=done.uuid,
            exit_code=int(done.exit_code or 0),
            stdout=_truncate(done.stdout),
            stderr=_truncate(done.stderr),
            provenance=PROVENANCE_SANDBOX_MEASURED,
        )

    def run(self, spec: SandboxSpec,
            image_uuid: str | None = None) -> SandboxResult:
        img = self._use(image_uuid) if image_uuid else self._use(spec.base_image)
        kwargs: dict = {"disposable": spec.disposable,
                        "timeout": float(spec.timeout_s),
                        "preserve_env": False}
        if spec.shell:
            req = img.run(shell=spec.shell, **kwargs)
        else:
            req = img.run(spec.command, args=spec.args, **kwargs)
        # NOTE: networking.enabled=false is a REST spawn field; the 0.3.6
        # SDK run() has no networking knob — isolated-network verification
        # runs via `ls /sys/class/net` assertion inside the op instead.
        done = req.wait()
        return SandboxResult(
            operation_id=str(getattr(done, "operation_id", None) or done.uuid or "unknown"),
            image_uuid=done.uuid,
            exit_code=int(done.exit_code or 0),
            stdout=_truncate(done.stdout),
            stderr=_truncate(done.stderr),
            provenance=PROVENANCE_SANDBOX_MEASURED,
        )


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
