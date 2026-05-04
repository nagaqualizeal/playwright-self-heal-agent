export function analyzeError(error: any): string {
  const msg = error?.message || '';

  if (msg.includes('strict mode violation')) return 'locator';
  if (msg.includes('not found')) return 'locator';

  // 🔥 NEW: handle null case (pre-check scenario)
  if (!error) return 'locator';

  return 'unknown';
}