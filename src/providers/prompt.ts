import { HealPromptPayload } from './types';

const MAX_SNAPSHOT_CHARS = 8000;

export const SYSTEM_PROMPT =
  'You are a Playwright locator repair assistant. You are given a broken locator, the reason it failed, ' +
  'and the page\'s accessibility tree. Find the element the broken locator was trying to reach and return ' +
  'alternative Playwright locators for it. Prefer Playwright\'s semantic locators (getByRole, getByLabel, ' +
  'getByPlaceholder, getByText, getByTestId) over CSS or XPath — use CSS/XPath only when nothing in the ' +
  'accessibility tree gives you a role or accessible name to target. Never invent an element, attribute, or ' +
  'value that is not actually present in the information given to you. Respond with ONLY a JSON array, no ' +
  'prose, no markdown fences.';

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
    'Return a JSON array of 3-5 alternative locator suggestions for the SAME element, ordered by confidence (highest first). Each item: { "locator": "page.getByRole(...)" | "page.locator(...)" | ..., "confidence": 0-1, "reasoning": "..." }. Vary the strategy across suggestions rather than returning near-duplicates. Base every suggestion on something actually present in the accessibility tree or attributes above — do not guess an id, class, or attribute value you have not been shown.',
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

type LocatorSuggestionRaw = { locator: string; confidence: number; reasoning: string };
