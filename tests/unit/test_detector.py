"""Local hardware probe is deterministic, offline-safe, and bridge-compatible."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services.detector import gather_profile, map_profile


def test_mac_mini_tiers_by_unified_memory():
    assert map_profile({"os": "macOS", "chip": "Apple M4", "system_ram_gb": 16}, [])["profileKey"] == "MAC_MINI_16GB"
    assert map_profile({"os": "macOS", "chip": "Apple M3 Pro", "system_ram_gb": 24}, [])["profileKey"] == "MAC_MINI_24GB"
    assert map_profile({"os": "macOS", "chip": "Apple M3 Max", "system_ram_gb": 64}, [])["profileKey"] == "MACBOOK_MAX_64GB"
    assert map_profile({"os": "macOS", "chip": "Apple M2 Ultra", "system_ram_gb": 128}, [])["profileKey"] == "MAC_STUDIO_128GB"


def test_nvidia_discrete_takes_precedence():
    rtx4090 = map_profile({"os": "Windows"}, [{"name": "NVIDIA GeForce RTX 4090", "memory_mb": 24576}])
    assert rtx4090["profileKey"] == "RTX4090"
    assert rtx4090["usableGB"] == 24
    rtx3090 = map_profile({"os": "Linux"}, [{"name": "NVIDIA GeForce RTX 3090", "memory_mb": 24576}])
    assert rtx3090["profileKey"] == "RTX3090"


def test_gather_profile_is_bridge_compatible_json():
    p = gather_profile()
    # Web UI bridge requires these three fields (importCliProfile validates them).
    assert p["profileKey"] and p["label"] and isinstance(p["usableGB"], int)
    assert p["method"] == "cli-probe"
    assert json.dumps(p)  # serializable for paste-into-UI flow
