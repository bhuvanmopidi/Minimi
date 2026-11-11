// Single place that reads environment variables, so missing config fails loudly and early.

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

function parseEffort(value: string | undefined): "low" | "medium" | "high" | undefined {
  const v = value?.trim().toLowerCase();
  return v === "low" || v === "medium" || v === "high" ? v : undefined;
}

export const config = {
  mainModel: optional("MAIN_MODEL", "claude-sonnet-5-5"),
  fastModel: optional("FAST_MODEL", "claude-haiku-5-5"),
  databasePath: optional("DATABASE_PATH", "./data/minimi.db"),
  mockNow: process.env.MOCK_NOW?.trim() || undefined,
  // Optional at startup: without it the search tool reports "not configured" and the agent says so.
  tavilyApiKey: process.env.TAVILY_API_KEY?.trim() || undefined,
  // Max model steps per turn (each search + read is one step). Caps latency and cost.
  maxSteps: 5,
  // Hard limit for one turn (planning + searches + answer); the partial answer is kept.
  turnTimeoutMs: 90_000,
  // Main model's reasoning effort (low | medium | high). Lower = faster first word; see ADR-0012 §4.
  mainEffort: parseEffort(process.env.MAIN_EFFORT) ?? "medium",
  // How many recent messages of the current conversation go to the model verbatim.
  recentTurnLimit: 12,
};
