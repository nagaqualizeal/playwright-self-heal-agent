import { Locator } from '@playwright/test';

// Turns an already-resolved, already-confirmed-correct live element (from an `aria-ref=` hit or a
// vision-tagged element) into a portable Playwright locator string worth caching and reporting.
// `aria-ref=` ids and vision tags are both one-off — meaningless on the next page load — so without
// this step there would be nothing stable to save at all. Reads the element's OWN real attributes
// only (never guesses), in a fixed preference order from most to least resistant to markup churn.

export type DerivedLocator = { code: string; quality: 'strong' | 'weak' };

type ElementFacts = {
  tag: string;
  role: string | null;
  ariaLabel: string | null;
  testId: string | null;
  placeholder: string | null;
  id: string | null;
  text: string;
  type: string | null;
};

// Covers the common interactive elements a test is likely to target; anything else falls through
// to the next preference tier rather than guessing at a role ARIA wouldn't actually assign.
const IMPLICIT_ROLE_BY_TAG: Record<string, string> = {
  button: 'button',
  a: 'link',
  select: 'combobox',
  textarea: 'textbox',
  img: 'img',
};

const IMPLICIT_ROLE_BY_INPUT_TYPE: Record<string, string> = {
  text: 'textbox',
  search: 'searchbox',
  email: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  number: 'spinbutton',
  password: 'textbox',
  checkbox: 'checkbox',
  radio: 'radio',
  button: 'button',
  submit: 'button',
};

function inferImplicitRole(tag: string, type: string | null): string | null {
  if (tag === 'input') return IMPLICIT_ROLE_BY_INPUT_TYPE[type || 'text'] || 'textbox';
  return IMPLICIT_ROLE_BY_TAG[tag] || null;
}

function escapeForSingleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function readElementFacts(resolved: Locator): Promise<ElementFacts | null> {
  try {
    return await resolved.evaluate((el: any) => ({
      tag: el.tagName?.toLowerCase() || '',
      role: el.getAttribute('role') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || null,
      placeholder: el.getAttribute('placeholder') || null,
      id: el.id || null,
      text: (el.innerText || el.textContent || '').trim().slice(0, 80),
      type: el.getAttribute('type') || null,
    }));
  } catch {
    return null;
  }
}

export async function deriveDurableLocator(resolved: Locator): Promise<DerivedLocator | null> {
  const facts = await readElementFacts(resolved);
  if (!facts) return null;

  if (facts.testId) {
    return { code: `page.getByTestId('${escapeForSingleQuotes(facts.testId)}')`, quality: 'strong' };
  }

  const role = facts.role || inferImplicitRole(facts.tag, facts.type);
  const accessibleName = facts.ariaLabel || facts.text;
  if (role && accessibleName) {
    return { code: `page.getByRole('${role}', { name: '${escapeForSingleQuotes(accessibleName)}' })`, quality: 'strong' };
  }

  if (facts.placeholder) {
    return { code: `page.getByPlaceholder('${escapeForSingleQuotes(facts.placeholder)}')`, quality: 'strong' };
  }

  // Plain visible text with no role/name pairing is a materially weaker signal — it can't be
  // narrowed to "this specific control", only "something showing this text" — so it's flagged for
  // review by the caller (see evaluateReviewNeed) rather than treated as a confident fix.
  if (accessibleName) {
    return { code: `page.getByText('${escapeForSingleQuotes(accessibleName)}', { exact: true })`, quality: 'weak' };
  }

  if (facts.id) {
    return { code: `page.locator('[id="${escapeForSingleQuotes(facts.id)}"]')`, quality: 'weak' };
  }

  return null;
}
