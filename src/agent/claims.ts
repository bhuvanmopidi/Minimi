import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import type Database from "better-sqlite3";
import { z } from "zod";
import { config } from "@/config";
import { insertClaims, type Claim } from "@/memory/repo";
import type { Source } from "@/tools/webSearch";

// The claims ledger (ADR-0006): after an answer is saved, Haiku lists the checkable facts it asserted,
// so a later "has it changed?" compares against an exact list instead of re-reading old prose.
// Runs in the background: the user never waits for it.

const EXTRACT_TIMEOUT_MS = 20_000;
const MAX_CLAIMS = 15;

const ClaimsSchema = z.object({
  claims: z
    .array(
      z.object({
        entity: z.string().describe("the product, company, person or thing, e.g. 'Neon'"),
        attribute: z.string().describe("the specific property, e.g. 'Launch plan price'"),
        value: z.string().describe("the value exactly as stated, with units, e.g. '$19/month'"),
        source: z.number().int().optional().describe("the citation number [n] that backs it, if any"),
      }),
    )
    .describe("checkable facts, at most 15"),
});

type RawClaims = z.infer<typeof ClaimsSchema>;
export type GenerateClaims = (system: string, prompt: string, signal: AbortSignal) => Promise<RawClaims>;

const SYSTEM = `You extract the checkable facts an assistant's answer stated as true at the time, so they can be re-checked later.

Include: prices, plans and what they include, limits, version numbers, release or launch dates, availability, who holds a role, rankings, and other facts that can change.
Exclude: opinions and recommendations, general knowledge that doesn't change, and anything the answer itself says is outdated or unverified.
One fact per row, with the value exactly as written (keep units and billing terms). If the answer has no such facts, return an empty list.`;

const defaultGenerate: GenerateClaims = async (system, prompt, signal) => {
  const { object } = await generateObject({
    model: anthropic(config.fastModel),
    schema: ClaimsSchema,
    system,
    prompt,
    abortSignal: signal,
  });
  return object;
};

/**
 * Extract claims from an answer. Only answers backed by web sources are processed: the ledger
 * stores facts we can point to evidence for, not the model's unsourced memory.
 */
export async function extractClaims(
  answer: string,
  sources: Source[],
  generate: GenerateClaims = defaultGenerate,
): Promise<Claim[]> {
  if (!sources.length) return [];
  const sourceList = sources.map((s) => `[${s.n}] ${s.title} (${s.domain}${s.published ? `, ${s.published}` : ""})`).join("\n");
  const raw = await generate(
    SYSTEM,
    `Sources the answer cites:\n${sourceList}\n\nAnswer:\n${answer}`,
    AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
  );

  const byN = new Map(sources.map((s) => [s.n, s]));
  return raw.claims
    .filter((c) => c.entity.trim() && c.attribute.trim() && c.value.trim())
    .slice(0, MAX_CLAIMS)
    .map((c) => {
      const source = c.source !== undefined ? byN.get(c.source) : undefined;
      return {
        entity: c.entity.trim(),
        attribute: c.attribute.trim(),
        value: c.value.trim(),
        sourceUrl: source?.url ?? null,
        sourceDate: source?.published ?? null,
      };
    });
}

/** Fire-and-forget: extract and store. Failures are logged, never shown to the user. */
export function recordClaimsInBackground(
  db: Database.Database,
  messageId: string,
  answer: string,
  sources: Source[],
  assertedAt: string,
): void {
  extractClaims(answer, sources)
    .then((claims) => {
      if (claims.length) insertClaims(db, messageId, claims, assertedAt);
    })
    .catch((error) => console.error("[claims] extraction failed:", (error as Error).message));
}
