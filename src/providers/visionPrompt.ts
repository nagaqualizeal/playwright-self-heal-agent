import { VisionPromptPayload } from './types';

// Only ever reached after the text-based passes (rule-based, then the configured AI provider
// against the accessibility tree) have both already failed to find anything usable — this is a
// last resort for elements the accessibility tree doesn't describe well (canvas-drawn UI, an icon
// with no accessible name, a custom widget with poor ARIA).
export const VISION_SYSTEM_PROMPT =
  'You are looking at a screenshot of a web page. A Playwright test tried to interact with an ' +
  'element that a text-based search could not find. Given a description of what the element is, ' +
  'find it in the image. Respond with ONLY a JSON object, no prose, no markdown fences: ' +
  '{"found": true, "x": <0-1000>, "y": <0-1000>} where x/y are the element\'s center, normalized to ' +
  'a 0-1000 scale on each axis (0,0 is the top-left corner of the image, 1000,1000 is the bottom-' +
  'right corner) — NOT raw pixels. If nothing in the image plausibly matches the description, ' +
  'respond with exactly {"found": false}. Never guess at a location you are not reasonably ' +
  'confident about.';

export function buildVisionUserPrompt(payload: VisionPromptPayload): string {
  return [
    `Failed action: ${payload.action}`,
    `Failed locator (for context only — it no longer resolves): ${payload.failedLocator}`,
    payload.description ? `Description of the element to find: "${payload.description}"` : 'No description was provided — use the failed locator text as your only hint.',
  ].join('\n');
}

export function parseVisionResponse(text: string): { x: number; y: number } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  let parsed: any;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try {
      parsed = JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }

  if (!parsed || parsed.found !== true) return null;
  if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
  return { x: parsed.x, y: parsed.y };
}
