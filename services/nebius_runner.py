"""Nebius runner interface + adapters. Real GPU jobs ONLY via policy engine + ledger.

Real adapter uses Nebius AI Cloud REST (api.nebius.cloud/ai/v1/jobs). Simulated adapter is
dev/test only, labelled SIMULATED, and can never mint certificates.
"""
from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass

API_BASE = "https://api.nebius.cloud/ai/v1"


@dataclass
class JobSpec:
    image: str
    gpu_type: str
    gpu_count: int
    env: dict
    timeout_s: int = 900


@dataclass
class JobHandle:
    job_id: str
    simulated: bool


class NebiusRunner:
    def create(self, spec: JobSpec) -> JobHandle:
        raise NotImplementedError

    def logs(self, handle: JobHandle, tail: int = 200) -> str:
        raise NotImplementedError

    def cancel(self, handle: JobHandle) -> None:
        raise NotImplementedError

    def delete(self, handle: JobHandle) -> None:
        raise NotImplementedError


class SimulatedRunner(NebiusRunner):
    """Deterministic fake: L40S+30B OOMs, H100 FP8 passes. For dev/tests only."""

    def __init__(self) -> None:
        self.jobs: dict[str, dict] = {}
        self.n = 0

    def create(self, spec: JobSpec) -> JobHandle:
        self.n += 1
        jid = f"sim-job-{self.n:04d}"
        # Nano-30B OOMs on L40S by design (matches demo story); H100 FP8 passes
        oom = spec.gpu_type == "L40S"
        self.jobs[jid] = {"spec": spec, "oom": oom}
        return JobHandle(jid, True)

    def logs(self, handle: JobHandle, tail: int = 200) -> str:
        j = self.jobs[handle.job_id]
        if j["oom"]:
            return "SIMULATED ... CUDA out of memory (L40S 48GB, Nano-30B FP8) ... FAILED"
        return "SIMULATED ... vLLM ready ... benchmark ok ... PASSED"

    def cancel(self, handle: JobHandle) -> None:
        self.jobs.pop(handle.job_id, None)

    def delete(self, handle: JobHandle) -> None:
        self.jobs.pop(handle.job_id, None)


class RealNebiusRunner(NebiusRunner):
    def __init__(self) -> None:
        self.key = os.environ.get("NEBIUS_API_KEY", "")
        self.project = os.environ.get("NEBIUS_PROJECT_ID", "")
        self.subnet = os.environ.get("NEBIUS_SUBNET_ID", "")
        if not (self.key and self.project and self.subnet):
            raise RuntimeError("missing NEBIUS_API_KEY/PROJECT_ID/SUBNET_ID; use simulator")

    def _req(self, method: str, path: str, body: dict | None = None) -> dict:
        req = urllib.request.Request(
            f"{API_BASE}{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")

    def create(self, spec: JobSpec) -> JobHandle:
        res = self._req("POST", "/jobs", {
            "parentId": self.project,
            "image": spec.image, "subnetId": self.subnet,
            "resources": {"gpu": spec.gpu_count, "gpuType": spec.gpu_type},
            "env": spec.env, "timeoutHours": max(1 / 60, spec.timeout_s / 3600),
        })
        jid = res.get("metadata", {}).get("id", "unknown")
        return JobHandle(str(jid), False)

    def logs(self, handle: JobHandle, tail: int = 200) -> str:
        res = self._req("GET", f"/jobs/{handle.job_id}/logs?tail={tail}")
        return str(res.get("logs", ""))[:20000]

    def cancel(self, handle: JobHandle) -> None:
        try:
            self._req("POST", "/jobs/cancel", {"id": handle.job_id})
        finally:
            self.delete(handle)

    def delete(self, handle: JobHandle) -> None:
        try:
            self._req("DELETE", f"/jobs/{handle.job_id}")
        except Exception:
            pass


def get_runner() -> NebiusRunner:
    if os.environ.get("USE_SIMULATOR", "true").lower() == "true":
        return SimulatedRunner()
    return RealNebiusRunner()
