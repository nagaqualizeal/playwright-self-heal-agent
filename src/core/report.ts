import fs from 'fs';
import { loadConfig } from './config';

export type HealAttempt = {
  strategy: string;
  locator: string;
  result: 'success' | 'failed';
  count?: number;
  reason?: string;
};

export type HealEntry = {
  original: string;
  healed?: string;
  status: 'success' | 'failed' | 'cache_hit';
  strategy: string;
  action: string;
  test?: string;
  pageUrl?: string;
  location?: string;
  sourceFile?: string;
  sourceLine?: number;
  description?: string | null;
  confidence?: number;
  reasoning?: string;
  attempts?: HealAttempt[];
  finalFailureReason?: string;
  timestamp?: string;
};

export function resetReport() {
  const { reportJsonPath, reportHtmlPath } = loadConfig();
  fs.writeFileSync(reportJsonPath, '[]');
  if (fs.existsSync(reportHtmlPath)) fs.unlinkSync(reportHtmlPath);
}

let checkedThisWorker = false;

// Playwright runs each worker as a separate process, so a simple in-memory
// "already reset" flag can't be shared between them. All workers spawned by
// one `npx playwright test` invocation share the same parent process id,
// though, so that id doubles as a cheap run identifier: the first worker to
// notice it doesn't match the last recorded run clears the report for
// everyone. A harmless double-reset race at the very start of a run (two
// workers starting near-simultaneously) is the only downside, and it's a
// no-op difference from a single reset.
export function ensureReportResetForThisRun() {
  if (checkedThisWorker) return;
  checkedThisWorker = true;

  const lockPath = `${loadConfig().cachePath}.run-lock`;
  const currentRunId = String(process.ppid);
  let previousRunId: string | null = null;
  try {
    previousRunId = fs.readFileSync(lockPath, 'utf-8').trim();
  } catch {
    // No lock file yet — treat as a new run.
  }

  if (previousRunId !== currentRunId) {
    resetReport();
    try {
      fs.writeFileSync(lockPath, currentRunId);
    } catch {
      // Best-effort — a failure here just means the next worker resets again.
    }
  }
}

function readEntries(): HealEntry[] {
  const { reportJsonPath } = loadConfig();
  try {
    if (!fs.existsSync(reportJsonPath)) return [];
    const content = fs.readFileSync(reportJsonPath, 'utf-8').trim();
    return content ? JSON.parse(content) : [];
  } catch {
    return [];
  }
}

export function logHeal(entry: HealEntry) {
  const { reportJsonPath } = loadConfig();
  const data = readEntries();

  const isDuplicate = data.some(
    (d) =>
      d.original === entry.original &&
      d.test === entry.test &&
      d.action === entry.action &&
      d.status === entry.status &&
      d.location === entry.location
  );
  if (isDuplicate) return;

  data.push({ ...entry, timestamp: new Date().toISOString() });
  fs.writeFileSync(reportJsonPath, JSON.stringify(data, null, 2));
  generateHtmlReport(data);
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str ?? '').replace(/[&<>"']/g, (s) => map[s]);
}

function generateHtmlReport(data: HealEntry[]) {
  const { reportHtmlPath } = loadConfig();
  const attempts = data.filter((d) => d.status !== 'cache_hit');
  const successCount = attempts.filter((d) => d.status === 'success').length;
  const failedCount = attempts.filter((d) => d.status === 'failed').length;
  const cacheHits = data.filter((d) => d.status === 'cache_hit').length;
  const successRate = attempts.length > 0 ? Math.round((successCount / attempts.length) * 100) : 0;

  const rows = data
    .map((entry, idx) => {
      const failureReason =
        entry.status === 'failed'
          ? entry.finalFailureReason ||
            entry.attempts
              ?.filter((a) => a.result === 'failed')
              .map((a) => a.reason)
              .filter(Boolean)
              .join(' | ') ||
            '-'
          : '-';

      return `
      <tr class="${entry.status}">
        <td>${idx + 1}</td>
        <td>${escapeHtml(entry.test || 'Unknown')}</td>
        <td><code>${escapeHtml(entry.pageUrl || '-')}</code></td>
        <td><code>${escapeHtml(entry.location || '-')}</code></td>
        <td><code>${escapeHtml(entry.original)}</code></td>
        <td><code>${entry.healed ? escapeHtml(entry.healed) : '-'}</code></td>
        <td>${entry.status === 'success' ? '✅ Success' : entry.status === 'cache_hit' ? '⚡ Cache' : '❌ Failed'}</td>
        <td>${escapeHtml(entry.strategy)}</td>
        <td>${entry.confidence !== undefined ? (entry.confidence * 100).toFixed(0) + '%' : '-'}</td>
        <td style="color:${entry.status === 'failed' ? '#d32f2f' : '#2e7d32'};">${escapeHtml(failureReason)}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QASH Heal Report</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f5f5f5; color:#333; padding:20px; }
  .container { max-width:1500px; margin:0 auto; }
  h1 { margin-bottom:20px; padding-bottom:10px; border-bottom:3px solid #6a3de8; }
  .stats { display:grid; grid-template-columns:repeat(5,1fr); gap:15px; margin-bottom:30px; }
  .stat-card { background:white; padding:15px; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.1); }
  .stat-label { font-size:12px; color:#999; text-transform:uppercase; margin-bottom:5px; }
  .stat-value { font-size:28px; font-weight:bold; }
  .stat-value.success { color:#28a745; }
  .stat-value.failed { color:#dc3545; }
  .stat-value.info { color:#17a2b8; }
  table { width:100%; border-collapse:collapse; background:white; border-radius:4px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
  thead { background:#f8f9fa; font-weight:600; color:#555; border-bottom:2px solid #dee2e6; }
  th, td { padding:10px; text-align:left; border-bottom:1px solid #dee2e6; font-size:12px; word-break:break-word; }
  code { background:#f5f5f5; padding:2px 4px; border-radius:3px; font-family:'Courier New', monospace; font-size:11px; }
  tr.success { background:#f0fdf4; }
  tr.failed { background:#fdf8f7; }
  tr.cache_hit { background:#f0f8ff; }
</style>
</head>
<body>
<div class="container">
  <h1>QASH Heal Report</h1>
  <div class="stats">
    <div class="stat-card"><div class="stat-label">Healing Attempts</div><div class="stat-value">${attempts.length}</div></div>
    <div class="stat-card"><div class="stat-label">Success</div><div class="stat-value success">${successCount}</div></div>
    <div class="stat-card"><div class="stat-label">Failed</div><div class="stat-value failed">${failedCount}</div></div>
    <div class="stat-card"><div class="stat-label">Cache Reuses</div><div class="stat-value info">${cacheHits}</div></div>
    <div class="stat-card"><div class="stat-label">Success Rate</div><div class="stat-value">${successRate}%</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Test</th><th>Page URL</th><th>Location</th><th>Original</th><th>Healed</th><th>Status</th><th>Strategy</th><th>Confidence</th><th>Failure Reason</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body>
</html>`;

  fs.writeFileSync(reportHtmlPath, html);
}
