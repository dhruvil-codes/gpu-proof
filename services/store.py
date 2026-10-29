"""SQLite store — persists certifications/experiments/metrics so the app survives restarts.

codebase-design: one deep module behind store_cert/get_cert/save_experiment/list.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading

_lock = threading.Lock()
_PATH = os.environ.get("SANDBOXPROOF_DB", os.path.join(os.path.dirname(__file__), "..", "sandboxproof.db"))
_PATH = os.path.abspath(_PATH)

SCHEMA = """
CREATE TABLE IF NOT EXISTS certifications(
  id TEXT PRIMARY KEY, status TEXT, config TEXT, twin TEXT,
  spend REAL DEFAULT 0, simulated INTEGER, created_at REAL, updated_at REAL);
CREATE TABLE IF NOT EXISTS experiments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, certification_id TEXT, idx INTEGER,
  plan TEXT, job_id TEXT, simulated INTEGER, metrics TEXT, failure TEXT,
  verdict TEXT, status TEXT, reason TEXT, classifier TEXT, state TEXT, log TEXT);
"""


def _db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(_PATH), exist_ok=True)
    con = sqlite3.connect(_PATH, check_same_thread=False)
    con.executescript(SCHEMA)
    return con


_DB = _db()


def store_cert(cid: str, status: str, config: dict, twin: dict, spend: float, simulated) -> None:
    import time
    with _lock, _DB:
        _DB.execute(
            "INSERT OR REPLACE INTO certifications(id,status,config,twin,spend,simulated,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,COALESCE((SELECT created_at FROM certifications WHERE id=?),?),?)",
            (cid, status, json.dumps(config), json.dumps(twin), spend,
             None if simulated is None else int(bool(simulated)),
             time.time(), cid, time.time()))


def update_cert(cid: str, status: str, spend: float, simulated) -> None:
    import time
    with _lock, _DB:
        _DB.execute("UPDATE certifications SET status=?,spend=?,simulated=?,updated_at=? WHERE id=?",
                    (status, spend, None if simulated is None else int(bool(simulated)), time.time(), cid))


def save_experiment(cid: str, exp: dict) -> None:
    with _lock, _DB:
        _DB.execute(
            "INSERT INTO experiments(certification_id,idx,plan,job_id,simulated,metrics,failure,verdict,status,reason,classifier,state,log)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (cid, exp.get("index"), json.dumps(exp.get("plan")), exp.get("job_id"),
             int(bool(exp.get("simulated"))), json.dumps(exp.get("metrics")), exp.get("failure"),
             exp.get("verdict"), exp.get("status"), exp.get("reason"),
             json.dumps(exp.get("classifier")) if exp.get("classifier") else None,
             exp.get("state", ""), (exp.get("log") or "")[:4000]))


def get_cert_row(cid: str):
    with _lock:
        r = _DB.execute("SELECT id,status,config,twin,spend,simulated FROM certifications WHERE id=?", (cid,)).fetchone()
    if not r:
        return None
    return {"id": r[0], "status": r[1], "config": json.loads(r[2]), "twin": json.loads(r[3]),
            "spend": r[4], "simulated": None if r[5] is None else bool(r[5])}


def list_experiments(cid: str) -> list[dict]:
    with _lock:
        rows = _DB.execute(
            "SELECT idx,plan,job_id,simulated,metrics,failure,verdict,status,reason,classifier,state,log"
            " FROM experiments WHERE certification_id=? ORDER BY idx", (cid,)).fetchall()
    out = []
    for idx, plan, job_id, sim, metrics, failure, verdict, status, reason, cls, state, log in rows:
        out.append({"index": idx, "plan": json.loads(plan), "job_id": job_id, "simulated": bool(sim),
                    "metrics": json.loads(metrics), "failure": failure, "verdict": verdict,
                    "status": status, "reason": reason,
                    "classifier": json.loads(cls) if cls else None, "state": state, "log": log})
    return out


def list_certs() -> list[dict]:
    with _lock:
        rows = _DB.execute(
            "SELECT id,status,spend,simulated,config,created_at FROM certifications ORDER BY rowid DESC LIMIT 50"
        ).fetchall()
    out = []
    for r in rows:
        try:
            config = json.loads(r[4]) if r[4] else {}
        except Exception:
            config = {}
        out.append({
            "id": r[0], "status": r[1], "spend": r[2],
            "simulated": None if r[3] is None else bool(r[3]),
            "candidate_model": config.get("candidate_model"),
            "created_at": r[5],
        })
    return out
