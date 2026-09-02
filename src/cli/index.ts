#!/usr/bin/env node
import { runCheckup } from './checkup';
import { runApply } from './apply';

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === 'checkup') {
    await runCheckup(rest);
    return;
  }

  if (command === 'apply') {
    await runApply(rest);
    return;
  }

  console.log('QASH — Qualizeal Automation Self Healer\n');
  console.log('Usage:');
  console.log('  npx qash-playwright checkup [--dir <path>]   Validate provider config, actionTimeout, and locator hygiene.');
  console.log('  npx qash-playwright apply [--dry-run|--yes]  Write successful heals back into your source files.');
  process.exitCode = command ? 1 : 0;
}

main();
