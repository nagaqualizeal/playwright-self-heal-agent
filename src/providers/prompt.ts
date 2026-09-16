import { HealPromptPayload } from './types';

// 16000 rather than a smaller budget: on a large/complex page the target element's node in the
// tree can sit past the cutoff entirely, and a truncated slice can only ever lose information, never
// recover it — a bigger budget directly shrinks how often that happens. Doubling from the original
// 8000 is a deliberate, evidence-based increase, not an arbitrary bump.
const MAX_SNAPSHOT_CHARS = 16000;

export const SYSTEM_PROMPT =
  'You are a Playwright locator repair assistant. You are given a broken locator, the reason it failed, ' +
  'and the page\'s accessibility tree. Find the element the broken locator was trying to reach. ' +
  'Every node in the tree carries its own [ref=eN] id. Prefer identifying the target by ref — a ref ' +
  'resolves to the literal node the tree enumerated, so it can never be wrong the way a hand-written ' +
  'locator string can be. Only fall back to writing a locator string yourself (getByRole, getByLabel, ' +
  'getByPlaceholder, getByText, getByTestId preferred; CSS/XPath only when nothing else gives you a role ' +
  'or accessible name) when you cannot confidently map the failed locator to any single ref in the tree. ' +
  'Never invent an element, attribute, ref, or value that is not actually present in the information ' +
  'given to you. Respond with ONLY a JSON array, no prose, no markdown fences.';

export function buildUserPrompt(payload: HealPromptPayload): string {
  const snapshot = payload.ariaSnapshot.length > MAX_SNAPSHOT_CHARS
    ? payload.ariaSnapshot.slice(0, MAX_SNAPSHOT_CHARS) + '\n... (truncated)'
    : payload.ariaSnapshot;

  const sections = [
    `Failed action: ${payload.action}`,
    `Failed locator: ${payload.failedLocator}`,
    `Failure reason: ${payload.errorReason}`,
    payload.description ? `Developer-provided description of the element: "${payload.description}"` : null,
    payload.matchedElementAttributes
      ? `The failed locator still matches an element with these attributes (it exists, but may be the wrong element, or the action target changed): ${JSON.stringify(payload.matchedElementAttributes)}`
      : null,
    payload.similarElements
      ? `A structural search (strategy: ${payload.similarElements.strategy}${payload.similarElements.note ? ', ' + payload.similarElements.note : ''}) found these candidate elements: ${JSON.stringify(payload.similarElements.details)}`
      : null,
    `Accessibility tree:\n${snapshot}`,
    '',
    'Return a JSON array of 3-5 alternative suggestions for the SAME element, ordered by confidence (highest first). Each item is EITHER { "ref": "<the eN id of the target node itself>", "confidence": 0-1, "reasoning": "..." } OR, only when no single ref confidently matches, { "locator": "page.getByRole(...)" | "page.locator(...)" | ..., "confidence": 0-1, "reasoning": "..." }. Prefer ref items — put them first — and vary the strategy across any locator-string items rather than returning near-duplicates. Base every suggestion on something actually present in the accessibility tree or attributes above — do not guess a ref, id, class, or attribute value you have not been shown.',
  ].filter(Boolean);

  return sections.join('\n\n');
}

export function extractJsonArray(text: string): LocatorSuggestionRaw[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : text.trim();

  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const arrayMatch = candidate.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

type LocatorSuggestionRaw = { locator?: string; ref?: string; confidence: number; reasoning: string };
