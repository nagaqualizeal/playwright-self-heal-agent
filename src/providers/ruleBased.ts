import { HealProvider, HealPromptPayload, LocatorSuggestion } from './types';

// Zero-cost, zero-network healing: matches the element's own description (from `.describe()` or
// the inferred variable name — see describe.ts) against the accessibility tree that was already
// captured for the AI path, using plain text scoring instead of a model call. Tried before any
// configured AI provider (see heal.ts) so the common case — an id/class changed but the visible
// label or accessible name didn't — heals for free and instantly. Declines (returns no
// suggestions) rather than guessing whenever the match isn't clearly unambiguous, exactly like
// the AI providers are instructed to never invent something not actually present.

type SnapshotNode = { role: string; name: string };

// Playwright's default-mode ariaSnapshot() renders each node as an indented YAML-list line, e.g.
//   - link "Home"
//   - textbox "Employee Id" [disabled]
// Nodes with no quoted accessible name (containers, generic groups) carry nothing to match
// against and are skipped.
function parseSnapshotNodes(ariaSnapshot: string): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  const lineRe = /^\s*-\s*([a-zA-Z][\w-]*)\s+"((?:[^"\\]|\\.)*)"/;
  for (const line of ariaSnapshot.split('\n')) {
    const match = line.match(lineRe);
    if (match) nodes.push({ role: match[1], name: match[2] });
  }
  return nodes;
}

// A trailing "(word)" on a description is a type hint added by describe.ts's variable-name
// decoding (e.g. "Employee Id (textbox)") — stronger and more specific than guessing a role from
// the action alone, so it's split off and preferred when present.
function splitDescription(description: string): { phrase: string; typeHint: string | null } {
  const hintMatch = description.match(/^(.*)\s+\(([a-zA-Z]+)\)$/);
  if (hintMatch && hintMatch[1].trim()) {
    return { phrase: hintMatch[1].trim(), typeHint: hintMatch[2].toLowerCase() };
  }
  return { phrase: description.trim(), typeHint: null };
}

const ACTION_ROLE_HINTS: Record<string, string[]> = {
  click: ['button', 'link'],
  dblclick: ['button', 'link'],
  tap: ['button', 'link'],
  fill: ['textbox', 'searchbox'],
  type: ['textbox', 'searchbox'],
  check: ['checkbox'],
  uncheck: ['checkbox'],
  selectOption: ['combobox', 'listbox'],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Scores how well one snapshot node's accessible name matches the target phrase. Returns 0 for
// "no real signal" so the caller can filter those out entirely, rather than ranking noise.
function scoreMatch(phraseNorm: string, nameNorm: string): number {
  if (!phraseNorm || !nameNorm) return 0;
  if (phraseNorm === nameNorm) return 3;
  if (nameNorm.includes(phraseNorm) || phraseNorm.includes(nameNorm)) return 2;

  const phraseWords = new Set(phraseNorm.split(' ').filter((w) => w.length > 1));
  const nameWords = nameNorm.split(' ').filter((w) => w.length > 1);
  if (phraseWords.size === 0 || nameWords.length === 0) return 0;
  const overlap = nameWords.filter((w) => phraseWords.has(w)).length;
  const ratio = overlap / Math.max(phraseWords.size, nameWords.length);
  return ratio >= 0.6 ? 1 : 0;
}

function escapeForSingleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const CONFIDENCE_BY_TIER: Record<string, number> = {
  '3-role': 0.95,
  '3': 0.9,
  '2-role': 0.85,
  '2': 0.75,
  '1-role': 0.6,
  '1': 0.5,
};

export const RuleBasedProvider: HealProvider = {
  async suggestLocators(payload: HealPromptPayload): Promise<LocatorSuggestion[]> {
    if (!payload.description) return [];

    const { phrase, typeHint } = splitDescription(payload.description);
    const phraseNorm = normalize(phrase);
    if (!phraseNorm) return [];

    const roleHints = typeHint ? [typeHint] : ACTION_ROLE_HINTS[payload.action] || null;
    const nodes = parseSnapshotNodes(payload.ariaSnapshot);

    type Scored = { node: SnapshotNode; score: number; roleMatched: boolean };
    const scored: Scored[] = [];
    for (const node of nodes) {
      const score = scoreMatch(phraseNorm, normalize(node.name));
      if (score === 0) continue;
      scored.push({ node, score, roleMatched: !!roleHints && roleHints.includes(node.role) });
    }
    if (scored.length === 0) return [];

    // Rank by score first, then prefer a role that matches the action/hint as a tiebreaker —
    // never used to let a low text score win, only to separate otherwise-equal candidates.
    scored.sort((a, b) => b.score - a.score || Number(b.roleMatched) - Number(a.roleMatched));

    const [best, second] = scored;
    const tied = second && second.score === best.score && second.roleMatched === best.roleMatched;
    if (tied || best.score < 1) return []; // ambiguous, or too weak a signal — decline rather than guess

    const tierKey = `${best.score}${best.roleMatched ? '-role' : ''}`;
    const confidence = CONFIDENCE_BY_TIER[tierKey] ?? 0.5;
    const name = escapeForSingleQuotes(best.node.name);

    return [
      {
        locator: `page.getByRole('${best.node.role}', { name: '${name}' })`,
        confidence,
        reasoning: `Rule-based match: description "${phrase}" matched the accessible name "${best.node.name}" (role ${best.node.role}) in the accessibility tree — no AI call made.`,
      },
    ];
  },

  async checkConnectivity(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'Rule-based matcher — no network, API key, or model involved.' };
  },
};
