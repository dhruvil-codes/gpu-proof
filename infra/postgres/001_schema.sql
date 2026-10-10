CREATE TABLE IF NOT EXISTS certifications (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, current_model TEXT, candidate_model TEXT,
  created_at TIMESTAMPTZ DEFAULT now(), finished_at TIMESTAMPTZ, final_decision TEXT,
  spend_usd NUMERIC DEFAULT 0, simulated BOOLEAN DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS workloads (
  id TEXT PRIMARY KEY, certification_id TEXT REFERENCES certifications(id),
  task_type TEXT, seed INT, request_count INT, digest TEXT
);
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY, certification_id TEXT REFERENCES certifications(id),
  idx INT, gpu_type TEXT, gpu_count INT, precision TEXT, engine TEXT,
  status TEXT, reason TEXT, job_id TEXT, simulated BOOLEAN,
  estimated_cost NUMERIC, actual_cost NUMERIC,
  failure_type TEXT, started_at TIMESTAMPTZ DEFAULT now(), finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS experiment_metrics (
  experiment_id TEXT PRIMARY KEY REFERENCES experiments(id),
  ttft_p50_ms NUMERIC, ttft_p95_ms NUMERIC, latency_p50_ms NUMERIC, latency_p95_ms NUMERIC,
  throughput_rps NUMERIC, tokens_per_s NUMERIC, quality_score NUMERIC,
  json_success NUMERIC, tool_success NUMERIC, error_rate NUMERIC, cost_per_1m NUMERIC
);
