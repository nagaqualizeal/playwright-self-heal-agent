import fs from 'fs';
import readline from 'readline';
import { loadConfig } from '../core/config';
import { HealEntry } from '../core/report';

const FACTORY_METHOD_NAMES = ['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId', 'getByAltText', 'getByTitle'];

// Finds the `.method(` on the given line whose call this heal applies to, then
// walks forward tracking paren depth (aware of quoted strings so a `)` inside
// a string literal doesn't end the scan early) to find the matching close-paren.
function findFactoryCallSpan(line: string): { start: number; end: number } | null {
  for (const method of FACTORY_METHOD_NAMES) {
    const needle = `.${method}(`;
    const dotIndex = line.indexOf(needle);
    if (dotIndex === -1) continue;

    // `openParenIndex` points AT the "(" itself; depth already accounts for it,
    // so scanning starts one character later to avoid counting it twice.
    const openParenIndex = dotIndex + method.length + 1;
    let depth = 1;
    let inString: string | null = null;
    let i = openParenIndex + 1;

    while (i < line.length && depth > 0) {
      const ch = line[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === inString) inString = null;
      } else if (ch === "'" || ch === '"' || ch === '`') {
        inString = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
      }
      i++;
    }

    if (depth === 0) return { start: dotIndex, end: i };
  }

  return null;
}

// The `healed` field is always a fully-formed `page.getByRole(...)`-shaped
// string; only the `.method(...)` part (everything from the first dot onward)
// gets spliced in, so the original receiver (`page`, `this.page`, a container
// locator) and any trailing chained calls are left untouched.
function extractReplacementCall(healedLocator: string): string | null {
  const firstDot = healedLocator.indexOf('.');
  if (firstDot === -1) return null;
  return healedLocator.slice(firstDot);
}

function latestSuccessfulHealPerLocation(entries: HealEntry[]): HealEntry[] {
  const byLocation = new Map<string, HealEntry>();
  for (const entry of entries) {
    if (entry.status !== 'success' || !entry.healed || !entry.sourceFile || !entry.sourceLine) continue;
    const key = `${entry.sourceFile}:${entry.sourceLine}`;
    const existing = byLocation.get(key);
    if (!existing || (entry.timestamp || '') > (existing.timestamp || '')) {
      byLocation.set(key, entry);
    }
  }
  return [...byLocation.values()];
}

// Rough, tokenizer-free removal of string/template contents and line comments
// so braces inside them don't throw off the balance count below. Not a full
// parser — good enough for the formatted TypeScript a Page Object is normally
// written in.
function stripNonCode(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const METHOD_SIGNATURE = /(get\s+)?([A-Za-z_$][\w$]*)\s*\(/;
const ARROW_PROPERTY = /([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/;

// Scans backward from the locator's line to find the nearest method/getter
// whose body actually encloses it — skipping over any sibling blocks that
// already closed before reaching this line — rather than just the nearest
// preceding declaration textually. If the locator's own line is inside a
// method that itself calls another method, this reports the innermost one
// (where the locator is physically written), not whichever one happens to
// call into it — the calling method is a separate, runtime relationship
// already captured elsewhere as the report's "test" field, not something
// this lexical scan is trying to answer.
function findEnclosingMethodName(lines: string[], targetLineIndex: number): string | null {
  let pendingCloses = 0;

  for (let i = targetLineIndex - 1; i >= 0; i--) {
    const code = stripNonCode(lines[i]);
    const opens = (code.match(/\{/g) || []).length;
    const closes = (code.match(/\}/g) || []).length;

    if (pendingCloses > 0) {
      pendingCloses = Math.max(0, pendingCloses - opens + closes);
      continue;
    }

    if (closes > opens) {
      pendingCloses += closes - opens;
      continue;
    }

    if (opens > closes) {
      const signatureMatch = code.match(METHOD_SIGNATURE);
      const arrowMatch = !signatureMatch ? code.match(ARROW_PROPERTY) : null;
      const name = signatureMatch?.[2] || arrowMatch?.[1];
      if (!name) return null;
      return signatureMatch?.[1] ? `get ${name}()` : `${name}()`;
    }
  }

  return null;
}

type Candidate = {
  index: number;
  entry: HealEntry;
  file: string;
  line: number;
  method: string | null;
  before: string;
  after: string;
};

function buildCandidates(entries: HealEntry[]): Candidate[] {
  const latest = latestSuccessfulHealPerLocation(entries);
  const candidates: Candidate[] = [];

  for (const entry of latest) {
    const filePath = entry.sourceFile!;
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const lineIndex = entry.sourceLine! - 1;
    const originalLine = lines[lineIndex];
    if (originalLine === undefined) continue;

    const span = findFactoryCallSpan(originalLine);
    const replacement = extractReplacementCall(entry.healed!);
    if (!span || !replacement) continue;

    const newLine = originalLine.slice(0, span.start) + replacement + originalLine.slice(span.end);
    if (newLine === originalLine) continue;

    candidates.push({
      index: 0, // assigned after sorting/filtering, see below
      entry,
      file: filePath,
      line: entry.sourceLine!,
      method: findEnclosingMethodName(lines, lineIndex),
      before: originalLine.trim(),
      after: newLine.trim(),
    });
  }

  candidates.forEach((c, i) => (c.index = i + 1));
  return candidates;
}

function printCandidate(c: Candidate) {
  const methodSuffix = c.method ? `  (in ${c.method})` : '';
  console.log(`[${c.index}] ${c.file}:${c.line}${methodSuffix}`);
  console.log(`    - ${c.before}`);
  console.log(`    + ${c.after}\n`);
}

// Applies one candidate against whatever the file's current in-memory state
// is (which may already include earlier candidates applied this session), so
// order of application never matters and files with multiple heals compose
// correctly regardless of which one gets picked first.
function applyCandidate(c: Candidate, liveFiles: Map<string, string[]>): boolean {
  if (!liveFiles.has(c.file)) {
    liveFiles.set(c.file, fs.readFileSync(c.file, 'utf-8').split('\n'));
  }
  const lines = liveFiles.get(c.file)!;
  const lineIndex = c.line - 1;
  const currentLine = lines[lineIndex];
  if (currentLine === undefined) return false;

  const span = findFactoryCallSpan(currentLine);
  const replacement = extractReplacementCall(c.entry.healed!);
  if (!span || !replacement) return false;

  lines[lineIndex] = currentLine.slice(0, span.start) + replacement + currentLine.slice(span.end);
  fs.writeFileSync(c.file, lines.join('\n'));
  return true;
}

function parseSelection(spec: string, max: number): number[] {
  const result = new Set<number>();
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
        if (i >= 1 && i <= max) result.add(i);
      }
      continue;
    }
    const num = parseInt(part, 10);
    if (!isNaN(num) && num >= 1 && num <= max) result.add(num);
  }
  return [...result].sort((a, b) => a - b);
}

export async function runApply(args: string[]) {
  const dryRun = args.includes('--dry-run');
  const autoYes = args.includes('--yes');
  const onlyFlagIndex = args.indexOf('--only');
  const onlySpec = onlyFlagIndex >= 0 ? args[onlyFlagIndex + 1] : null;

  const { reportJsonPath } = loadConfig();
  if (!fs.existsSync(reportJsonPath)) {
    console.log(`No report found at ${reportJsonPath} — run your tests with QASH enabled first.`);
    return;
  }

  const entries: HealEntry[] = JSON.parse(fs.readFileSync(reportJsonPath, 'utf-8'));
  const candidates = buildCandidates(entries);

  if (candidates.length === 0) {
    console.log('Nothing to apply — no successful heal has a recognizable locator call at a known source location.');
    return;
  }

  console.log(`Found ${candidates.length} successful heal(s):\n`);
  candidates.forEach(printCandidate);

  const liveFiles = new Map<string, string[]>();
  const applied = new Set<number>();
  let wroteAnything = false;

  // `simulateOnly` is decided per call site, not by the global --dry-run flag
  // alone: an explicit selection (a number, a list, a range, --only) always
  // writes for real, dry-run or not. The only thing --dry-run disables is the
  // bulk "all"/--yes shortcut, which callers signal by passing true here.
  function applyIndices(indices: number[], simulateOnly: boolean) {
    for (const idx of indices) {
      if (idx < 1 || idx > candidates.length) {
        console.log(`No item [${idx}].`);
        continue;
      }
      if (applied.has(idx)) {
        console.log(`[${idx}] already applied.`);
        continue;
      }
      const c = candidates[idx - 1];
      const ok = simulateOnly ? true : applyCandidate(c, liveFiles);
      if (ok) {
        applied.add(idx);
        if (!simulateOnly) wroteAnything = true;
        console.log(`${simulateOnly ? 'Would apply' : 'Applied'} [${idx}] ${c.file}:${c.line}`);
      } else {
        console.log(`[${idx}] could not be applied — the source line no longer matches what was recorded.`);
      }
    }
  }

  // --yes is the CLI equivalent of the interactive "all" shortcut, so
  // --dry-run disables it the same way: it previews all of them but writes
  // none, exactly like typing "all" would at the interactive prompt.
  if (autoYes) {
    applyIndices(candidates.map((c) => c.index), dryRun);
    console.log(`\n${wroteAnything ? 'Applied' : 'Would apply'} ${applied.size}/${candidates.length}.${wroteAnything ? '' : ' No files were written.'}`);
    return;
  }

  if (onlySpec) {
    const indices = parseSelection(onlySpec, candidates.length);
    if (indices.length === 0) {
      console.log(`--only "${onlySpec}" didn't match any of [1-${candidates.length}].`);
      return;
    }
    // --only is an explicit selection, like a number typed interactively —
    // it writes for real even under --dry-run (see the comment on applyIndices).
    applyIndices(indices, false);
    console.log(`\nApplied ${applied.size}/${candidates.length}.`);
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('Non-interactive environment — pass --yes to apply all, or --only <numbers> (e.g. --only 1,3 or --only 2-4) to apply specific ones.');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string): Promise<string> => new Promise((resolve) => rl.question(question, resolve));

  while (applied.size < candidates.length) {
    const remaining = candidates.length - applied.size;
    const answer = (
      await ask(`Apply which? [all / number / list e.g. 1,3 / range e.g. 1-2 / stop] (${remaining} remaining): `)
    )
      .trim()
      .toLowerCase();

    if (['stop', 'done', 'q', 'quit', 'exit', ''].includes(answer)) break;

    if (answer === 'all') {
      if (dryRun) {
        console.log('Dry run: "all" is disabled here — pick specific numbers (or a range) to actually apply them.\n');
        continue;
      }
      applyIndices(candidates.filter((c) => !applied.has(c.index)).map((c) => c.index), false);
      console.log();
      continue;
    }

    const indices = parseSelection(answer, candidates.length);
    if (indices.length === 0) {
      console.log('Not a valid selection — enter a number, a comma list, a range, "all", or "stop".\n');
      continue;
    }

    // An explicit pick always writes for real, dry-run or not.
    applyIndices(indices, false);
    console.log();
  }

  rl.close();
  console.log(`Done — applied ${applied.size}/${candidates.length}.${applied.size < candidates.length ? ` ${candidates.length - applied.size} left untouched.` : ''}`);
}
