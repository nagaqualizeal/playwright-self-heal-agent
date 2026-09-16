import { Locator } from '@playwright/test';

// Applied on every replay of an already-validated locator (a cache hit, a freshly-validated LLM
// suggestion, or an action-recovery retry): validateLocator just confirmed the element is real and
// visible, so the action itself should resolve almost instantly — this short budget catches a
// genuinely stuck action fast instead of waiting through the full configured actionTimeout again.
export const SHORT_TIMEOUT = 2000;

export async function executeAction(locator: Locator, method: string, args: any[]): Promise<any> {
  const fn = (locator as any)[method];
  if (typeof fn !== 'function') throw new Error(`Unsupported action for healing: ${method}`);

  const lastArg = args[args.length - 1];
  const hasOptionsObject = lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg);
  const callArgs = hasOptionsObject
    ? [...args.slice(0, -1), { ...lastArg, timeout: SHORT_TIMEOUT }]
    : [...args, { timeout: SHORT_TIMEOUT }];

  return fn.apply(locator, callArgs);
}
