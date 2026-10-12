"""GPUProof Local Agent Probe — `python -m services.detector`.

Queries native OS tools for exact machine specs and emits a JSON hardware
profile that the web UI imports via the "Paste `gpuproof detect` output"
bridge (localStorage `gpuproof-cli-profile`, 24h TTL):

    python -m services.detector              # pretty JSON to stdout
    python -m services.detector --json       # compact JSON (for scripting)
    python -m services.detector --save profile.json

Sources:
  - macOS: `system_profiler SPHardwareDataType SPDisplaysDataType`
    (exact chip name e.g. "Mac mini M4 Pro", unified memory in bytes)
  - Windows/Linux: `nvidia-smi --query-gpu=name,memory.total
    --format=csv,noheader` (exact VRAM down to the megabyte)
  - Fallback: platform + psutil (if installed) + /proc/meminfo for RAM/CPU.

The emitted `profileKey` reuses services/advisor.py GPU_CATALOG keys so
frontend fit math (`total_local_int4_gb` vs `usableGB * 0.95`) stays
consistent between the CLI probe and browser auto-detection.
"""
from __future__ import annotations

import argparse
import json
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path


def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for cand in (here.parents[1], here.parents[0], Path.cwd()):
        try:
            if (cand / "services").is_dir() or cand.name == "services":
                return cand if cand.name != "services" else cand.parent
        except Exception:
            continue
    return here.parents[1]


sys.path.insert(0, str(_repo_root()))

try:
    from services.advisor import GPU_CATALOG  # type: ignore
except Exception:  # standalone use without advisor importable
    GPU_CATALOG = {
        "MAC_MINI_16GB": {"vram_gb": 16, "label": "Apple Mac Mini 16GB Unified Memory"},
        "MAC_MINI_24GB": {"vram_gb": 24, "label": "Apple Mac Mini 24GB Unified Memory"},
        "RTX4090": {"vram_gb": 24, "label": "NVIDIA RTX 4090 24GB"},
        "RTX3090": {"vram_gb": 24, "label": "NVIDIA RTX 3090 24GB"},
        "DUAL_RTX3090": {"vram_gb": 48, "label": "Dual RTX 3090 / 4090 48GB"},
        "MACBOOK_MAX_64GB": {"vram_gb": 64, "label": "Apple MacBook Pro Max 64GB Unified Memory"},
        "MAC_STUDIO_128GB": {"vram_gb": 128, "label": "Apple Mac Studio 128GB Unified Memory"},
        "MAC_STUDIO_192GB": {"vram_gb": 192, "label": "Apple Mac Studio 192GB Unified Memory"},
        "L40S": {"vram_gb": 48, "label": "Nebius NVIDIA L40S 48GB"},
    }


# ---------------------------------------------------------------------------
# Native probes
# ---------------------------------------------------------------------------

def _run(cmd: list[str], timeout: float = 8.0) -> str:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return out.stdout or ""
    except Exception:
        return ""


def detect_macos() -> dict:
    """Parse system_profiler for exact chip + unified memory."""
    info: dict = {"os": "macOS"}
    raw = _run(["system_profiler", "SPHardwareDataType", "SPDisplaysDataType"])
    if not raw:
        return info
    # Chip: "Chip: Apple M4 Pro" / "Chip: Apple M1" / "Processor Name: ..."
    m = re.search(r"Chip:\s*(.+)", raw)
    if m:
        info["chip"] = m.group(1).strip()
    else:
        m2 = re.search(r"(?:Processor Name|CPU):\s*(.+)", raw)
        if m2:
            info["chip"] = m2.group(1).strip()
    # Memory: "Memory: 24 GB"
    mm = re.search(r"Memory:\s*([\d.]+)\s*GB", raw, re.IGNORECASE)
    if mm:
        try:
            info["system_ram_gb"] = float(mm.group(1))
        except ValueError:
            pass
    # Model: "Model Name: Mac mini"
    mn = re.search(r"Model Name:\s*(.+)", raw)
    if mn:
        info["model"] = mn.group(1).strip()
    # GPU lines under SPDisplaysDataType: "Chipset Model: Apple M4 Pro"
    cm = re.search(r"Chipset Model:\s*(.+)", raw)
    if cm and "chip" not in info:
        info["chip"] = cm.group(1).strip()
    return info


def detect_nvidia() -> list[dict]:
    """Query nvidia-smi for exact GPU names + VRAM (MB precision)."""
    gpus: list[dict] = []
    if not shutil.which("nvidia-smi"):
        return gpus
    raw = _run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2:
            try:
                mem_mb = float(parts[1].split()[0])
            except ValueError:
                mem_mb = 0.0
            gpus.append({"name": parts[0], "memory_mb": mem_mb})
        elif line:
            gpus.append({"name": line, "memory_mb": 0.0})
    return gpus


def detect_system_ram_cpu() -> dict:
    """Cross-platform RAM + CPU fallback (psutil preferred, /proc fallback)."""
    info: dict = {}
    try:
        import psutil  # type: ignore

        info["system_ram_gb"] = round(psutil.virtual_memory().total / (1024 ** 3), 1)
        info["cpu_threads"] = psutil.cpu_count(logical=True) or 1
        return info
    except Exception:
        pass
    # /proc/meminfo (Linux containers / WSL)
    try:
        meminfo = Path("/proc/meminfo").read_text()
        m = re.search(r"MemTotal:\s*(\d+)\s*kB", meminfo)
        if m:
            info["system_ram_gb"] = round(int(m.group(1)) / 1024 / 1024, 1)
    except Exception:
        pass
    try:
        import os as _os

        info["cpu_threads"] = _os.cpu_count() or 1
    except Exception:
        pass
    return info


# ---------------------------------------------------------------------------
# Profile mapping → GPU_CATALOG keys (shared with advisor.py)
# ---------------------------------------------------------------------------

def map_profile(native: dict, gpus: list[dict]) -> dict:
    os_name = native.get("os") or platform.system()
    sys_lower = str(os_name).lower()
    is_mac = "darwin" in sys_lower or "mac" in sys_lower
    chip = str(native.get("chip") or native.get("model") or "").strip()
    ram_gb = native.get("system_ram_gb")

    # NVIDIA discrete takes precedence everywhere (incl. eGPU Macs).
    if gpus:
        # Pick the largest card as the primary local device.
        primary = max(gpus, key=lambda g: g.get("memory_mb") or 0)
        name = str(primary.get("name") or "NVIDIA GPU")
        mem_mb = float(primary.get("memory_mb") or 0)
        vram_gb = round(mem_mb / 1024, 1) if mem_mb else 24.0
        upper = name.upper().replace(" ", "")
        if "4090" in upper:
            key = "RTX4090"
        elif "4080" in upper or "4070" in upper:
            key = "RTX4090"  # closest single-card tier; usableGB carries exact VRAM
        elif "3090" in upper or "3080" in upper:
            key = "RTX3090"
        elif len(gpus) >= 2:
            key = "DUAL_RTX3090"
        else:
            key = "RTX4090"
        if len(gpus) >= 2 and ("3090" in upper or "4090" in upper):
            key = "DUAL_RTX3090"
            vram_gb = round(sum(float(g.get("memory_mb") or 0) for g in gpus) / 1024, 1)
        vram_human = f"{vram_gb:g}GB" if vram_gb else "24GB"
        multi = f" (x{len(gpus)})" if len(gpus) > 1 else ""
        label = f"{name}{multi} ({vram_human} GDDR6X)"
        return {
            "profileKey": key,
            "label": label,
            "usableGB": int(round(vram_gb)) if vram_gb else 24,
            "gpu_name": name,
            "vram_mb": int(mem_mb) if mem_mb else None,
            "gpu_count": len(gpus),
        }

    if is_mac:
        ram = float(ram_gb) if ram_gb else 16.0
        model = str(native.get("model") or "").strip()
        chip_human = chip or "Apple Silicon M-Series"
        base = f"{model} ({chip_human})".strip() if model else chip_human
        if ram <= 16:
            return {"profileKey": "MAC_MINI_16GB", "label": f"{base} (~16GB Unified Memory)".strip(),
                    "usableGB": 16, "chip": chip_human}
        if ram <= 32:
            return {"profileKey": "MAC_MINI_24GB",
                    "label": f"{base} (~{ram:g}GB Unified Memory)".strip(),
                    "usableGB": int(round(ram)), "chip": chip_human}
        if ram <= 64:
            return {"profileKey": "MACBOOK_MAX_64GB",
                    "label": f"{base} (~{ram:g}GB Unified Memory)".strip(),
                    "usableGB": int(round(ram)), "chip": chip_human}
        if ram <= 128:
            return {"profileKey": "MAC_STUDIO_128GB",
                    "label": f"{base} (~{ram:g}GB Unified Memory)".strip(),
                    "usableGB": int(round(ram)), "chip": chip_human}
        return {"profileKey": "MAC_STUDIO_192GB",
                "label": f"{base} (~{ram:g}GB Unified Memory)".strip(),
                "usableGB": int(round(ram)), "chip": chip_human}

    # Windows/Linux without NVIDIA — report system RAM honestly.
    if ram_gb:
        ram = float(ram_gb)
        label = f"PC / Server ({ram:g}GB system RAM, no discrete NVIDIA GPU detected)"
        key = "MACBOOK_MAX_64GB" if ram >= 48 else ("RTX4090" if ram >= 20 else "MAC_MINI_16GB")
        return {"profileKey": key, "label": label, "usableGB": int(round(ram))}
    return {"profileKey": "MAC_MINI_16GB",
            "label": "Unknown Machine (~16GB estimated — install pynvml / psutil for exact specs)",
            "usableGB": 16}


def gather_profile() -> dict:
    """Full native detection → JSON-serializable hardware profile."""
    system = platform.system()
    if system == "Darwin":
        native = detect_macos()
        native.setdefault("os", "macOS")
    elif system == "Windows":
        native = {"os": "Windows"}
    elif system == "Linux":
        native = {"os": "Linux"}
    else:
        native = {"os": system or "Unknown"}

    native["arch"] = platform.machine() or "unknown"
    fallback = detect_system_ram_cpu()
    for k, v in fallback.items():
        native.setdefault(k, v)

    gpus = detect_nvidia()
    mapped = map_profile(native, gpus)

    catalog_label = ""
    try:
        catalog_label = str(GPU_CATALOG.get(mapped["profileKey"], {}).get("label", ""))
    except Exception:
        catalog_label = ""

    profile = {
        "os": native.get("os", "Unknown"),
        "arch": native.get("arch", "unknown"),
        "chip": native.get("chip"),
        "model": native.get("model"),
        "gpu_name": mapped.get("gpu_name") or native.get("chip"),
        "gpu_count": mapped.get("gpu_count", len(gpus)),
        "vram_mb": mapped.get("vram_mb"),
        "system_ram_gb": native.get("system_ram_gb"),
        "cpu_threads": native.get("cpu_threads"),
        "profileKey": mapped["profileKey"],
        "label": mapped["label"],
        "usableGB": mapped["usableGB"],
        "catalog_label": catalog_label,
        "method": "cli-probe",
    }
    # Drop Nones for compact bridge JSON.
    return {k: v for k, v in profile.items() if v is not None}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gpuproof detect",
                                 description="GPUProof local hardware probe — prints a JSON profile for the web UI bridge.")
    ap.add_argument("--json", action="store_true", help="Compact single-line JSON (for scripting).")
    ap.add_argument("--save", metavar="PATH", default=None, help="Write the profile JSON to a file.")
    args = ap.parse_args(argv)

    profile = gather_profile()
    text = json.dumps(profile) if args.json else json.dumps(profile, indent=2)
    if args.save:
        Path(args.save).write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
        print(f"Saved hardware profile to {args.save}")
    print(text)
    print("\n# Paste the JSON above into GPUProof: [Evaluate a different machine / server ▾] → "
          "`gpuproof detect` output.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
