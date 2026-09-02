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

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => rl.question(`${message} (y/N) `, resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

export async function runApply(args: string[]) {
  const dryRun = args.includes('--dry-run');
  const autoYes = args.includes('--yes');

  const { reportJsonPath } = loadConfig();
  if (!fs.existsSync(reportJsonPath)) {
    console.log(`No report found at ${reportJsonPath} — run your tests with QASH enabled first.`);
    return;
  }

  const entries: HealEntry[] = JSON.parse(fs.readFileSync(reportJsonPath, 'utf-8'));
  const candidates = latestSuccessfulHealPerLocation(entries);

  if (candidates.length === 0) {
    console.log('No successful heals with a known source location to apply.');
    return;
  }

  type PendingChange = { file: string; line: number; before: string; after: string; newFileLines: string[] };
  const changes: PendingChange[] = [];
  const fileLinesCache = new Map<string, string[]>();

  for (const entry of candidates) {
    const filePath = entry.sourceFile!;
    if (!fs.existsSync(filePath)) continue;

    if (!fileLinesCache.has(filePath)) {
      fileLinesCache.set(filePath, fs.readFileSync(filePath, 'utf-8').split('\n'));
    }
    const lines = fileLinesCache.get(filePath)!;
    const lineIndex = entry.sourceLine! - 1;
    const originalLine = lines[lineIndex];
    if (originalLine === undefined) continue;

    const span = findFactoryCallSpan(originalLine);
    const replacement = extractReplacementCall(entry.healed!);
    if (!span || !replacement) continue;

    const newLine = originalLine.slice(0, span.start) + replacement + originalLine.slice(span.end);
    if (newLine === originalLine) continue;

    changes.push({ file: filePath, line: entry.sourceLine!, before: originalLine.trim(), after: newLine.trim(), newFileLines: lines });
    lines[lineIndex] = newLine;
  }

  if (changes.length === 0) {
    console.log('Nothing to apply — no heal locations matched a recognizable locator call in source.');
    return;
  }

  console.log(`${dryRun ? 'Would change' : 'About to change'} ${changes.length} location(s):\n`);
  for (const change of changes) {
    console.log(`${change.file}:${change.line}`);
    console.log(`  - ${change.before}`);
    console.log(`  + ${change.after}\n`);
  }

  if (dryRun) {
    console.log('Dry run — no files were written. Re-run without --dry-run to apply.');
    return;
  }

  if (!autoYes) {
    const proceed = await confirm('Write these changes to disk?');
    if (!proceed) {
      console.log('Aborted — pass --yes to skip this prompt in non-interactive environments, once you have reviewed the changes.');
      return;
    }
  }

  for (const filePath of fileLinesCache.keys()) {
    if (changes.some((c) => c.file === filePath)) {
      fs.writeFileSync(filePath, fileLinesCache.get(filePath)!.join('\n'));
    }
  }

  console.log('Changes written. Review them with your usual diff tool before committing.');
}
