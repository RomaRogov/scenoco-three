# bench — the measurements

The question: does SceNoCo change the outcome, against the same task built without it?

Each arm builds the same game, and the parity suite that proves they *are* the same game lives
in `oracle/`:

```bash
cd bench && npm install && npm run install:arms && npm run build:arms && npm run oracle
```

### Running a sweep

```bash
# the model both harnesses drive
mlx_vlm.server --model mlx-community/Qwen3.5-9B-MLX-4bit \
  --port 8081 --kv-bits 8 --quantized-kv-start 1024 --max-tokens 4096

npm run bench -- --arms vanilla,r3f,scenoco --tasks crate-value --harness opencode --attempts 3
```

One JSON file per cell lands in `results/`, so a sweep is resumable: a machine that sleeps in the
middle of one costs you the cell it was on, not the sweep. Each cell edits its arm **in place** and
restores it afterwards — a copy in `/tmp` would be a different project, since an arm's
`node_modules` is where its compiler, its types and its tag vocabulary come from.

### What a cell records

| | |
| --- | --- |
| `built` | the project compiles and typechecks |
| `regressed` | the parity suite no longer passes — the game was broken while being changed |
| `passed` | the task's own oracle is satisfied |
| **`silentlyWrong`** | it built, the agent stopped, and the task is not done |

`silentlyWrong` is the headline: nothing in the loop told the agent, and nothing could have. It is
"it runs" versus "it won't compile", turned into a number.

The task suite is kept honest by `oracle/pristine.test.ts`, which asserts that **every task oracle
fails on an untouched arm**. An oracle that already passes measures nothing, and that mistake is
otherwise invisible — it looks like an easy task rather than a broken one.

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

## Watching a run

A cell takes minutes and a sweep takes hours, so a run should be readable while it happens rather
than only afterwards. There are two ways in, and they answer different questions.

**The transcript, as it streams.** Every cell appends to `results/live/<harness>-<arm>-<task>-<n>.log`
from the moment the agent starts, so a long silence is distinguishable from a hang:

```
tail -f results/live/*.log
```

The file opens with the cell id, the timestamp and the exact prompt, and closes with the grading
line (`built=… regressed=… passed=… diff=…`), which makes it a complete record of the cell on its
own. Logs are kept for finished cells too — a `SILENTLY WRONG` result is only interesting if you can
read what the agent believed it was doing.

**The session, as a conversation.** OpenCode persists every session to a shared store, so a server
started separately sees runs driven by any other process — including a sweep already in flight:

```
npm run watch
```

Then open `http://127.0.0.1:4096`, choose **Add project**, and pick `~/.scenoco-bench/work/<arm>`.
Each cell for that arm arrives as a new session, updating live, with tool calls and token counts
rendered as chat. This is why the agent's workspace is a stable path per arm instead of a fresh
temp directory: the interface lists sessions by project directory, and a directory that exists for
only four minutes can never be opened in one.

The server is **observation only**. Cells are deliberately *not* driven through it with
`opencode run --attach`, even though that would work: a long-lived shared process between cells is
exactly the kind of cross-cell state a benchmark cannot have. Watching a run must not be able to
change it.
