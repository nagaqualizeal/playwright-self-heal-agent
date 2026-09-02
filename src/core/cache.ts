import fs from 'fs';
import { loadConfig } from './config';
import { SourceLocation } from './sourceLocation';

// Keyed by selector + declaration site rather than the bare selector string, so
// two different pages that happen to share a broken selector never cross-apply
// a heal computed for the wrong element.
function cacheKey(selector: string, location: SourceLocation | null): string {
  return location ? `${selector}@@${location.file}:${location.line}` : selector;
}

function readCacheFile(): Record<string, string> {
  const { cachePath } = loadConfig();
  try {
    if (!fs.existsSync(cachePath)) return {};
    const content = fs.readFileSync(cachePath, 'utf-8').trim();
    if (!content) return {};
    return JSON.parse(content);
  } catch {
    fs.writeFileSync(cachePath, '{}');
    return {};
  }
}

export function getCachedHeal(selector: string, location: SourceLocation | null): string | null {
  const cache = readCacheFile();
  return cache[cacheKey(selector, location)] || null;
}

export function saveHeal(selector: string, location: SourceLocation | null, healed: string) {
  const { cachePath } = loadConfig();
  const cache = readCacheFile();
  cache[cacheKey(selector, location)] = healed;
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

export function invalidateCachedHeal(selector: string, location: SourceLocation | null) {
  const { cachePath } = loadConfig();
  const cache = readCacheFile();
  delete cache[cacheKey(selector, location)];
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}
