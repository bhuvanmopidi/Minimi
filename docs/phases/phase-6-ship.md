# Phase 6: Fresh-install fixes, evals, DESIGN.md

**Goal:** make the submission complete and trustworthy: check the agent against the brief as a reviewer
would use it, add end-to-end evals, write the one-page `DESIGN.md`, and verify `npm install && npm run dev`
from a fresh clone. Design: [ADR-0015](../decisions/0015-fresh-install-and-evals.md).

## Checked against the brief
| Brief | Status |
|---|---|
| One tool: web search | ✅ `web_search` is Sonnet's only tool; memory and planning are orchestration |
| The three example questions | ✅ with history; ✅ honest + helpful on a fresh install |
| Fast / right / good to talk to | measured below |
| TypeScript on Node; `npm install` → `npm run dev`; keys in `.env.example` | ✅ (fresh-clone test below) |
| `DESIGN.md`, one page | ✅ [DESIGN.md](../../DESIGN.md) |

## What was built or changed
| File | Change |
|---|---|
| [src/memory/retrieval.ts](../../src/memory/retrieval.ts) | Without a date, ≥2 distinct keywords must match; question words aren't keywords |
| [src/agent/planner.ts](../../src/agent/planner.ts) | Re-checks always include 1–2 general news searches |
| [src/agent/prompts.ts](../../src/agent/prompts.ts) | No record → one sentence, then a fresh snapshot, then ask |
| [scripts/eval.mjs](../../scripts/eval.mjs) | `npm run eval`: 10 black-box cases, hard checks + LLM judge, writes `evals/latest.md` |
| [DESIGN.md](../../DESIGN.md) | The one-page design |
| [tests/retrieval.test.ts](../../tests/retrieval.test.ts) | 3 regression tests for the false-match bug (106 tests in total) |

## Results
- `npm test`: 106/106. `npm run typecheck`: clean.
- `npm run eval`: **9/10, first word p50 5.0 s, p90 18.8 s** ([evals/latest.md](../../evals/latest.md)).
  - The failing case ("last Tuesday" with history) was judged as not sourcing the *old* prices, which
    come from the stored chat. Reported as-is.
  - The slow tail (CRM 18.8 s, Node.js 12.9 s) is when Sonnet searched a second time (`steps=2` in the
    `[turn]` log). The other turns produce their first word 1–3.5 s after the searches finish.
- Fresh install, brief questions in a row: correct `not_found` each time (no false matches), with a snapshot + question.
