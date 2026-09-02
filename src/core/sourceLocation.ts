import path from 'path';

// Captures the file:line of the call site that created a locator, so heals can be
// cached and reported against "where this locator is declared" rather than a
// selector string that might coincidentally repeat across unrelated pages.
export type SourceLocation = { file: string; line: number };

// Every frame inside this package's own compiled output lives under this
// directory (dist/, one level up from dist/core), regardless of what the
// package is named or how it was installed/linked into a consumer project —
// matching on that, rather than on the literal string "qash-playwright" in a
// path, keeps this correct under npm link, monorepo layouts, or local
// development where the package isn't inside a node_modules folder at all.
const PACKAGE_ROOT = path.resolve(__dirname, '..');

export function captureCallSite(): SourceLocation | null {
  const err = new Error();
  const stack = err.stack || '';
  const frames = stack.split('\n').slice(1);

  for (const raw of frames) {
    const match = raw.match(/\(?([A-Za-z]:[^\s()]+|\/[^\s()]+):(\d+):(\d+)\)?\s*$/);
    if (!match) continue;

    const file = match[1];
    if (file.startsWith(PACKAGE_ROOT)) continue;
    if (file.startsWith('node:')) continue;

    return { file, line: parseInt(match[2], 10) };
  }

  return null;
}

export function formatSourceLocation(loc: SourceLocation | null): string {
  if (!loc) return 'unknown-location';
  const fileName = loc.file.split(/[/\\]/).pop();
  return `${fileName}:${loc.line}`;
}
