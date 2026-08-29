# bench — the measurements

Two studies live here.

| | Question | Where |
| --- | --- | --- |
| **Study 1** | Can a small local model *author* SceNoCo correctly? | [`FINDINGS.md`](FINDINGS.md) |
| **Study 2** | Does SceNoCo change the outcome, against the same task built without it? | `RESULTS.md` *(in progress)* |

Study 1 is finished and answers a question about SceNoCo alone. Study 2 is the comparison — the
same game, the same tasks, the same agent, built four ways — and it is the one that can be wrong
in SceNoCo's favour, so its design is documented before its results.

## The stack, and why it is this one

Everything runs against **one local open-weights model**, so anyone with an Apple Silicon Mac
reproduces it exactly and no result depends on a subscription, a quota or a vendor's current
snapshot of a hosted model.

| | |
| --- | --- |
| **Model** | `mlx-community/Qwen3.5-9B-MLX-4bit` — 9B, natively multimodal, 4-bit (~5.7 GB) |
| **Server** | `mlx_vlm.server` (mlx-vlm ≥ 0.6.16), which serves **both** an OpenAI `/v1/chat/completions` and an Anthropic `/v1/messages` API from one process |
| **Harnesses** | [OpenCode](https://opencode.ai) on the OpenAI API, and Claude Code on the Anthropic API |

```bash
mlx_vlm.server --model mlx-community/Qwen3.5-9B-MLX-4bit \
  --port 8081 --kv-bits 8 --quantized-kv-start 1024 --max-tokens 4096
```

**Two unrelated third-party harnesses, one model.** Neither was written for this project, so
"the harness was built to flatter the framework" is not available as an objection — and if the two
disagree, that disagreement is a result worth reporting rather than a bug to tune away.

### Verified before anything was built on it

| Check | Result |
| --- | --- |
| Model loads | 3s, continuous batching, 8-bit KV cache |
| Tool calling | clean `tool_calls`, valid JSON arguments, correct `finish_reason` |
| Vision | correct left-to-right ordering, shapes, colours, and tallest-object judgement on a synthetic scene |
| OpenCode drives it | read + two correct edits, then stopped |
| Claude Code drives it | 4 turns, correct edit, via `ANTHROPIC_BASE_URL` |

Two notes for anyone reproducing this:

- **`vllm-mlx` is not needed.** mlx-vlm already serves the Anthropic API, so one server feeds both
  harnesses. Worth stating because the obvious reading of the docs suggests otherwise.
- **Claude Code reports a `total_cost_usd`.** It is computed from a price table for a model it does
  not recognise and no money changes hands — every request goes to localhost. The runner discards
  the field; do not report it as a cost.

### What this retires

Study 1 concluded (§25) that a local-model agent loop needs *floor + one working step* to fit in
about six thousand tokens, which is why OpenCode — floor 5,630 — could not complete a single edit
there. **That conclusion was about the model of the day, not about local models.** At Qwen3.5's
context length the floor is noise, and OpenCode edits correctly on the first attempt. A bespoke
loop is no longer the price of running locally, which is the whole reason Study 2 can use standard
agents.
