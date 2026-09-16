import { Locator } from '@playwright/test';
import { loadConfig } from './config';
import { executeAction } from './executeAction';

// Only ever reached after a locator has already been successfully healed AND validated (it
// resolves to a real, visible element) but replaying the original action on it still failed —
// e.g. it's mid-animation, momentarily covered, or scrolled out of view. Off by default: unlike
// swapping in a different locator, `force: true` can make an action succeed in a way a real user
// couldn't actually trigger, so this is a deliberate escalation, not a default behavior.
export type ActionRecoveryTactic = 'scroll' | 'wait' | 'force';

export type ActionOutcome =
  | { ok: true; result: any; usedActionRecovery: boolean; tactic?: ActionRecoveryTactic }
  | { ok: false; error: any };

// Verified against Playwright's own Locator type definitions: only these methods among QASH's
// intercepted action set accept a `force` option. Retrying an unsupported method with `force`
// would either be silently ignored or throw a fresh, confusing error, so it's only attempted here.
const FORCE_CAPABLE_ACTIONS = new Set(['click', 'dblclick', 'check', 'uncheck', 'hover', 'tap', 'fill', 'selectOption']);

const WAIT_TACTIC_DELAY_MS = 500;

function withForceOption(args: any[]): any[] {
  const lastArg = args[args.length - 1];
  const hasOptionsObject = lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg);
  return hasOptionsObject ? [...args.slice(0, -1), { ...lastArg, force: true }] : [...args, { force: true }];
}

async function tryTactic(locator: Locator, method: string, args: any[], tactic: ActionRecoveryTactic): Promise<any> {
  switch (tactic) {
    case 'scroll':
      await locator.scrollIntoViewIfNeeded();
      return executeAction(locator, method, args);
    case 'wait':
      await new Promise((resolve) => setTimeout(resolve, WAIT_TACTIC_DELAY_MS));
      return executeAction(locator, method, args);
    case 'force':
      return executeAction(locator, method, withForceOption(args));
  }
}

// Runs the healed action once normally; if that fails and action-recovery is enabled, walks a
// fixed, ordered menu of tactics (scroll, then a short settle wait, then `force` where supported)
// and returns as soon as one succeeds. Reports which tactic worked (if any) so the caller can
// reflect it in the heal report — a recovered action is a weaker outcome than a clean first try.
export async function runHealedAction(locator: Locator, method: string, args: any[]): Promise<ActionOutcome> {
  try {
    const result = await executeAction(locator, method, args);
    return { ok: true, result, usedActionRecovery: false };
  } catch (firstError) {
    if (!loadConfig().actionRecoveryEnabled) return { ok: false, error: firstError };

    const tactics: ActionRecoveryTactic[] = ['scroll', 'wait'];
    if (FORCE_CAPABLE_ACTIONS.has(method)) tactics.push('force');

    for (const tactic of tactics) {
      try {
        const result = await tryTactic(locator, method, args, tactic);
        return { ok: true, result, usedActionRecovery: true, tactic };
      } catch {
        // Try the next tactic — only the original failure is worth surfacing if none of them help.
      }
    }

    return { ok: false, error: firstError };
  }
}
