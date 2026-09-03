import { test } from '@playwright/test';
import { HealEntry } from './report';

// test.info() is tracked per currently-running test regardless of which
// extended `test` object a caller imported, but it throws when called outside
// a running test (e.g. a plain script using the manual bind() API) — that's
// the normal case for anything not running under `npx playwright test`, not
// an error worth surfacing.
function getRunningTestInfo() {
  try {
    return test.info();
  } catch {
    return null;
  }
}

function annotationType(status: HealEntry['status']): string {
  if (status === 'success') return 'qash-healed';
  if (status === 'cache_hit') return 'qash-cache-hit';
  return 'qash-heal-failed';
}

function summarize(entry: HealEntry): string {
  if (entry.status === 'success' || entry.status === 'cache_hit') {
    return `${entry.action} on "${entry.original}" → ${entry.healed}`;
  }
  return `${entry.action} on "${entry.original}": ${entry.finalFailureReason || 'no usable locator found'}`;
}

// Mirrors a heal entry into Playwright's own report — a short annotation line
// on the test itself, plus the full entry as an attached, downloadable JSON —
// so healing is visible without needing to open a separate report at all.
export async function attachToNativeReport(entry: HealEntry): Promise<void> {
  const testInfo = getRunningTestInfo();
  if (!testInfo) return;

  testInfo.annotations.push({ type: annotationType(entry.status), description: summarize(entry) });

  try {
    await testInfo.attach(`qash-${entry.status}-${entry.action}-${Date.now()}`, {
      body: JSON.stringify(entry, null, 2),
      contentType: 'application/json',
    });
  } catch {
    // Best-effort — a failed attachment shouldn't fail the test or the heal.
  }
}
