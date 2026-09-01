import fs from 'fs';
import path from 'path';

const jsonFilePath = path.resolve('self-heal-report.json');
const htmlFilePath = path.resolve('self-heal-report.html');

// Track cache usage for reporting
const cacheUsageMap = new Map<string, { healed: string; count: number; actions: number[]; testName: string }>();

export function logCacheHit(originalSelector: string, healedSelector: string, actionId: number, testName: string = 'Unknown') {
  if (!cacheUsageMap.has(originalSelector)) {
    cacheUsageMap.set(originalSelector, { healed: healedSelector, count: 0, actions: [], testName });
  }
  
  const usage = cacheUsageMap.get(originalSelector)!;
  usage.count++;
  usage.actions.push(actionId);
  // Update test name if we have it
  if (testName && testName !== 'Unknown') {
    usage.testName = testName;
  }
}

export function reportCacheUsage() {
  if (cacheUsageMap.size === 0) return;

  let data: any[] = [];
  if (fs.existsSync(jsonFilePath)) {
    data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
  }

  // Add cache usage entries
  for (const [original, usage] of cacheUsageMap.entries()) {
    // Check if this cache hit is already in the report
    const exists = data.find((d) =>
      d.original === original &&
      d.status === 'cache_hit'
    );

    if (!exists) {
      data.push({
        original,
        healed: usage.healed,
        status: 'cache_hit',
        strategy: 'cache',
        reuseCount: usage.count,
        usedByActions: usage.actions,
        test: usage.testName,
        timestamp: new Date().toISOString()
      });
    }
  }

  fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2));
  generateHtmlReport(data);
}

export function logHealing(entry: any) {
  let data: any[] = [];

  if (fs.existsSync(jsonFilePath)) {
    data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
  }

  // 🚫 Prevent duplicates
  const exists = data.find((d) =>
    d.original === entry.original &&
    d.test === entry.test &&
    d.action === entry.action &&
    d.status === entry.status
  );

  if (exists) {
    console.log('⚠️ Duplicate healing skipped');
    console.log(`📄 Report available at: ${htmlFilePath}`);
    return;
  }

  const newEntry = {
    ...entry,
    timestamp: new Date().toISOString()
  };

  data.push(newEntry);

  fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2));

  // 🎯 Generate HTML report
  generateHtmlReport(data);

  console.log(`📝 Healing logged (${entry.status})`);
  console.log(`📄 Report available at: ${htmlFilePath}`);
}

function generateHtmlReport(data: any[]) {
  // Filter to only count actual healing attempts (not cache reuses)
  const healingAttempts = data.filter(d => d.status !== 'cache_hit');
  const successCount = healingAttempts.filter(d => d.status === 'success').length;
  const failedCount = healingAttempts.filter(d => d.status === 'failed').length;
  const cacheHitCount = data.filter(d => d.status === 'cache_hit').length;
  const totalReuses = data.filter(d => d.status === 'cache_hit').reduce((sum, d) => sum + (d.reuseCount || 0), 0);
  const entriesHtml = healingAttempts.map((entry, idx) => {
    return `
        <div class="healing-entry ${entry.status}">
          <div class="header">
            <div>
              <div class="test-name">
                #${idx + 1} ${entry.test || 'Unknown Test'}
              </div>
            </div>
            <div>
              <span class="action-badge">${entry.action}</span>
              <span class="status-badge ${entry.status}">${entry.status.toUpperCase()}</span>
              ${entry.confidence ? `<span class="confidence">Confidence: ${(entry.confidence * 100).toFixed(0)}%</span>` : ''}
            </div>
          </div>

          <div class="info-row">
            <span class="info-label">Original:</span>
            <span class="info-value"><code>${escapeHtml(entry.original)}</code></span>
          </div>

          ${entry.elementDescription ? `
          <div class="info-row">
            <span class="info-label">📝 Developer Description:</span>
            <span class="info-value">${escapeHtml(entry.elementDescription)}</span>
          </div>
          ` : ''}

          ${entry.healed ? `
          <div class="info-row">
            <span class="info-label">Healed:</span>
            <span class="info-value"><code>${escapeHtml(entry.healed)}</code></span>
          </div>
          ` : ''}

          ${entry.reasoning ? `
          <div class="info-row">
            <span class="info-label">Why It Worked:</span>
            <span class="info-value">${escapeHtml(entry.reasoning)}</span>
          </div>
          ` : ''}

          ${entry.strategy ? `
          <div class="info-row">
            <span class="info-label">Strategy:</span>
            <span class="info-value">${entry.strategy}</span>
          </div>
          ` : ''}

          ${entry.reuseCount ? `
          <div class="info-row">
            <span class="info-label">⚡ Reused:</span>
            <span class="info-value">${entry.reuseCount} time(s) by actions [${entry.usedByActions?.join(', ')}]</span>
          </div>
          ` : ''}

          ${entry.scriptFailureReason || (entry.attempts && entry.attempts.some((a: any) => a.llmFailureReason)) ? `
          <div class="failure-reasons">
            ${entry.scriptFailureReason ? `
            <div class="failure-reason script">
              <div class="failure-label">❌ Why Script Failed</div>
              <div class="failure-text">${escapeHtml(entry.scriptFailureReason)}</div>
            </div>
            ` : ''}
            ${entry.attempts && entry.attempts.some((a: any) => a.llmFailureReason) ? `
            <div style="margin-top: 10px;">
              <div class="failure-label" style="margin-bottom: 8px;">⚠️ Why LLM Suggestions Failed</div>\n              ${entry.attempts.map((att: any, aidx: any) => att.llmFailureReason ? `
              <div class="failure-reason llm" style="margin-bottom: 8px;">
                <strong>Suggestion ${aidx + 1}:</strong> <code>${escapeHtml(att.locator)}</code>
                <div style="margin-top: 4px; color: #d32f2f;">${escapeHtml(att.llmFailureReason)}</div>
              </div>
              ` : '').join('')}
            </div>
            ` : ''}
          </div>
          ` : ''}

          ${entry.failedLocatorElements && entry.failedLocatorElements.length > 0 ? `
          <div class="element-details">
            <h4>🔴 Original Locator Matched ${entry.failedLocatorElements.length} Elements (Potential Issue)</h4>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Text</th>
                </tr>
              </thead>
              <tbody>
                ${entry.failedLocatorElements.map((el: any, i: any) => `
                <tr>
                  <td>${i + 1}</td>
                  <td><code>${escapeHtml(el.id || 'N/A')}</code></td>
                  <td><code>${escapeHtml(el.name || 'N/A')}</code></td>
                  <td><code>${escapeHtml(el.role || 'N/A')}</code></td>
                  <td>${escapeHtml(el.text || 'N/A')}</td>
                </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${entry.elementDetails ? `
          <div class="element-details">
            <h4>📋 First Matching Element Details</h4>
            <table>
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(entry.elementDetails).map(([key, value]: any) => `
                <tr>
                  <td><strong>${escapeHtml(key)}</strong></td>
                  <td><code>${escapeHtml(String(value))}</code></td>
                </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          ${entry.attempts && entry.attempts.length > 0 ? `
          <div class="element-details">
            <h4>⚙️ Healing Attempts (${entry.attempts.length})</h4>
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Locator</th>
                  <th>Result</th>
                  <th>Count</th>
                  <th>Failure Reason</th>
                </tr>
              </thead>
              <tbody>
                ${entry.attempts.map((att: any, aidx: any) => `
                <tr class="${att.result}">
                  <td><strong>${att.strategy.toUpperCase()}</strong></td>
                  <td><code style="font-size: 11px;">${escapeHtml(att.locator)}</code></td>
                  <td>${att.result === 'success' ? '✅ SUCCESS' : '❌ FAILED'}</td>
                  <td>${att.count !== undefined ? att.count : 'N/A'}</td>
                  <td>${att.llmFailureReason ? escapeHtml(att.llmFailureReason) : att.reason ? escapeHtml(att.reason) : '-'}</td>
                </tr>
                ${att.duplicateElements && att.duplicateElements.length > 0 ? `
                <tr>
                  <td colspan="5">
                    <div style="padding: 12px;">
                      <strong>🔴 Duplicate Elements Matched (${att.duplicateElements.length}):</strong>
                      <table class="duplicates-table" style="margin-top: 10px;">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Role</th>
                            <th>Aria Label</th>
                            <th>Text</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${att.duplicateElements.map((dup: any, di: any) => `
                          <tr>
                            <td>${di + 1}</td>
                            <td><code>${escapeHtml(dup.id)}</code></td>
                            <td><code>${escapeHtml(dup.name)}</code></td>
                            <td><code>${escapeHtml(dup.role)}</code></td>
                            <td><code>${escapeHtml(dup.ariaLabel)}</code></td>
                            <td>${escapeHtml(dup.text)}</td>
                          </tr>
                          `).join('')}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
                ` : ''}
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : ''}

          <div class="timestamp">🕐 ${new Date(entry.timestamp).toLocaleString()}</div>
        </div>
      `;
  }).join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playwright Self-Heal Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f5f5f5;
      color: #333;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { color: #222; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 3px solid #007bff; }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .stat-label { font-size: 12px; color: #999; text-transform: uppercase; margin-bottom: 5px; }
    .stat-value { font-size: 28px; font-weight: bold; }
    .stat-value.success { color: #28a745; }
    .stat-value.failed { color: #dc3545; }
    .stat-value.info { color: #17a2b8; }
    
    .healing-entry {
      background: white;
      border-left: 4px solid #007bff;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .healing-entry.success { border-left-color: #28a745; }
    .healing-entry.failed { border-left-color: #dc3545; }
    .healing-entry.cache_hit { border-left-color: #17a2b8; }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .test-name {
      font-weight: bold;
      font-size: 16px;
      color: #222;
    }
    .action-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      background: #e9ecef;
      color: #495057;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      color: white;
    }
    .status-badge.success { background: #28a745; }
    .status-badge.failed { background: #dc3545; }
    .status-badge.cache_hit { background: #17a2b8; }
    
    .info-row {
      margin: 10px 0;
      font-size: 14px;
    }
    .info-label {
      font-weight: 600;
      color: #666;
      display: inline-block;
      min-width: 140px;
    }
    .info-value {
      color: #333;
      word-break: break-all;
      font-family: 'Courier New', monospace;
      background: #f8f9fa;
      padding: 4px 8px;
      border-radius: 3px;
      display: inline-block;
      max-width: 600px;
    }
    
    .confidence {
      display: inline-block;
      margin-left: 10px;
      padding: 4px 8px;
      background: #e7f3ff;
      color: #0066cc;
      border-radius: 3px;
      font-size: 12px;
    }

    .failure-reasons {
      margin: 15px 0;
      padding: 12px;
      background: #fff8f0;
      border: 1px solid #ffc107;
      border-radius: 4px;
    }
    .failure-reason {
      margin: 8px 0;
      padding: 10px;
      background: white;
      border-left: 3px solid #ff9800;
      border-radius: 3px;
    }
    .failure-reason.script {
      border-left-color: #dc3545;
      background: #fdf8f7;
    }
    .failure-reason.llm {
      border-left-color: #ffc107;
      background: #fffbf0;
    }
    .failure-label {
      font-weight: 600;
      color: #333;
      font-size: 12px;
      text-transform: uppercase;
    }
    .failure-text {
      color: #d32f2f;
      margin-top: 4px;
      font-size: 13px;
      font-weight: 500;
    }
    
    .element-details {
      margin-top: 15px;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 4px;
      font-size: 13px;
    }
    .element-details h4 {
      margin-bottom: 12px;
      color: #222;
      font-size: 13px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 12px;
      background: white;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    thead {
      background: #f8f9fa;
      font-weight: 600;
      color: #555;
      border-bottom: 2px solid #dee2e6;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #dee2e6;
      word-break: break-word;
    }
    tr:hover { background: #f5f5f5; }
    tbody tr:last-child td { border-bottom: none; }
    
    tr.success { background: #f0fdf4; }
    tr.failed { background: #fdf8f7; }
    tr.cache_hit { background: #f0f8ff; }
    
    tr.success:hover { background: #dcfce7; }
    tr.failed:hover { background: #fee2e2; }
    tr.cache_hit:hover { background: #e0f2ff; }
    
    .duplicates-table {
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 4px;
    }
    .duplicates-table thead {
      background: #ffe69c;
    }
    
    code {
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
    }
    
    .timestamp {
      font-size: 12px;
      color: #999;
      margin-top: 10px;
      border-top: 1px solid #eee;
      padding-top: 10px;
    }
    
    @media (max-width: 768px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
      .header { flex-direction: column; align-items: flex-start; }
      .info-value { max-width: 100%; }
      table { font-size: 11px; }
      th, td { padding: 8px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔧 Playwright Self-Heal Report</h1>
    
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">🔧 Healing Attempts</div>
        <div class="stat-value">${healingAttempts.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">✅ Success</div>
        <div class="stat-value success">${successCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">❌ Failed</div>
        <div class="stat-value failed">${failedCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">⚡ Cache Reuses</div>
        <div class="stat-value info">${totalReuses}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Success Rate</div>
        <div class="stat-value">${healingAttempts.length > 0 ? Math.round((successCount / healingAttempts.length) * 100) : 0}%</div>
      </div>
    </div>

    <div style="margin-bottom: 30px;">
      <h3>📋 Summary Table</h3>
      <table style="width: 100%; margin-bottom: 20px;">
        <thead>
          <tr>
            <th>#</th>
            <th>Test</th>
            <th>Original Locator</th>
            <th>Healed Locator</th>
            <th>Status</th>
            <th>Strategy</th>
            <th>Confidence</th>
            <th>Reason for Healer Fail</th>
          </tr>
        </thead>
        <tbody>
          ${healingAttempts.map((entry, idx) => {
            // Calculate failure reason
            let failureReason = '-';
            if (entry.status === 'failed') {
              if (entry.attempts && entry.attempts.length > 0) {
                const failedAttempts = entry.attempts.filter((a: any) => a.result === 'failed');
                if (failedAttempts.length > 0) {
                  failureReason = failedAttempts.map((a: any) => a.llmFailureReason || a.reason || 'Unknown').join(' | ');
                }
              }
              if (!failureReason || failureReason === '-') {
                failureReason = entry.final || 'No valid locator found';
              }
            }
            
            return `
          <tr class="${entry.status}">
            <td>${idx + 1}</td>
            <td>${entry.test || 'Unknown'}</td>
            <td><code style="font-size: 10px;">${escapeHtml(entry.original)}</code></td>
            <td><code style="font-size: 10px;">${entry.healed ? escapeHtml(entry.healed) : '-'}</code></td>
            <td>${entry.status === 'success' ? '✅ Success' : '❌ Failed'}</td>
            <td>${entry.strategy.toUpperCase()}</td>
            <td>${entry.confidence ? (entry.confidence * 100).toFixed(0) + '%' : '-'}</td>
            <td style="color: ${entry.status === 'failed' ? '#d32f2f' : '#2e7d32'}; font-size: 12px;">${failureReason}</td>
          </tr>
          `;
          }).join('')}
          ${data.filter(d => d.status === 'cache_hit').map((entry, idx) => `
          <tr class="cache_hit">
            <td>${healingAttempts.length + idx + 1}</td>
            <td>${entry.test || 'Unknown'}</td>
            <td><code style="font-size: 10px;">${escapeHtml(entry.original)}</code></td>
            <td><code style="font-size: 10px;">${entry.healed ? escapeHtml(entry.healed) : '-'}</code></td>
            <td>⚡ Cache Hit</td>
            <td>CACHE</td>
            <td>-</td>
            <td>Reused ${entry.reuseCount} times</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div style="margin-bottom: 30px;">
      <h3>📖 Detailed Healing Attempts</h3>
      ${entriesHtml}
    </div>

    ${cacheHitCount > 0 ? `
    <div style="margin-bottom: 30px;">
      <h3>⚡ Cache Reuses (${cacheHitCount})</h3>
      ${data.filter(d => d.status === 'cache_hit').map((entry, idx) => `
        <div class="healing-entry cache_hit">
          <div class="header">
            <div>
              <div class="test-name">
                #${idx + 1} ${entry.test || 'Unknown Test'}
              </div>
            </div>
            <div>
              <span class="status-badge cache_hit">⚡ CACHE_HIT</span>
            </div>
          </div>

          <div class="info-row">
            <span class="info-label">Original:</span>
            <span class="info-value"><code>${escapeHtml(entry.original)}</code></span>
          </div>

          <div class="info-row">
            <span class="info-label">Healed:</span>
            <span class="info-value"><code>${escapeHtml(entry.healed)}</code></span>
          </div>

          <div class="info-row">
            <span class="info-label">Strategy:</span>
            <span class="info-value">${entry.strategy}</span>
          </div>

          <div class="info-row">
            <span class="info-label">⚡ Reused:</span>
            <span class="info-value">${entry.reuseCount} time(s) by actions [${entry.usedByActions?.join(', ')}]</span>
          </div>

          <div class="info-row" style="font-size: 12px; color: #666;">
            🕐 ${new Date(entry.timestamp).toLocaleString()}
          </div>
        </div>
      `).join('')}
    </div>
    ` : ''}
  </div>

  <script>
    console.log('📊 Report generated with ${data.length} healing entries');
  </script>
</body>
</html>
  `;

  fs.writeFileSync(htmlFilePath, html);
  console.log(`✅ HTML report generated: ${htmlFilePath}`);
}

function escapeHtml(str: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(str).replace(/[&<>"']/g, (s) => map[s]);
}