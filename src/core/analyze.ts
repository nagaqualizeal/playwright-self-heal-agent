export type FailureClassification = 'heal' | 'skip-actionability' | 'skip-negative-wait' | 'skip-unrelated';

// Playwright's own action error text includes a call log. When the element was
// actually found, that log contains a line like `locator resolved to <button ...>`
// — meaning the selector was fine and something else (hidden/disabled/covered/
// animating) kept the action from completing. Swapping the locator can't fix
// that, and doing so anyway risks silently acting on a different element while
// reporting the action as "healed".
const RESOLVED_TO_ELEMENT = /resolved to <\w/i;

const LOCATOR_FAILURE_HINTS = /not found|no element|strict mode violation|timeout/i;

export function classifyFailure(
  error: any,
  method: string,
  actionOptions?: { state?: string }
): FailureClassification {
  // A wait that's confirming something is gone (hidden/detached) succeeding at
  // "timing out" may just mean the negative outcome is correct — there's no
  // such thing as "a better locator for something that shouldn't be there".
  if (method === 'waitFor' && (actionOptions?.state === 'hidden' || actionOptions?.state === 'detached')) {
    return 'skip-negative-wait';
  }

  if (!error) return 'heal';

  const message = String(error.message || '');

  if (RESOLVED_TO_ELEMENT.test(message)) {
    return 'skip-actionability';
  }

  if (LOCATOR_FAILURE_HINTS.test(message)) {
    return 'heal';
  }

  return 'skip-unrelated';
}
