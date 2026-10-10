# Feedback (draft — finalize after real runs)

- Token Factory: OpenAI-compatible + JSON mode worked; model catalog Markdown drifted from `/api/public/models_info` (source of truth should be one endpoint).
- AI Cloud Jobs: REST create/cancel/logs shape took digging; want a minimal Serverless-Job-with-GPU example and exact `gpuType` enum values in one page.
- NVIDIA/vLLM: Nano-30B OOM behavior on L40S vs H100 should be documented per-precision to plan migrations without trial runs.
