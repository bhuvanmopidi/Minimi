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

export const config = {
  mainModel: optional("MAIN_MODEL", "claude-sonnet-5-5"),
  fastModel: optional("FAST_MODEL", "claude-haiku-5-5"),
  databasePath: optional("DATABASE_PATH", "./data/minimi.db"),
  mockNow: process.env.MOCK_NOW?.trim() || undefined,
  // How many recent messages of the current conversation go to the model verbatim.
  recentTurnLimit: 12,
};
