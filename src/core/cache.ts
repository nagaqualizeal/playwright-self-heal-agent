import fs from 'fs';
import { loadConfig } from './config';
import { SourceLocation } from './sourceLocation';
import { withFileLock, writeFileAtomic, quarantineCorruptFile } from './fileLock';

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

// Every write goes through writeFileAtomic, so a lock-free read (the cache probe) always sees a
// complete file; read-modify-write callers additionally hold the cache lock.
function readCacheFile(): Record<string, CachedHeal> {
  const { cachePath } = loadConfig();
  if (!fs.existsSync(cachePath)) return {};
  const content = fs.readFileSync(cachePath, 'utf-8').trim();
  if (!content) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    quarantineCorruptFile(cachePath, error);
    return {};
  }
  // Pre-existing cache files store a bare healed-locator string per key; normalize those to the
  // richer shape so an older .qash-cache.json still loads instead of erroring out.
  const normalized: Record<string, CachedHeal> = {};
  for (const [key, value] of Object.entries(parsed)) {
    normalized[key] = typeof value === 'string' ? { healed: value } : (value as CachedHeal);
  }
  return normalized;
}

export function getCachedHeal(selector: string, location: SourceLocation | null): CachedHeal | null {
  const cache = readCacheFile();
  return cache[cacheKey(selector, location)] || null;
}

export async function saveHeal(
  selector: string,
  location: SourceLocation | null,
  healed: string,
  meta?: { confidence?: number; mode?: 'strict' | 'relaxed' }
) {
  const { cachePath } = loadConfig();
  await withFileLock(cachePath, async () => {
    const cache = readCacheFile();
    cache[cacheKey(selector, location)] = { healed, ...meta };
    await writeFileAtomic(cachePath, JSON.stringify(cache, null, 2));
  });
}

export async function invalidateCachedHeal(selector: string, location: SourceLocation | null) {
  const { cachePath } = loadConfig();
  await withFileLock(cachePath, async () => {
    const cache = readCacheFile();
    delete cache[cacheKey(selector, location)];
    await writeFileAtomic(cachePath, JSON.stringify(cache, null, 2));
  });
}

export async function resetCache() {
  const { cachePath } = loadConfig();
  await withFileLock(cachePath, () => writeFileAtomic(cachePath, '{}'));
}
