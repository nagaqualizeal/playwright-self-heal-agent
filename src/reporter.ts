import fs from 'fs';
import path from 'path';

const filePath = path.resolve('self-heal-report.json');

export function logHealing(entry: any) {
  let data: any[] = [];

  if (fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
    return;
  }

  const newEntry = {
    ...entry,
    timestamp: new Date().toISOString()
  };

  data.push(newEntry);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  console.log(`📝 Healing logged (${entry.status})`);
}