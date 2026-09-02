import { Locator } from '@playwright/test';

export enum ValidationMode {
  STRICT = 'STRICT', // Only accept an exact single match.
  RELAXED = 'RELAXED', // Accept multiple matches, picking the best candidate.
}

export type ValidationResult = {
  valid: boolean;
  elementCount: number;
  duplicates: boolean;
  resolvedLocator: Locator | null;
};

async function isUsable(locator: Locator): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// Among several matches for the same candidate selector, prefers a visible one,
// and among visible ones, prefers whichever text most closely matches the
// developer's own description of the element — a much better tie-breaker than
// blindly taking the first DOM match, without needing a full identity system.
async function pickBestCandidate(locator: Locator, count: number, description: string | null): Promise<Locator> {
  const all = locator;
  const visibleFlags = await Promise.all(
    Array.from({ length: count }, (_, i) => all.nth(i).isVisible().catch(() => false))
  );
  const visibleIndexes = visibleFlags.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const candidateIndexes = visibleIndexes.length > 0 ? visibleIndexes : [0];

  if (candidateIndexes.length === 1 || !description) {
    return all.nth(candidateIndexes[0]);
  }

  const descriptionWords = description.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  let bestIndex = candidateIndexes[0];
  let bestScore = -1;

  for (const idx of candidateIndexes) {
    const text = await all
      .nth(idx)
      .evaluate((el: any) => `${el.innerText || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase())
      .catch(() => '');
    const score = descriptionWords.filter((w) => text.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  }

  return all.nth(bestIndex);
}

export async function validateLocator(
  locator: Locator,
  mode: ValidationMode,
  description: string | null = null
): Promise<ValidationResult> {
  try {
    const count = await locator.count();

    if (count === 0) {
      return { valid: false, elementCount: 0, duplicates: false, resolvedLocator: null };
    }

    if (count === 1) {
      const usable = await isUsable(locator);
      return { valid: usable, elementCount: 1, duplicates: false, resolvedLocator: usable ? locator : null };
    }

    // count > 1
    if (mode === ValidationMode.STRICT) {
      return { valid: false, elementCount: count, duplicates: true, resolvedLocator: null };
    }

    const candidate = await pickBestCandidate(locator, count, description);
    const usable = await isUsable(candidate);
    return { valid: usable, elementCount: count, duplicates: true, resolvedLocator: usable ? candidate : null };
  } catch {
    return { valid: false, elementCount: 0, duplicates: false, resolvedLocator: null };
  }
}
