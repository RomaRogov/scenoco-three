# Study 1 — What a 26B local model says about this framework

> **Dates:** August 2026. **Model:** `mlx-community/gemma-4-26b-a4b-it-4bit` (4-bit, mlx, 24 GB
> M4 Pro). **Scope:** this study measures whether a small model can *author* SceNoCo correctly.
> It does **not** compare SceNoCo against another framework — that is Study 2, in
> [`RESULTS.md`](RESULTS.md).
>
> Written as it was run, corrections included: several early conclusions here were wrong and are
> struck through by later sections rather than quietly edited. §19 is corrected by §22, and §15 by
> §25. That history is left in on purpose — it is how you can tell which numbers were re-measured.

Four full runs of the eight-task suite against `gemma-4-26b-a4b-it-4bit` (mlx, 4-bit, on a 24 GB
Mac), two conditions: with a 1,000-token context card and without one. 32 task-runs, 67 builds,
222 tool calls. Every number below is from `results/run-*.json`.

| condition | runs | tasks passed | prompt tokens | wall time |
| --- | --- | --- | --- | --- |
| **no context card** | 2 | **16/16** | 121,824 per run | 5m 25s per run |
| context card (1,000t) | 2 | 15/16 † | 178,335 per run | 7m 15s per run |

† The first card run scored 5/8, but two of those failures were harness bugs (a wrong assertion,
and no way for the model to ask what was broken). Both were fixed and the run repeated; 7/8 is
the fair number, and the one remaining failure is discussed in §5.

---

## 1. The document format is guessable — 35/35 first edits compiled

**Every single time the model edited a file, the result compiled.** Across 32 task-runs, only
**4 of 67 builds failed**, and three of those were markdown residue (§4) rather than a
misunderstanding of the format.

It was never told the syntax in the winning condition. It read a neighbouring element and copied
the shape: `<Override target="#brick" hits="2" />` inside a `<Prefab>`, `<Vignette />` inside the
render document, `background="#071018"` on `<Scene>`, a new `class Spin extends Component` with a
public field. The design bet — *an element is a class, its attributes are that class's
properties, and one spelling per value* — holds up against a small model with no documentation.

Two specific decisions from this week were exercised and neither confused it:

- **Effects live in a `*.render.xml`, not on `<Scene>`.** Asked for "darkened corners", it opened
  the render document and added `<Vignette />`. 4/4 across both conditions.
- **A component is a class with public fields.** Both the "add a field" and "add a component"
  tasks passed 4/4, first build clean every time.

## 2. The context card was worth nothing — and cost 46% more tokens

This is the result I did not expect. Handing the model a compressed one-page DSL card made it
**slower (7m15s vs 5m25s), more expensive (+46% prompt tokens, peak 4,858 vs 4,053), and no more
accurate (15/16 vs 16/16)**.

The one task the card changed, it changed for the worse: `spawn-with-override` failed **0/2 with
the card and passed 2/2 without it**, the same way both times — the card's example shows a row of
bricks, and the model completed the row it was shown rather than the three bricks it was asked
for (§5).

The reading is not "documentation is bad". It is that **for this class of model, the project is
better documentation than the documentation** — the files are right there, they are the exact
version in play, and they carry the local conventions. A preamble competes with them for a small
window and adds patterns that are not in the file being edited.

> Caveat, stated plainly: two runs per condition, one model, one project, temperature 0.2. The
> per-task pattern is consistent across runs rather than noisy, but this is a signal, not a law.

**Done.** Do not ship a "here is the DSL" preamble to a local model. The card is opt-in
(`--card`) rather than default. Spend the budget
on file access — a file list plus `read_file` beat a hand-written summary on every axis measured.

## 3. Diagnostics are the entire repair mechanism — so they must be *reachable*

The sharpest finding came from a harness bug. In the first run there was no `build` tool, and the
gate only spoke *after* an edit. The repair task starts from a deliberately broken document, so
the model was never shown the error: **it read eleven files across twelve steps and never edited
anything.** 0 edits. It could not find a problem it was never told about.

Adding a `build` tool and pasting the diagnostics into the opening message took the same task to
**6/6 in five steps**. The model reads a SceNoCo diagnostic and fixes the document it names —
including the harder half of that task, an *invented* system attribute (`difficulty="hard"`) that
had to be deleted rather than corrected.

The framework already has the answer — `scenoco check` compiles without writing and prints every
diagnostic. So this is not a missing feature; it is a rule about **agent surfaces**: whatever
tools an agent is given here, one of them must be the compiler, and it must be callable on demand
rather than only firing on the rebound after an edit. A loop that can only learn about errors it
caused cannot start from a project it did not write.

## 4. Markdown fence residue is the most common corruption

Three of the four build failures were the same thing: **backticks landing inside the XML**,
because the model wrapped its edit in a code fence and the fence went into the file.

```
assets/scenes/arena.prefab.xml:41:9  text-content  <Components> contains the text "`".
```

The compiler caught all three with a precise `text-content` diagnostic and the model recovered.
But it is free to prevent:

**Done, both ends.**
- `write_file` and `edit_file` strip a leading/trailing ``` fence (and its language tag) before
  writing, and the run log records that they had to.
- `text-content` recognises the case: when the stray text is a fence, it says so and says to
  delete the line, rather than explaining the attribute rule that was never the problem.

## 5. Repetitive documents are where a small model slips

`spawn-with-override` is the only task that failed on merit, and it failed the same way twice:
asked for **three** bricks at given positions, it wrote the three correctly — right coordinates,
right `<Override target="#brick" hits="2" />` — and then added **two more** at the ends of the
row, uninstructed, to make the row symmetrical with the 19 above it.

That is pattern completion, and the document handed it the pattern: a level was 19 to 31
near-identical `<Prefab src="brick.prefab.xml" position="…" />` lines. The same repetition is
what makes `edit_file` miss (§6) — a find-snippet that matches 19 places.

**The fix is not a generative tag.** A `<Grid>` that expands into elements would put imperative
meaning in a declarative tree and break the DSL's one rule — every bare element is a node, every
attribute is that class's property. Repetition belongs in a component, where loops live.

What that needed was one thing the DSL was missing: a prefab could not be *named*. Scenes could
(`SceneType`), geometries and materials could, but a prefab was spawn-only, so a component had no
way to be handed the thing it repeats. A field declared `PrefabType` is now filled by a path like
any other document reference, and a level's wall is data plus a loop:

```xml
<Group position="y: 13.9">
  <Components>
    <BrickField brick="brick.prefab.xml" rows="[1111111, 1111111, .11111.]" />
  </Components>
</Group>
```

Each level document lost about thirty lines, and the map — which had been sitting above each
level as a *comment* while the elements below repeated it — became the data it always was.

## 6. `edit_file` is what a small model reaches for, and it misses 10% of the time

| tool | calls |
| --- | --- |
| `read_file` | 89 |
| `edit_file` | 84 |
| `build` | 27 |
| `list_files` | 16 |
| `write_file` | **6** |

Given both, the model chose find/replace over whole-file writes **14 to 1**. 23 of 222 tool calls
failed (~10%), nearly all `edit_file` snippets that did not match verbatim or matched in several
places. It recovered from every one, because the tool's error says what to do ("copy the snippet
verbatim", "include more context so it is unique").

**Done.** Find/replace is the primary edit verb, and its failures now do the work: a snippet
matching several places is answered with the line numbers and the lines themselves; a snippet
matching none is answered with the closest line in the file and its number; and the same lines
with different indentation are simply accepted, since refusing that is refusing over whitespace.

## 7. Reading is the dominant cost, and prose in authored files is a tax

Peak prompts were driven almost entirely by file reads, not by the task:

| file | ~tokens | of which prose |
| --- | --- | --- |
| `src/Ball.ts` | 1,190 | 28 of 133 lines |
| `assets/scenes/arena.prefab.xml` | 843 | 7 of 68 |
| `assets/scenes/level-1.scene.xml` | 655 | 4 of 50 (the rest is 19 near-identical lines) |
| `src/Paddle.ts` | 618 | 14 of 58 |

One file read is 8–15% of an 8k window. This repo's house style is dense explanatory comments,
which is right for the humans and larger models reading it — but in an authored *game* project it
is a per-read tax on the model that has to edit it.

**Done.** `read_file` takes a `from`/`to` line range, and a `search` tool returns `path:line: text`
across the project — so finding something no longer costs a whole file, and the line numbers it
hands back are what the ranged read consumes. The house style stands: keep the essays in the
packages, keep authored project files lean.

---

## What this says overall

The parts of the framework that were designed for this audience **work**: the class-is-the-
registration component model, one-spelling-per-value, the element/attribute rule, and the
compiler's fix-it diagnostics. A 26B model with no documentation, five tools and an 8k window
scored 16/16 and never wrote an invalid document on the first try.

The gaps were one language gap and a pile of tooling. All are now closed:

1. **A prefab could not be named** — so repetition had nowhere to go but the document. A
   `PrefabType` field takes a path now, and breakout's levels are maps rather than walls of
   elements (§5).
2. **The compiler has to be in the agent's hands** — `scenoco check` existed; the loop just was
   not given it (§3).
3. **Tooling hygiene** — fences are stripped before they reach a file, `read_file` takes a line
   range, `search` exists so reading a whole file is a choice, and a missed `edit_file` snippet
   now answers with the nearest line and its number (§4, §6, §7).

And one thing to stop doing: writing a context preamble for small models. Measured, it cost 46%
more tokens and bought nothing (§2) — the card is opt-in now (`--card`), off by default.

---

# Round two: rebuilding the toolset

The eight tasks became ten — the two new ones cover the surfaces that changed — so the scores
below are not comparable with round one's. What *is* comparable is each row against the row above
it: **the model is deterministic at this temperature**, verified by two byte-identical runs, so
every difference here was caused by the change beside it and not by noise.

| what changed | passed |
| --- | --- |
| the new toolset alone (search, ranged reads, fence stripping, better edit errors) | 4/10 |
| **+ the gate typechecks, not just compiles** | 6/10 |
| **+ `describe` — the project's own vocabulary, on demand** | 7/10 |
| + a nudge at two idle steps ("stop investigating") | **4/10** ← reverted |
| the nudge moved to four idle steps | 7/10 |
| **+ `describe` answers for a document: what a spawn can override** | **8/10** |

## 8. The gate has to cover both halves of the project

The compiler validates documents. It does not typecheck TypeScript — nor should it — so a loop
whose only gate is `scenoco build` is blind on the half of the project where components live.

Asked to write a new component, the model produced `this.delta` and left a comment in the source
saying *"Wait, SceNoCo might provide delta in update. Let's check if it's passed."* The documents
compiled, the gate went green, and nothing ever told it. Running `tsc` after a clean compile —
sequential, since a failed compile makes every type error an echo — took that task from 4/7
checks to 7/7 and the suite from 4/10 to 6/10.

## 9. Documentation as an *answer* beats documentation as a preamble

Round one killed the context card: as a preamble it cost 46% more tokens and bought nothing. The
other half of that story showed up here. Asked for a vignette, the model searched the project for
`Vignette`, found nothing — the class is in a package, outside anything it can read — and spent
twelve steps looking for it.

`describe` answers that from the compiler's own model: the fields a class takes, their types,
defaults and doc comments, read from the source rather than written about it. Same information
the card held, but exact, current, and paid for only when asked. It took `render-effect` from
0/5 to 5/5, and the suite from 6/10 to 7/10.

Then the same tool, asked about a *document*, closed the next gap (§11).

## 10. Nudging a small model to stop reading makes it worse

With six tools the model investigates more, and one task did twelve steps of reading without an
edit. The obvious fix — "stop investigating, make the change now" after two idle steps — dropped
the suite from 7/10 to 4/10. The model that had not yet opened the render document was told to
stop investigating, and put `<Vignette>` in the scene.

Reading is usually a small model working, not stalling. Moved to four idle steps, the nudge is
free: it fires only in the pathological case and cost nothing measurable.

## 11. An override is invisible in the thing being overridden

The one task that still fails, and the sharpest remaining finding about the **language** rather
than the tools.

Asked to widen the paddle for one level — an `<Override target="#paddle" scale="1.4" />` on the
arena spawn, and level 2 already has an `<Override>` two lines away — the model did this, twice,
identically:

```
read level-2.scene.xml · read arena.prefab.xml · describe Paddle · describe paddle.geometry.xml
· read paddle.geometry.xml · search "paddle.prefab.xml" · search "paddle.prefab.xml" · …
```

**It was hunting for where the paddle's width is set.** That is a sound model of a declarative
document — a value lives somewhere, you find it and change it — and it has no answer here,
because the paddle has no `scale` at all. An override does not change a value; it *adds one the
prefab never wrote*. Nothing in `arena.prefab.xml` says that is possible, so there was nothing to
find, and the model looped until it ran out of steps rather than inventing an element.

Giving `describe` a document — `describe arena.prefab.xml` lists the ids a spawn can reach, using
the compiler's own parser — is what made this askable at all, and it fixed the neighbouring
`new-component` task. It did not fix this one: the model never asked, because it had already read
the file and reading it looks like the same thing.

**This is a design question, not a tooling one**, and it is the sibling of one the breakout README
already names: *an `<Override>` cannot be given a name*. A prefab that declared its adjustable
surface — the way a component declares its fields — would be discoverable by reading, would make
`describe` truthful rather than inferred, and would give a spawn something to look up instead of
something to know.

## 12. Opaque data gets no diagnostics

Moving a level's repetition into a component moved the level's *data* into a string, and a string
has no type beyond `string`. Asked to add a row of five two-hit bricks, the model wrote
`..22222..` — five 2s, centred in its own row, nine characters wide against a seven-wide wall. It
compiles. It typechecks. Nothing says a word, and the whole wall shifts.

That is the honest cost of the rule that repetition belongs in components: the compiler checks
types, and a map is not a type. The component now says so at runtime, and its doc comment — which
`describe` shows — says the rows must be the same width. Both are worth having and neither is a
diagnostic. **Anything a game authors as free-form data is outside everything the framework can
check**, which is worth knowing before the next round asks a model to build scene geometry.

## What the tools look like now

| tool | why it is shaped that way |
| --- | --- |
| `search` | `path:line: text` across the project — reading was the dominant token cost |
| `read_file` | takes a line range; output unannotated, so a snippet copies straight into an edit |
| `describe` | a class, or a document. The vocabulary, on demand, read from source (§9, §11) |
| `edit_file` | fences stripped, indentation forgiven, misses answered with the nearest line **and its number** |
| `write_file` | fences stripped. The fallback — chosen 14 to 1 against |
| `list_files` | every readable file, with its length |
| `build` | compile **and** typecheck (§8) |

Failed tool calls went from **23 in 222** to **2 in 77**, and no fence has reached a file since —
so the fence stripper has never had to fire, which is the point of it. The whole suite is 77 tool
calls, 188k prompt tokens and 8 minutes; first build clean on 7 of the 9 tasks that built at all.

---

# Round three: building geometry, with eyes

A different kind of task. No logic, no components, no right answer: **build a castle**, in a
project holding an empty field and four materials, and keep going until the picture looks right.

The model can see. `look` renders the scene through the editor's own MCP — the same `open` and
`screenshot` an agent gets from `scenoco-editor` — and the PNG comes back as a user turn.
Gemma-4-26B is a VLM, so this is the real loop and not a proxy for one.

Three runs. The run archive holds every view the model asked for, the scene it
wrote, and a step-by-step transcript.

| run | steps | edits | looks | result |
| --- | --- | --- | --- | --- |
| 1 (dirty start — see §17) | 21 | 4 | 3 | a castle, but continued from an earlier run's walls |
| **2 (clean)** | **12** | **2** | **1** | **a castle: curtain wall, four corner towers, keep, gatehouse** |
| 3 (with malformed-call recovery) | 34 | 6 | 3 | worse — more iteration made it worse (§16) |

## 13. It builds a castle, and the plan view is correct

From an empty field and no examples, in twelve steps: a square curtain wall, four cylindrical
corner towers with conical roofs, a keep in the middle with a big cone, and a gatehouse standing
in a gap in the south wall. The plan view is the convincing one — the layout is a castle, not a
pile of boxes.

Every one of the 40-odd elements it wrote compiled. It asked `describe` what a `<Cube>` and a
`<Cylinder>` take before writing either.

## 14. Unity's non-uniform primitives are a systematic error

**All three runs got tower heights wrong, the same way.** A `<Cylinder>` is one across and *two*
tall, as Unity's is, so `scale="y: 6"` is twelve units of tower. The model reasoned `scale =
size` every time: it placed towers centred at `y: 3` (sinking them three units into the ground)
and put the conical roofs at `y: 9` when the tower tops were at `y: 9`… by its own arithmetic,
not the engine's. The result is the red ring you can see around each tower — a roof buried in
the shaft it should be sitting on.

The same error, larger: run 1 wrote `<Plane scale="10">` for a courtyard and got a 100-unit slab
that swallowed the entire field.

This survived every countermeasure. The class doc says "one unit across and two tall"; `describe`
prints it; run 2 and 3 both *called* `describe Cylinder` before writing; the starter scene now
carries a size table naming each primitive's dimensions. The model reads `scale` as size anyway.

**`<Cube>`, `<Sphere>` and `<Cone>` — the ones that are one unit in every axis — were never got
wrong.**

This is a design question and it is yours. Matching Unity exactly is the stated rule. But the
audience for this framework cannot open an inspector and drag a handle, and for that audience
`scale = size` is the rule it will apply whatever the docs say. The cheapest fix that keeps the
spirit is to make **`plane` 1 × 1** (its 10 × 10 is Unity's worst wart) and consider 1-tall
`cylinder`/`capsule`; the alternative is to keep the numbers and accept that towers come out twice
as tall as asked for.

> These runs were made against primitives shipped as **node tags** — `<Cube>`, `<Cylinder>`. That
> was wrong and is reverted: three.js has no `Cube`, so neither does the DSL. The primitives are
> geometry documents now (`scenoco new geometry`), named the way every other shared asset is:
> `<Mesh geometry="../geometry/cube.geometry.xml" scale="…" />`. The sizes, and therefore this
> finding, are unchanged.

## 15. Vision has a hard memory ceiling, and it decides the whole design

Measured on this 24 GB machine: a request carrying one image costs about **0.85 GB per thousand
prompt tokens**, and the model aborts with a Metal out-of-memory somewhere past **four thousand
tokens**. Text-only runs peak at 4.4k comfortably; add a picture and 4.1k is the edge.

Three runs died there before the harness was reshaped around it. What it forced:

- **a view is shown once** — the image is replaced by a note on the very next turn, because a
  picture the model has already answered is pure cost, and by then it has usually edited the
  scene anyway;
- **tool results capped at 2,500 characters** when the run can see, against 6,000 when it cannot;
- **a six-message window** instead of ten;
- images at 384 × 288, though that turns out not to matter — Gemma normalises every image to a
  fixed 256 tokens, so a smaller picture is not a cheaper one.

The general lesson for a visual agent loop on local hardware: **the picture and the file are
competing for the same few thousand tokens**, and the file usually loses. That is an argument for
`search` and ranged reads, not against seeing.

## 16. More iteration made it worse

Run 3 got the malformed-call recovery of §17 and used it: 34 steps, 6 edits, 3 looks, and it kept
going where run 2 had stopped at 12. The castle came out **worse** — two tower roofs deleted
outright, one still buried, the layout looser.

It looked, it edited, and the edits were not corrections. Nothing in the loop makes the model
compare what it sees against what it meant; it sees a picture, forms a fresh intention, and
writes. A 26B model given more turns does not converge here — it wanders. Which is a caution
about "iterate until it looks right" as a strategy for this size of model: the first coherent
attempt was the best one.

## 17. Two harness faults worth naming

**A tool call arriving as text.** The model writes `<|tool_call>call:edit_file{…}` into its
content instead of emitting a call the server can parse — always on a long multi-line `find`. A
turn with no calls reads as "finished", so both of the first two runs *ended* on one, mid-edit.
The loop now recognises the shape and says the call did not come through; it recurred four times
in run 3, so this is a standing limit of the model on long structured arguments, not a one-off.

**A run that dies leaves the fixture dirty.** The first castle run crashed after the agent loop
and never restored the project — so the *next* run snapshotted a half-built castle and started
from someone else's walls. It took a while to notice, and it cost a result. Cleanup is in a
`finally` now.

## 18. `camera: "fit"` frames nothing when the scene is flat

The editor's screenshot takes `camera: "fit"`. On a scene whose only content is a ground plane —
a bounding box with zero height — it returns an empty sky. Degenerate bounds, and the first thing
an agent starting from an empty project would hit.

---

# Round four: the loop was the inference server

The segmented-context run ended in a fixed cycle — `list_files → read_file → edit_file(fails) →
cut`, nineteen times, 80 steps, 2 edits. I rebuilt the mechanism around two budgets and a richer
handover and it still stuck. Then I went looking at what other agents hit with this model, and the
answer was not in my loop at all.

## 19. `<|tool_call>` as text is a known, fixed mlx bug

The failure that ended every castle run — the model writing `<|tool_call>call:edit_file{…}` into
its content instead of emitting a call the server could parse — is a **Gemma-4 tool-parser bug in
mlx**, fixed upstream two months ago.

| | |
| --- | --- |
| installed here | `mlx-vlm 0.6.3`, `mlx-lm 0.31.3` |
| latest | `mlx-vlm 0.6.16` (2026-08-24) |
| [mlx-vlm #1365](https://github.com/Blaizzy/mlx-vlm/issues/1365) | *gemma4 tool parser drops colon-namespaced tool names (`call:server:tool{…}` → "Invalid tool call")* — closed 2026-06-16 |
| [mlx-vlm #1473](https://github.com/Blaizzy/mlx-vlm/issues/1473) | *Fix Gemma 4 bare namespaced tool calls* — closed 2026-06-30 |
| [mlx-lm #1125](https://github.com/ml-explore/mlx-lm/issues/1125) | *Failing tool call with `mlx-community/gemma-4-26b-a4b-it-4bit`* — `gemma4.py: raise ValueError("No function provided.")` |

`call:edit_file{…}` is exactly the shape those parsers drop.

The same symptom is documented against another agent entirely:
[opencode #21034](https://github.com/anomalyco/opencode/issues/21034), *"gemma-4-26b and
gemma-4-31b … leading to tool loops/failures"* — tool calls repeated, `<edit_file>` blocks emitted
as text, the agent stalling. Two users report it fixed by **updating the inference engine**, not
the agent.

So: update mlx before tuning anything else here.

> **Corrected after doing it.** The upgrade was worth making — the parser handles namespaced calls
> now, and the new server logs `finish_reason` per request, which is what found the real cause —
> but it was *not* the cause. See §22.

## 22. It was the output cap, not the parser

The upgrade landed and the leak came straight back, on `write_file`. The new server's logging said
why in one line:

```
prompt_tokens=27120 generated_tokens=1400 elapsed=80.9s finish_reason=length
```

`generated_tokens=1400` is exactly `maxTokens`. **The model was writing a whole scene document
into a tool call and running out of output tokens part-way through the string.** The call was
never terminated, so the server had nothing to parse, and the half-written call came back as plain
content — which from the outside is indistinguishable from a model that has forgotten how to call
tools. Thirty-six requests in one run ended `finish_reason=length`.

Every "tool call arrived as text" in this document is that. It is not a model limitation, it is
not the inference engine, and no amount of prompting about shorter `find` arguments would have
fixed it. It is one number in the harness.

Three things follow, all now done:

- **The cap has to fit the largest argument the tools invite.** `write_file` on a scene document
  needs a few thousand output tokens; 1,400 was a guess made for a benchmark whose edits were one
  line long. It is 4,000 for the castle task.
- **`finish_reason` has to reach the loop.** The client passes it through, and a truncated reply is
  now answered with *"your reply was cut off before the tool call finished"* rather than a lecture
  about tool-call syntax the model had not violated.
- **A recovery branch must not skip the budget check.** The text-call handler used to `continue`
  past compaction, so a repeating truncated call appended the whole half-written file to the
  history every time and nothing ever cut it back: the prompt reached **27,120 tokens** in a run
  budgeted at 5,000.

The wider lesson is about instrumentation rather than models. Three rounds of findings were
written about a symptom — text where a tool call should be — while the number that explained it
sat in a field the harness never read.

## 20. The picture was a thumbnail, and it needn't have been

I shrank the render from 512 × 384 to 384 × 288 while chasing the out-of-memory crashes. Measured
against the model, that bought **nothing**:

| render | payload | prompt tokens | peak memory |
| --- | --- | --- | --- |
| 384 × 288 | 53 KB | 288 | 16.3 GB |
| 640 × 480 | 103 KB | 288 | 16.3 GB |
| 896 × 896 | 189 KB | 278 | 16.3 GB |
| 1280 × 720 | 217 KB | 286 | 16.3 GB |

Gemma resizes every image to a fixed tile, so a picture costs about **280 tokens whatever its
size**, and the encoder's memory does not move either. The model named the castle correctly at
every size — but it was judging a castle from a thumbnail for no reason at all. Render at
896 × 896 or larger; it is free.

This also narrows §15: the out-of-memory ceiling is a function of **prompt tokens**, not of the
picture. An image adds its ~280 and its encoder pass; everything else is the conversation.

## 21. Where a complete agent stands, against what this needs

Four requirements, all measured rather than assumed: an OpenAI-compatible local endpoint with
native tool calls; an MCP client that passes **image tool results** through to a vision model
(that is how the editor becomes eyes); compaction that works; and it has to fit on a 24 GB Mac.

| | local endpoint | MCP | image tool results | |
| --- | --- | --- | --- | --- |
| **opencode** (TS, 201k★) | custom OpenAI-compatible provider, per-model `modalities` | yes | **yes** — `supportsMediaInToolResult` embeds media for `@ai-sdk/openai` and extracts it to a synthetic user message otherwise ([#39824](https://github.com/anomalyco/opencode/issues/39824)) | compaction exists, several open bugs |
| **goose** (Rust, 53k★) | Ollama, LM Studio, custom `OPENAI_HOST` | MCP-native | image blocks preserved in tool results | tool calling is mandatory |
| **Cline / Roo** | yes | yes | yes — [#1865](https://github.com/cline/cline/issues/1865) closed 2025-06 | VS Code only |
| **OpenHands** | yes | yes | yes | heavyweight; container sandbox |
| **Crush** | [still open](https://github.com/charmbracelet/crush/issues/447) | yes | — | not ready for local |
| **Aider** | yes | no MCP | manual `/add` | wrong shape for a tool loop |

The thing worth noticing: **opencode already contains the mechanism I hand-rolled.** Its
`supportsMediaInToolResult` decides whether an image rides inside the tool result or is lifted into
its own user turn — the same choice `imageMessage` makes in `src/agent.ts`, generalised and
provider-aware.

**What this benchmark is for, after that.** It is not a harness for *doing* the work; it is an
instrument for measuring the *framework* — effect-based assertions, a fixed task set, a
deterministic model, run logs that say which surface a small model got wrong. That job does not go
away. What should go away is the part of it that reimplements an agent.

## 23. With the cap raised, the loop works

Same task, same fifteen-minute cap, one number changed:

| | before | after |
| --- | --- | --- |
| edits | 0 | **13** |
| looks | 0 | 3 |
| segment cuts | 1 | 9 |
| peak prompt | 27,120 | 5,963 |
| `finish_reason=length` | 36 | 0 |
| result | nothing built | a castle, build clean |

The compaction did what it was designed to do once it was allowed to run: nine cuts, every one
between 4,065 and 5,963 tokens, and the prompt never grew past the budget across sixty steps. The
handovers stayed coherent to the end — the last one reads *"Built a castle with a central stone
keep, four corner towers, and perimeter walls. Added a wooden gate. The walls and towers currently
lack crenellations… the single next thing to do is add crenellations."* That is a model that knows
where it is after nine restarts.

**And the Unity size trap survived all of it.** Fourth run, same error: the corner towers are
`cylinder` at `scale="y: 6"` — twelve units tall, spanning −3 to 9 — with their cone roofs placed
at `y: 6`. The cones are *inside* the towers, invisible, which is why the castle has none. The
model has now got this wrong with the primitives as node tags and as geometry documents, with the
sizes in a doc comment, in `describe`, and in a table at the top of the file it was editing.
§14 stands, and it is the one finding here that no amount of harness work will touch.

---

# Round six: opencode, measured

Same model, same task, same editor MCP as eyes, same fifteen-minute cap, run one after the other
because two 26B contexts do not fit on one 24 GB machine.

| | this harness | opencode (default) | opencode (lean) | opencode (lean, 7k window) |
| --- | --- | --- | --- | --- |
| floor before any work | **~230** | 10,075 | 5,630 | 5,630 |
| peak prompt | 5,963 | 13,377 | 13,377 | 5,839 |
| edits | **13** | 0 | 0 | 0 |
| looks | 3 | 0 | 0 | 0 |
| wall time | 740s | 15s | 418s | 900s (capped) |
| how it ended | a castle, build clean | OOM on request 2 | 4 × `write` missing a required argument | 48 identical reads of one file |

## 24. Where opencode's ten thousand tokens go

Measured by ablation — one tool group at a time, reading `prompt_tokens` off the server:

| | prompt | added |
| --- | --- | --- |
| opencode framing + environment, no tools, no `AGENTS.md` | 965 | — |
| + this repo's `AGENTS.md` (7.5 KB) | 2,343 | **+1,378** |
| + `read` | 2,724 | +381 |
| + `edit`, `write` | 3,359 | +635 |
| + `bash`, `glob`, `grep` | 5,315 | **+1,956** |
| + the two scenoco MCP tools | 5,564 | +249 |
| the default `build` agent, everything on | 10,075 | **+4,445** |

Three things pay for that ten thousand: an environment block, a project's own `AGENTS.md`
injected verbatim into every request, and tool descriptions written to be unambiguous — `bash`,
`glob` and `grep` together cost nearly two thousand tokens, and the tools the default agent adds
on top (`task`, `todowrite`, `webfetch`, `lsp`, `skill`, `question`, `apply_patch`) cost another
four and a half.

**None of it is waste on the model opencode was built for.** On a 200k window, 10k of preamble is
five per cent, and it buys real things: a tool description long enough that the model does not
misuse it, a todo list that keeps a long task coherent, an environment block that stops work
happening in the wrong directory. The arithmetic only turns hostile when the usable window is
6,000 rather than 200,000 — then the same preamble is the whole budget, and there is nothing left
to put the work in.

## 25. The rule that follows

Both failures are the same failure at different ends.

At a 32k limit opencode never compacts, the prompt climbs to 13,377, and the model stops emitting
valid tool calls — four `write` calls in a row missing a required argument. That is not a schema
problem: **the same argument name (`filePath`, opencode's own) works fine in this harness**, 2/2
tasks and four clean edits, because there the prompt never exceeds 6k. Tested and falsified before
it went in this document.

At a 7k limit opencode compacts almost every turn, because a 5,630 floor leaves 1,400 of working
room and one file read fills it. Forty-eight identical reads of the same file in fifteen minutes.
Its compaction itself is good — the summary it wrote is well-structured and the prompt dropped
from 5,839 to 1,581 — it simply never got a turn long enough to use it.

So the rule for a small local model is not "compact harder". It is:

> **floor + one working step must fit inside the window where the model still writes valid tool
> calls.**

For this model that window is about six thousand tokens with a quantized KV cache. One working
step — read the file you are editing, make the edit, see the diagnostic — is around 1,500. So the
floor has to be under about three thousand, and opencode's is 5,630 at its leanest.

**What to do about it, in the order the levers are worth pulling:**

1. **Quantize the KV cache.** `--kv-bits 4 --quantized-kv-start 256` took the exact 6,352-token
   request that had aborted the Metal allocator twice and ran it without complaint. This corrects
   §15: the ceiling was a property of an unquantized cache, not of the machine.
2. **Do not put an `AGENTS.md` where a small model will read it.** 1,378 tokens on *every*
   request, for a document written for a frontier agent.
3. **Cut the tool surface to what the task needs.** `bash` alone is most of two thousand tokens;
   a run that has a compiler wired into its gate does not need a shell.
4. **Make the tools answer instead of dumping.** `describe` costs 40 tokens and replaces a file
   read; a ranged read costs a fifth of a whole one. This is what keeps a working step at 1,500
   rather than 4,000.
5. **Only then set the context limit** — and set it to the window the model actually works in,
   not the one the model card advertises.

The uncomfortable conclusion for the earlier recommendation: opencode has the better *mechanisms*
— media in tool results, provider-aware transforms, a compaction summary better than mine — and it
cannot use them here, because its floor does not leave room for the work. That is a fixable
configuration problem on a 100k-window model and an unfixable one at 6k.

---

# Round seven: create, review, decide

One agent told to "build it and keep fixing it until it looks right" wanders — measured in §16,
where more turns produced a worse castle. So the loop was split into three phases, each its own
conversation, each carrying only its own tools:

| | writes? | sees? | tools | what it is asked |
| --- | --- | --- | --- | --- |
| **create** | yes | no | the file tools, no `look` | one instruction, not the whole job |
| **review** | no | yes | none | what is wrong with this? |
| **decide** | no | no | none | DONE, or the single next change |

The split is not tidiness. A phase's floor is its tool schemas, and the measured constraint on
this model is a usable window near six thousand tokens (§24). **Review is the phase that holds
the picture and it holds nothing else** — no file contents, no edit history, no tool schemas — so
the image lands in an empty window, which is exactly where the vision ceiling wants it. Peak
prompt across a six-round run: 5,007.

## 26. Four bugs the phases made visible

Each of these was invisible in the single-loop runs, and each took one run to find once the
phases had separated the concerns.

**A round that edits is not a round that changes anything.** The first phased run made eight
edits across two rounds and rendered **byte-identical pictures** — verified against the editor by
adding a cube (hash changed) and reverting it (hash changed back), so the eyes were fine. The
finish condition keyed on edit count could not see it. It is keyed on the render hash now: the
picture is what is being judged, so the picture is what has to move.

**The handover could not name the file a round was about.** It carried "the file this run has
edited most", and a round that has not edited anything *yet* has no history to point at — so the
round that most needed the file after a cut was guaranteed not to get it. The ledger takes a
declared focus file now.

**An edit refused for four characters.** Round two sent three lines to `edit_file`, two of them
character-perfect, the first `  <!-- South wall` where the file said `  <!-- South wall -->`. It
then sent the identical snippet twice more, because *"copy the text exactly"* is not advice a
model can act on when it believes it already did. `splice` has a third pass: if every line of the
snippet is a prefix of the file's line and exactly one place matches, take it. Round two went from
0 edits and 6 refusals to 1 edit in 4 steps.

> I diagnosed this wrong twice — first as ambiguity between the nine identical `<Mesh` openings,
> then as a stale handover. Both were real problems and neither was this one. What settled it was
> logging the refusal *reason* and replaying the round with the exact prompt. Three rounds of
> guessing, one round of instrumenting.

**A round could hand the next one a project that does not compile.** One wrote
`material="../materials/wood.material-xml"` — a hyphen for a dot — and ran out of steps two edits
later. Now a failing build gets a four-step repair pass with the diagnostic as its only brief, and
if that fails the round is reverted to its own starting snapshot. "It compiles between rounds" is
an invariant rather than an ending; the `broken` ending is unreachable by construction.

## 27. Iteration needs a ratchet

With all four fixed, the loop ran six clean rounds, 18 edits, every round changing the scene, the
reviewer naming specific and *different* faults each time — "the gate is a flat plane passing
through the wall", "the tower is passing through the keep". Real observations about geometry,
which is what splitting review out was for.

**And the castle got worse every round after the second.** By round six it was towers the size of
the sky, low walls, and a gate floating as a slab.

The chain is visible in the transcript. The reviewer judges in **relatives** — "much wider than
the keep", "much smaller than the walls". The judge turns those into relative instructions —
"scale the tower to be narrower than the keep". The creator applies them by guessing a multiplier,
having no absolute model of how big anything is. Each fix over-corrects, the next round sees the
over-correction, and it swings back. §16 observed this; the phases explain it.

So the loop keeps the best version rather than the last. Each round's render is compared against
the incumbent — *a comparison, not a score*, because asked to rate one picture a small model says
something plausible about everything, and asked which of two is closer it answers the question in
front of it. Ties and refusals keep the incumbent, so a change has to earn its place.

```
round 1  compare: better — kept
round 2  compare: better — kept
round 3  compare: worse than round 2 — will be put back
round 4  compare: worse than round 2
round 5  compare: worse than round 2
round 6  compare: worse than round 2
put back round 2, which was the best of them
```

That is the finding worth carrying: **for a model this size, the ability to change things is not
the same as the ability to improve them.** Create/review/decide supplies the first. Only the
ratchet supplies the second — and without it, every round of "fixing" is a random walk with a
plausible-sounding justification attached.

**And the size trap survives, fifth run running.** The corner towers are still `cylinder` with
`scale="y: …"` read as height, so their cone roofs sit inside them; the keep's cone is half-sunk
into the keep. §14 is untouched by any of this, and it is the one thing here that tooling cannot
reach.
