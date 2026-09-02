import { Page, Locator, FrameLocator } from '@playwright/test';

// Matches either a quoted string ('text'/"text") or a regex literal (/pattern/flags),
// since Playwright's getBy* "name"/text arguments accept both, and a model will
// often suggest a regex (e.g. { name: /forgot password/i }) for a fuzzy match.
const STRING_OR_REGEX = `(\\/(?:\\\\.|[^\\/\\\\])+\\/[a-z]*|'[^']*'|"[^"]*")`;

function parseStringOrRegex(raw: string): string | RegExp {
  const regexLiteral = raw.match(/^\/((?:\\.|[^/\\])+)\/([a-z]*)$/i);
  if (regexLiteral) {
    try {
      return new RegExp(regexLiteral[1], regexLiteral[2]);
    } catch {
      // Fall through and treat it as a plain string if the regex is malformed.
    }
  }

  const quoted = raw.match(/^['"]([^'"]*)['"]$/);
  return quoted ? quoted[1] : raw;
}

export function resolveLocator(target: Page | FrameLocator, locatorStr: string): Locator {
  if (locatorStr.includes('getByRole')) {
    const roleMatch = locatorStr.match(/getByRole\(\s*['"]([^'"]+)['"]/);
    const nameMatch = locatorStr.match(new RegExp(`name:\\s*${STRING_OR_REGEX}`, 'i'));
    if (roleMatch) {
      const role = roleMatch[1] as any;
      const name = nameMatch ? parseStringOrRegex(nameMatch[1]) : '';
      return name ? target.getByRole(role, { name }) : target.getByRole(role);
    }
  }

  if (locatorStr.includes('getByText')) {
    const textMatch = locatorStr.match(new RegExp(`getByText\\(\\s*${STRING_OR_REGEX}`));
    if (textMatch) return target.getByText(parseStringOrRegex(textMatch[1]));
  }

  if (locatorStr.includes('getByPlaceholder')) {
    const placeholderMatch = locatorStr.match(new RegExp(`getByPlaceholder\\(\\s*${STRING_OR_REGEX}`));
    if (placeholderMatch) return target.getByPlaceholder(parseStringOrRegex(placeholderMatch[1]));
  }

  if (locatorStr.includes('getByLabel')) {
    const labelMatch = locatorStr.match(new RegExp(`getByLabel\\(\\s*${STRING_OR_REGEX}`));
    if (labelMatch) return target.getByLabel(parseStringOrRegex(labelMatch[1]));
  }

  if (locatorStr.includes('getByTestId')) {
    const testIdMatch = locatorStr.match(/getByTestId\(\s*['"]([^'"]+)['"]/);
    if (testIdMatch) return target.getByTestId(testIdMatch[1]);
  }

  if (locatorStr.includes('getByAltText')) {
    const altMatch = locatorStr.match(new RegExp(`getByAltText\\(\\s*${STRING_OR_REGEX}`));
    if (altMatch) return target.getByAltText(parseStringOrRegex(altMatch[1]));
  }

  if (locatorStr.includes('getByTitle')) {
    const titleMatch = locatorStr.match(new RegExp(`getByTitle\\(\\s*${STRING_OR_REGEX}`));
    if (titleMatch) return target.getByTitle(parseStringOrRegex(titleMatch[1]));
  }

  const pageLocatorMatch = locatorStr.match(/page\.locator\((['"])((?:\\.|(?!\1).)*)\1\)/);
  if (pageLocatorMatch) return target.locator(pageLocatorMatch[2]);

  if (locatorStr.startsWith('xpath=')) return target.locator(locatorStr);
  if (locatorStr.startsWith('//')) return target.locator(`xpath=${locatorStr}`);

  if (locatorStr.startsWith('#') || locatorStr.startsWith('.') || locatorStr.startsWith('[')) {
    return target.locator(locatorStr);
  }

  // Unrecognized shape — treat the raw string as a CSS selector, Playwright's own
  // default interpretation for a plain string passed to `.locator()`.
  return target.locator(locatorStr);
}
