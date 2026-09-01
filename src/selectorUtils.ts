/**
 * Playwright's Locator.describe(text) bakes the description into the selector
 * string itself, appending: `>> internal:describe="<json-escaped text>"`.
 * This extracts that developer-provided description, if present, so it can be
 * passed to the LLM as ground-truth intent for healing.
 */
export function extractElementDescription(selector: string): string | null {
  if (!selector) return null;

  const match = selector.match(/internal:describe=("(?:[^"\\]|\\.)*")/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}
