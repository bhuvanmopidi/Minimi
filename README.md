# Minimi Chat

A chat agent with one tool, **web search**, that also remembers past conversations and can answer
questions like *"Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"*

Built for the Minimi hiring challenge. It's built phase by phase, and each phase is documented.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev                  # http://localhost:3000
```

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude models (answers, planning, extraction) |
| `TAVILY_API_KEY` | yes | Web search ([free tier](https://app.tavily.com/)). Without it the agent still runs but says it can't check the web |
| `MAIN_MODEL` | no | Defaults to `claude-sonnet-5-5` |
| `FAST_MODEL` | no | Defaults to `claude-haiku-5-5` |
| `DATABASE_PATH` | no | Defaults to `./data/minimi.db` (created automatically) |
| `MOCK_NOW` | no | Freeze "now" for testing date questions, e.g. `2026-11-11T10:00:00Z` |

Other scripts: `npm test` (unit tests), `npm run typecheck`.

## Documentation

| Doc | What it answers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How one message flows through the system, stage by stage, with the data at each step |
| [docs/decisions/](docs/decisions/README.md) | Every design decision: the options we weighed, what we chose, and why |
| [docs/phases/](docs/phases/README.md) | What each build phase delivered, how it was checked, and any changes from the plan |
| `DESIGN.md` | The one-page summary required by the challenge (written in Phase 6) |

## Project layout

```
src/app/            Next.js pages and API routes (api/chat = the agent endpoint)
src/agent/          prompts, and later the planner, orchestrator and claim extraction
src/tools/          the web_search tool and the Tavily client
src/memory/         SQLite database, migrations, repository functions
src/time/           clock (MOCK_NOW), and later date parsing and validation
src/components/     chat UI
tests/              vitest unit tests
docs/               architecture, decision records, phase logs
```
