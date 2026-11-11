import { APICallError, RetryError } from "ai";

/**
 * Turn a model/provider error into a message the user can act on. Details stay in the server log;
 * the browser gets a short, honest explanation (and the UI offers Retry).
 */
export function friendlyError(error: unknown): string {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode;
    if (status === 429) return "Claude is rate-limited right now. Wait a few seconds and press Retry.";
    if (status === 529 || status === 503) return "Claude is overloaded at the moment. Press Retry in a few seconds.";
    if (status === 401 || status === 403) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.";
    if (status && status >= 500) return "Claude had a temporary server error. Press Retry.";
  }
  const name = (cause as Error | undefined)?.name ?? "";
  if (name === "TimeoutError") return "That took too long and was stopped. Press Retry, or ask a narrower question.";
  return "Something went wrong while generating the answer. Press Retry.";
}
