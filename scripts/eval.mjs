// End-to-end evals: talks to the running app over HTTP exactly like a user, then checks each answer
// with hard checks (memory status, searches, citations, latency) and an LLM judge (Haiku) against
// a plain-English rubric.
//
//   npm run dev            # in one terminal
//   npm run eval           # in another (optional: npm run eval -- http://localhost:3000)
//
// Uses its own anonymous users (cookies), so it never touches your own chats.

import fs from "node:fs";

// Options: a base URL, --only <text> to run matching cases, --verbose to print answers.
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const VERBOSE = flag("--verbose");
const BASE = args.find((a) => a.startsWith("http")) ?? process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const TZ = "Asia/Kolkata";
const LOCALE = "en-IN";
const env = loadEnv([".env.local", ".env"]);
const JUDGE_MODEL = env.FAST_MODEL || "claude-haiku-5-5";

// ---------------------------------------------------------------------------------------------
// Cases. "seeded" = a user who loaded the demo chats (CRM shortlist on Monday, Postgres on the
// Tuesday of the week before); "fresh" = a brand-new user with no history.

const CASES = [
  {
    id: "brief: CRM changed since Monday",
    user: "seeded",
    turns: ["On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"],
    expect: { memory: "found", minQueries: 5, cites: true },
    rubric:
      "Identifies the Monday shortlist (HubSpot, Salesforce, Pipedrive, Zoho, Attio). Gives each of the five tools a status (changed / unchanged / couldn't verify / correction) backed by citations, and says whether anything big shipped since Monday.",
  },
  {
    id: "brief: 3 November, still correct?",
    user: "seeded",
    turns: ["What did I ask you on 3 November? Is your answer still correct today?"],
    expect: { memory: "found", minQueries: 3, cites: true },
    rubric:
      "States that on Tuesday 3 November the user asked to compare Postgres hosting (Neon, Supabase, Railway). Re-checks each fact with sources and gives a clear status per fact.",
  },
  {
    id: "brief: last Tuesday, Postgres pricing",
    user: "seeded",
    turns: ["Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"],
    expect: { memory: "found", minQueries: 3, cites: true },
    rubric:
      "Finds the Postgres hosting conversation and says which Tuesday it means (3 November). Compares each provider's price then vs now, with citations.",
  },
  {
    id: "numeric date 9-11-26 (en-IN)",
    user: "seeded",
    turns: ["What did we talk about on 9-11-26?"],
    expect: { memory: "found" },
    rubric:
      "Reads 9-11-26 as Monday 9 November 2026 and says the user asked for a CRM shortlist for a 20-person sales team. Does not invent other topics.",
  },
  {
    id: "no record on that day",
    user: "seeded",
    turns: ["What did I ask you on 5 November?"],
    expect: { memory: "not_found" },
    rubric:
      "Says clearly there is no conversation on Thursday 5 November and does not invent one. May mention the nearest conversations (3 November Postgres, 9 November CRM).",
  },
  {
    id: "fresh fact question",
    user: "seeded",
    turns: ["What is the latest stable version of Node.js?"],
    expect: { memory: "none", minQueries: 1, cites: true },
    rubric: "Gives a specific current Node.js version, with a citation, and doesn't hedge needlessly.",
  },
  {
    id: "small talk",
    user: "seeded",
    turns: ["thanks, that's all for now!"],
    expect: { memory: "none", maxQueries: 0 },
    rubric: "A short, friendly reply. No research dump.",
  },
  {
    id: "follow-up resolves 'those two'",
    user: "seeded",
    turns: ["Compare the free tiers of Vercel and Netlify in two sentences.", "Which of those two gives more bandwidth for free?"],
    expect: { memory: "none", cites: true },
    rubric:
      "The final answer understands 'those two' as Vercel and Netlify and names which free tier has more bandwidth, with specific numbers and a citation.",
  },
  {
    id: "fresh install: CRM question",
    user: "fresh",
    turns: ["On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"],
    expect: { memory: "not_found" },
    rubric:
      "Says it has no record of the Monday shortlist and does NOT invent which five tools were chosen or what it said before. Still helps: gives a useful current snapshot of CRM pricing changes or launches (or clearly does a quick check), and asks which five tools to compare exactly.",
  },
  {
    id: "fresh install: Postgres (no false match)",
    user: "fresh",
    turns: ["Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"],
    expect: { memory: "not_found" },
    rubric:
      "Says it has no record of a Postgres conversation. Does not claim to have found one and does not invent earlier prices. Gives a useful current snapshot of managed Postgres pricing and asks for specifics.",
  },
];

// What the demo loader stores (src/memory/demo.ts), so the judge can tell recall from invention.
const SEEDED_HISTORY = `- Monday (most recent), 10:15: user asked for a 5-tool CRM shortlist for a 20-person sales team. Assistant listed HubSpot Sales Hub Professional $100/seat, Salesforce Pro Suite $100/user, Pipedrive Advanced $39/seat, Zoho CRM Professional $23/user, Attio Pro $34/seat (annual), roughly $460-$2,000/month for 20 seats.
- Tuesday of the week before, 11:40: user asked to compare Postgres hosting (Neon, Supabase, Railway) and which is cheapest to start. Assistant said Neon Launch $19/month, Supabase Pro $25/month per project, Railway Hobby $5/month then usage-based; Railway cheapest to start, Neon best for branching.
- 16 days ago: a question about a laptop for machine learning under $2,000.`;

// ---------------------------------------------------------------------------------------------

const users = { seeded: { cookie: "" }, fresh: { cookie: "" } };

async function post(user, path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(user.cookie ? { cookie: user.cookie } : {}) },
    body: JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) user.cookie = set.split(";")[0];
  return res;
}

/** Sends one message and reads the stream: answer text, memory status, searches, first-word latency. */
async function ask(user, conversationId, text) {
  const started = Date.now();
  const res = await post(user, "/api/chat", { conversationId, message: { text }, timeZone: TZ, locale: LOCALE });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let raw = "";
  let firstWordMs = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
    if (firstWordMs === null && raw.includes('"type":"text-delta"')) firstWordMs = Date.now() - started;
  }
  let answer = "";
  let memory = "none";
  let queries = 0;
  let error = null;
  const sources = new Map();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: {")) continue;
    const ev = JSON.parse(line.slice(6));
    if (ev.type === "text-delta") answer += ev.delta;
    if (ev.type === "data-memory" && ev.data.state === "done") memory = ev.data.status;
    if (ev.type === "data-search" && ev.data.state === "input-available") queries += ev.data.input.queries.length;
    if (ev.type === "tool-input-available") queries += ev.input?.queries?.length ?? 0;
    const results = (ev.type === "data-search" ? ev.data?.output : ev.type === "tool-output-available" ? ev.output : null)?.results;
    for (const s of results ?? []) sources.set(s.n, s);
    if (ev.type === "error") error = ev.errorText;
  }
  // What the user sees under the answer: only the sources its [n] citations point at.
  const cited = new Set([...answer.matchAll(/\[(\d{1,3})\](?!\()/g)].map((m) => Number(m[1])));
  const sourceList = [...sources.values()]
    .filter((s) => cited.has(s.n))
    .sort((a, b) => a.n - b.n)
    .map((s) => `[${s.n}] ${s.title} (${s.domain}${s.published ? `, ${s.published}` : ""})`)
    .join("\n");
  return { answer: answer.trim(), sourceList, memory, queries, error, firstWordMs, totalMs: Date.now() - started };
}

async function judge(c, transcript, answer, sourceList) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 1000,
      thinking: { type: "disabled" }, // a short verdict; default thinking used up the budget and returned nothing
      system:
        "You grade a chat assistant's final answer against a rubric. Grade ONLY the rubric's requirements: don't fail an answer for issues the rubric doesn't mention. " +
        "Today is the date the assistant states; a source published earlier can still back a current fact. Be strict about the rubric, lenient about wording. " +
        'Reply with JSON only: {"pass": true|false, "reason": "<one sentence>"}',
      messages: [
        {
          role: "user",
          content:
            `Rubric: ${c.rubric}\n\n` +
            (c.user === "seeded" ? `The user's stored chat history (the assistant can see it):\n${SEEDED_HISTORY}\n\n` : "The user has NO stored chat history.\n\n") +
            `Conversation:\n${transcript}\n\nFinal answer to grade:\n${answer}\n\n` +
            `Sources shown to the user under the answer (what the [n] citations link to):\n${sourceList || "(none)"}`,
        },
      ],
    }),
  });
  if (!res.ok) return { pass: false, reason: `judge error ${res.status}` };
  const data = await res.json();
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return { pass: false, reason: `unparseable judge output: ${text.slice(0, 80)}` };
  }
}

function hardChecks(expect, r) {
  const fails = [];
  if (r.error) fails.push(`error: ${r.error}`);
  if (expect.memory && r.memory !== expect.memory) fails.push(`memory ${r.memory} ≠ ${expect.memory}`);
  if (expect.minQueries !== undefined && r.queries < expect.minQueries) fails.push(`${r.queries} queries < ${expect.minQueries}`);
  if (expect.maxQueries !== undefined && r.queries > expect.maxQueries) fails.push(`${r.queries} queries > ${expect.maxQueries}`);
  if (expect.cites && !/\[\d+\]/.test(r.answer)) fails.push("no citations");
  return fails;
}

// ---------------------------------------------------------------------------------------------

if (!env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not found in .env.local or .env (needed for the judge).");
  process.exit(1);
}
try {
  await fetch(BASE);
} catch {
  console.error(`Can't reach ${BASE}. Start the app first: npm run dev`);
  process.exit(1);
}

await post(users.seeded, "/api/demo", { timeZone: TZ });

const rows = [];
for (const c of CASES.filter((c) => !ONLY || c.id.includes(ONLY))) {
  const user = users[c.user];
  const conversationId = `conv_eval${Math.random().toString(36).slice(2, 14).replace(/[^a-z0-9]/g, "x")}`;
  let transcript = "";
  let r;
  try {
    for (const turn of c.turns) {
      r = await ask(user, conversationId, turn);
      transcript += `User: ${turn}\nAssistant: ${r.answer}\n\n`;
    }
  } catch (e) {
    r = { answer: "", memory: "none", queries: 0, error: e.message, firstWordMs: null, totalMs: 0 };
  }
  const fails = hardChecks(c.expect, r);
  const verdict = await judge(c, transcript, r.answer, r.sourceList);
  if (VERBOSE) console.log(`\n----- ${c.id}\n${r.answer}\n`);
  const pass = fails.length === 0 && verdict.pass === true;
  rows.push({ id: c.id, pass, fails, verdict, ...r });
  const secs = (ms) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)}s`);
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${c.id.padEnd(42)} first word ${secs(r.firstWordMs).padStart(5)} · total ${secs(r.totalMs).padStart(5)} · memory=${r.memory} · queries=${r.queries}` +
      (fails.length ? `\n      hard checks: ${fails.join("; ")}` : "") +
      `\n      judge: ${verdict.reason}`,
  );
}

const passed = rows.filter((r) => r.pass).length;
const firstWords = rows.map((r) => r.firstWordMs).filter((x) => x !== null).sort((a, b) => a - b);
const pct = (p) => firstWords[Math.min(firstWords.length - 1, Math.floor((p / 100) * firstWords.length))];
const summary = `${passed}/${rows.length} passed · first word p50 ${(pct(50) / 1000).toFixed(1)}s, p90 ${(pct(90) / 1000).toFixed(1)}s`;
console.log(`\n${summary}`);

// A markdown report next to the code, so results are reviewable in the repo.
fs.mkdirSync("evals", { recursive: true });
fs.writeFileSync(
  "evals/latest.md",
  `# Latest eval run\n\n${new Date().toISOString()} · ${BASE} · judge: ${JUDGE_MODEL}\n\n**${summary}**\n\n` +
    "| Case | Result | First word | Total | Memory | Queries | Judge |\n|---|---|---|---|---|---|---|\n" +
    rows
      .map(
        (r) =>
          `| ${r.id} | ${r.pass ? "✅" : "❌"} | ${r.firstWordMs === null ? "–" : (r.firstWordMs / 1000).toFixed(1) + "s"} | ${(r.totalMs / 1000).toFixed(1)}s | ${r.memory} | ${r.queries} | ${(r.fails.length ? r.fails.join("; ") + ". " : "") + r.verdict.reason.replace(/\|/g, "/")} |`,
      )
      .join("\n") +
    "\n",
);
process.exit(passed === rows.length ? 0 : 1);

function loadEnv(files) {
  const out = { ...process.env };
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m || out[m[1]]) continue;
      let value = m[2].trim();
      if (/^["']/.test(value)) value = value.slice(1, value.indexOf(value[0], 1));
      else value = value.replace(/\s+#.*$/, "");
      if (value) out[m[1]] = value;
    }
  }
  return out;
}
