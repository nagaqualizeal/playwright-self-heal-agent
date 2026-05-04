import fs from 'fs';

const FILE = 'self-heal-report.json';

// 🔍 Get cached locator
export function getCachedLocator(original: string): string | null {
  if (!fs.existsSync(FILE)) return null;

  const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));

  const entry = data.find((item: any) => item.original === original);

  return entry ? entry.healed : null;
}