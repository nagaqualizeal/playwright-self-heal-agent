import fs from 'fs';
import path from 'path';
import { loadConfig } from '../core/config';
import { getActiveProvider, getProviderByName } from '../providers';

function walk(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let results: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

const FACTORY_PATTERN = /\.(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByAltText|getByTitle)\(/g;
const DESCRIBE_PATTERN = /\.describe\(/;
const RAW_SELECTOR_PATTERN = /\.locator\(\s*['"](?:#|\.|\/\/|\[|xpath=)/;

function checkDescribeCoverage(files: string[]): { total: number; missing: { file: string; line: number; raw: boolean }[] } {
  let total = 0;
  const missing: { file: string; line: number; raw: boolean }[] = [];

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, idx) => {
      const matches = line.match(FACTORY_PATTERN);
      if (!matches) return;
      total += matches.length;
      if (!DESCRIBE_PATTERN.test(line)) {
        missing.push({ file, line: idx + 1, raw: RAW_SELECTOR_PATTERN.test(line) });
      }
    });
  }

  missing.sort((a, b) => Number(b.raw) - Number(a.raw));
  return { total, missing };
}

function checkInlineLocators(files: string[]): { file: string; line: number }[] {
  const inline: { file: string; line: number }[] = [];
  for (const file of files) {
    if (!/\.(spec|test)\.(ts|js)$/.test(file)) continue;
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, idx) => {
      if (FACTORY_PATTERN.test(line)) inline.push({ file, line: idx + 1 });
      FACTORY_PATTERN.lastIndex = 0;
    });
  }
  return inline;
}

function checkActionTimeout(): { ok: boolean; detail: string } {
  const candidates = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];
  for (const candidate of candidates) {
    const filePath = path.resolve(candidate);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const actionTimeoutMatch = content.match(/actionTimeout\s*:\s*(\d+(?:_\d+)*)/);
    const testTimeoutMatch = content.match(/(?<!action)timeout\s*:\s*(\d+(?:_\d+)*)/);

    if (!actionTimeoutMatch) {
      return { ok: false, detail: `No 'actionTimeout' found in ${candidate} — Playwright will let a broken locator retry for the full test timeout before QASH ever gets a turn to heal it.` };
    }

    const actionTimeout = parseInt(actionTimeoutMatch[1].replace(/_/g, ''), 10);
    const testTimeout = testTimeoutMatch ? parseInt(testTimeoutMatch[1].replace(/_/g, ''), 10) : null;

    if (testTimeout && actionTimeout > testTimeout * 0.8) {
      return { ok: false, detail: `'actionTimeout' (${actionTimeout}ms) in ${candidate} is close to the overall 'timeout' (${testTimeout}ms) — leave more headroom so healing has real time to run.` };
    }

    return { ok: true, detail: `'actionTimeout' is set to ${actionTimeout}ms in ${candidate}.` };
  }

  return { ok: false, detail: 'No playwright.config.(ts|js|mjs) found in the current directory.' };
}

export async function runCheckup(args: string[]) {
  const dirFlagIndex = args.indexOf('--dir');
  const config = loadConfig();
  const testDir = path.resolve(dirFlagIndex >= 0 ? args[dirFlagIndex + 1] : config.testDir);

  console.log('QASH checkup\n');

  // 1. AI connectivity
  if (!config.enabled) {
    console.log('[SKIP] Healing is disabled (HEALER_ENABLED=false).');
  } else if (!config.provider) {
    console.log('[FAIL] No provider configured. Set HEALER_PROVIDER in your .env (openai | anthropic | gemini | ollama | ollama-local).');
  } else {
    const provider = getProviderByName(config.provider) || getActiveProvider();
    if (!provider) {
      console.log(`[FAIL] Unknown provider "${config.provider}".`);
    } else {
      const result = await provider.checkConnectivity(config.actionTimeoutMs);
      console.log(`${result.ok ? '[OK]' : '[FAIL]'} AI connectivity (${config.provider}): ${result.detail}`);
    }
  }

  // 2. actionTimeout
  const timeoutCheck = checkActionTimeout();
  console.log(`${timeoutCheck.ok ? '[OK]' : '[FAIL]'} actionTimeout: ${timeoutCheck.detail}`);

  // 3 & 4. describe() coverage and inline locators
  const files = walk(testDir, ['.ts', '.js']);
  if (files.length === 0) {
    console.log(`[SKIP] No test files found under ${testDir} — pass --dir <path> if your tests live elsewhere.`);
  } else {
    const { total, missing } = checkDescribeCoverage(files);
    if (missing.length === 0) {
      console.log(`[OK] .describe() coverage: all ${total} locator(s) are labeled.`);
    } else {
      console.log(`[WARN] .describe() coverage: ${missing.length}/${total} locator(s) have no label. Locators without a human-readable name give the healer far less to work with.`);
      missing.slice(0, 10).forEach((m) => console.log(`   ${m.raw ? '[raw selector, fix first]' : ''} ${m.file}:${m.line}`));
      if (missing.length > 10) console.log(`   ... and ${missing.length - 10} more.`);
    }

    const inline = checkInlineLocators(files);
    if (inline.length === 0) {
      console.log('[OK] No locators declared directly inside test files.');
    } else {
      console.log(`[WARN] ${inline.length} locator(s) declared directly in test files rather than a Page Object — a UI change then needs a fix in every test that used it, instead of one place.`);
      inline.slice(0, 10).forEach((m) => console.log(`   ${m.file}:${m.line}`));
      if (inline.length > 10) console.log(`   ... and ${inline.length - 10} more.`);
    }
  }

  console.log('\nDone.');
}
