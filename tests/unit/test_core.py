import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import cost_engine as ce
from services import experiment_policy as pol
from services import failure_classifier as fc
from services import metrics_math as mm
from services import quality_checks as qc
from services import sla_evaluator as sla
from services import state_machine as sm
from services import workload_twin as wt
from services.certificate_engine import build_certificate


def test_policy_rejects_bad_gpu_and_over_budget():
    p = pol.ExperimentProposal("", 64, 16384, 1024, "out of bounds")
    r = pol.validate_proposal(p, experiment_index=0, cert_spend=0, total_spend=0, estimated_cost=1.0)
    assert not r.allowed and any("model" in x for x in r.reasons) and any("concurrency" in x for x in r.reasons)
    ok = pol.ExperimentProposal("candidate-model", 8, 4096, 256, "valid")
    r2 = pol.validate_proposal(ok, experiment_index=0, cert_spend=9.5, total_spend=19.5, estimated_cost=1.0)
    assert not r2.allowed  # breaches $10 cert and $20 total


def test_cost_math():
    c = ce.experiment_cost("L40S", 900)
    assert 0 < c <= 2.0
    assert ce.cost_per_1m_tokens(1.0, 100_000) == 10.0
    assert ce.monthly_projection(10.0, 100_000_000) == 1000.0


def test_sla_any_fail_blocks():
    gates = [sla.Gate("latency_p95_ms", "<=", 2000), sla.Gate("quality_score", ">=", 0.9)]
    res = sla.evaluate_gates(gates, {"latency_p95_ms": 1500, "quality_score": 0.95})
    assert sla.decision(res) == "SHIP"
    res2 = sla.evaluate_gates(gates, {"latency_p95_ms": 2500, "quality_score": 0.95})
    assert sla.decision(res2) == "BLOCK"
    res3 = sla.evaluate_gates(gates, {"latency_p95_ms": 1500})
    assert sla.decision(res3) == "BLOCK"  # missing metric blocks


def test_classifier_rules():
    assert fc.classify("CUDA out of memory", oom=True) == "MEMORY"
    assert fc.classify("job timeout exceeded", timeout=True) == "INFRASTRUCTURE"
    assert fc.classify("", metrics={"error_rate": 0.5}) == "RELIABILITY"
    assert fc.next_action("MEMORY", budget_left=5, attempts_left=3) == "CONTINUE"
    assert fc.next_action("MEMORY", budget_left=0, attempts_left=0) == "STOP_BUDGET"


def test_quality_checks():
    good = '{"tool": "get_price", "arguments": {"symbol": "NVDA"}}'
    item = {"expect_tool": "get_price", "expect_args": {"symbol": "NVDA"}, "expect_schema": None}
    s = qc.score_response(good, item)
    assert s["quality"] == 1.0 and s["json_valid"]
    bad = qc.score_response("not json", item)
    assert bad["quality"] == 0.0
    so = qc.score_response('{"answer": "yes", "confidence": 0.9}',
                           {"expect_tool": None, "expect_args": None,
                            "expect_schema": {"answer": "string", "confidence": "number"}})
    assert so["quality"] == 1.0


def test_metrics_and_twin_deterministic():
    reqs = [{"status": "ok", "ttft_ms": 100 + i, "latency_ms": 200 + i,
             "input_tokens": 100, "output_tokens": 50} for i in range(100)]
    m = mm.summarize(reqs, 50.0)
    assert m["success_rate"] == 1.0 and m["requests_per_s"] == 2.0
    a, b = wt.build_twin(42, 50), wt.build_twin(42, 50)
    assert a["digest"] == b["digest"] and len(a["items"]) == 50


def test_state_machine_and_certificate():
    assert sm.advance("QUEUED") == "VALIDATING"
    assert sm.fail("BENCHMARKING", "OOM") == "OOM"
    gates = [sla.Gate("quality_score", ">=", 0.9)]
    res = sla.evaluate_gates(gates, {"quality_score": 0.95})
    cert = build_certificate(certification_id="c1", gate_results=res, metrics={"q": 1})
    assert cert["verdict"] == "SHIP"
    try:
        build_certificate(certification_id="c1", gate_results=res, metrics={}, simulated=True)
        raise AssertionError("simulator must never certify")
    except ValueError:
        pass
