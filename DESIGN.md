# Design

## The problem, as I read it
The brief's examples aren't really search questions. They are **memory questions anchored in time**:
find what we said on a given day, check it against the web today, and say what changed. So the agent is
built around three things: dates worked out by code, recall across conversations, and a structured
**ledger of what it claimed**. Web search is its one tool.

## How it works
```
message ─► date candidates (chrono-node, code) ─► planner (Haiku, ONE JSON call) ─► validate dates (code)
        ─► history (SQLite FTS5 + claims ledger) ─► searches start before the answer (Tavily, parallel)
        ─► Sonnet answers, streaming. web_search is its only tool (≤5 steps)
        ─► background: extract claims from the answer (Haiku), update a rolling summary
```
- **Plan, then execute.** One fast call decides intent, whether past chats are needed, what to search
  and what each date means. Code then runs the history lookup and the searches in parallel. Sonnet keeps
  a small ReAct loop only for follow-up searches.
- **Memory is orchestration, not a tool.** History is fetched and placed in the model's context.
  "No conversation that day" is passed as an explicit fact, so the model never invents a past chat.
  With no record, it says so, gives a fresh snapshot, and asks for the specifics.
- **Dates: code proposes, LLM picks, code validates.** chrono-node reads dates by locale (`3-10-26` is
  3 Oct in en-IN, 10 Mar in en-US). The planner may only pick or reject what code parsed; it writes its
  own date only for phrases code can't read ("the day we discussed CRMs"), and code checks those
  (a real date, in the past, weekday matches a calendar it's given). Ambiguity ("last Tuesday") is settled
  by searching history for both readings, and the reply always says the date in words.
- **Claims ledger.** After each answer that cites sources, Haiku records its facts (entity · attribute ·
  value · source · date). A re-check searches each recorded fact and labels it *Changed / Unchanged /
  Couldn't verify / Correction*. That's how the agent knows the five CRM tools from Monday without being told.
- **Plumbing.** The server owns history (the client sends only the new message). SQLite + FTS5, zero setup.
  Anonymous per-browser cookie. Stop really stops; Retry replaces the partial answer; long chats get a
  rolling summary; the static system prompt is prompt-cached.

## Why this shape
- **Fast:** one cheap planning call instead of a chain of tool round-trips; searches start before the answer;
  ~1.9k cached prompt tokens per turn; reasoning effort `medium`. Measured: the model's default thinking
  added 6–8 s before the first word.
- **Right:** dates by code, explicit "not found", facts compared one by one, and citations numbered by a
  per-turn registry so `[3]` always points at the page the model actually read.
- **Good to talk to:** streaming with live status ("Checking your conversations from Tuesday 3 November…"),
  tables and citation chips, honest "I have no record of that".

## Measured
`npm run eval` runs 10 end-to-end cases over HTTP (the brief's three examples on seeded history *and* on a
fresh install, numeric and ambiguous dates, no-record, follow-ups, small talk), with hard checks plus an
LLM judge. **9/10 pass. First word p50 5.0 s, p90 18.8 s.** The slow tail is when Sonnet decides the early
search results aren't enough and searches again. Latest run: [evals/latest.md](evals/latest.md).

## Considered and rejected
- **A ReAct agent with a `recall_history` tool:** breaks "one tool" and costs 2–3 sequential round-trips.
- **Regex triggers for "needs history":** brittle and duplicates the planner. The planner alone decides.
- **Dates by code only, or by LLM only:** code can't read fuzzy dates; LLMs slip on weekday arithmetic.
- **Embeddings / a vector DB:** a third API key; recall here is about product names and dates, where
  keywords work. Without a date, at least two keywords must match (one generic word caused false matches).
- **Comparing against old prose:** labelled the same fact differently across runs. Replaced by the ledger.
- **Searching speculatively while the planner runs:** spends a search on every message, including "hi".
- **The Tavily SDK:** a zod version conflict; a 50-line `fetch` client gives full control.

## With another week
- **The slow tail:** start writing from the early search results while any extra search runs; filter
  low-relevance results (news searches sometimes return unrelated headlines).
- **Proactive memory:** "Neon is $15 now; on 3 Nov I told you $19", even when not asked (a ledger lookup by entity).
- **Fuzzier recall** ("that database thing"): embeddings as a second ranking signal next to FTS.
- **Evals in CI** with more cases (locales, multi-turn, adversarial dates) and recorded search results,
  so runs are deterministic.
- Real accounts instead of a cookie; Postgres for multi-instance deploys.

More detail: [docs/architecture.md](docs/architecture.md) (the flow, stage by stage) and
[docs/decisions/](docs/decisions/README.md) (15 decision records with the options weighed).
