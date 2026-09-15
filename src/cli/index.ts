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
  console.log('  npx qash-playwright apply [--dry-run] [--yes] [--only 1,3|2-4]');
  console.log('                                                Write successful heals back into your source files.');
  console.log('                                                Interactive by default: lists every heal and asks which');
  console.log('                                                to apply (all / number / list / range / stop). --dry-run');
  console.log('                                                only disables the "all" shortcut — an explicit selection');
  console.log('                                                still writes for real. --yes and --only are for');
  console.log('                                                non-interactive/CI use.');
  process.exitCode = command ? 1 : 0;
}

main();
