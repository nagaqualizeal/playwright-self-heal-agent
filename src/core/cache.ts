import fs from 'fs';
import { loadConfig } from './config';
import { SourceLocation } from './sourceLocation';

// Keyed by selector + declaration site rather than the bare selector string, so
// two different pages that happen to share a broken selector never cross-apply
// a heal computed for the wrong element.
function cacheKey(selector: string, location: SourceLocation | null): string {
  return location ? `${selector}@@${location.file}:${location.line}` : selector;
}

// Confidence/mode ride along with the healed locator so a cache hit can report the same
// needsReview status the original heal earned, instead of looking more trustworthy than it is
// just because it's been seen before.
export type CachedHeal = {
  healed: string;
  confidence?: number;
  mode?: 'strict' | 'relaxed';
};

function readCacheFile(): Record<string, CachedHeal> {
  const { cachePath } = loadConfig();
  try {
    if (!fs.existsSync(cachePath)) return {};
    const content = fs.readFileSync(cachePath, 'utf-8').trim();
    if (!content) return {};
    const parsed = JSON.parse(content);
    // Pre-existing cache files store a bare healed-locator string per key; normalize those to the
    // richer shape so an older .qash-cache.json still loads instead of erroring out.
    const normalized: Record<string, CachedHeal> = {};
    for (const [key, value] of Object.entries(parsed)) {
      normalized[key] = typeof value === 'string' ? { healed: value } : (value as CachedHeal);
    }
    return normalized;
  } catch {
    fs.writeFileSync(cachePath, '{}');
    return {};
  }
}

export function getCachedHeal(selector: string, location: SourceLocation | null): CachedHeal | null {
  const cache = readCacheFile();
  return cache[cacheKey(selector, location)] || null;
}

export function saveHeal(
  selector: string,
  location: SourceLocation | null,
  healed: string,
  meta?: { confidence?: number; mode?: 'strict' | 'relaxed' }
) {
  const { cachePath } = loadConfig();
  const cache = readCacheFile();
  cache[cacheKey(selector, location)] = { healed, ...meta };
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

export function invalidateCachedHeal(selector: string, location: SourceLocation | null) {
  const { cachePath } = loadConfig();
  const cache = readCacheFile();
  delete cache[cacheKey(selector, location)];
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

export function resetCache() {
  fs.writeFileSync(loadConfig().cachePath, '{}');
}
