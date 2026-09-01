import { Page } from '@playwright/test';

// Matches either a quoted string ('text'/"text") or a regex literal (/pattern/flags),
// since Playwright's getBy* "name"/text arguments accept both, and the LLM often
// suggests a regex (e.g. { name: /forgot password/i }) for a case-insensitive/fuzzy match.
const STRING_OR_REGEX = `(\\/(?:\\\\.|[^\\/\\\\])+\\/[a-z]*|'[^']*'|"[^"]*")`;

// Parses a raw matched argument (still containing its quotes/slashes) into a
// real string or RegExp so it behaves the same as the literal would in source code.
function parseStringOrRegex(raw: string): string | RegExp {
  const regexLiteral = raw.match(/^\/((?:\\.|[^/\\])+)\/([a-z]*)$/i);
  if (regexLiteral) {
    try {
      return new RegExp(regexLiteral[1], regexLiteral[2]);
    } catch {
      // Fall through to treat it as a plain string if the regex is malformed
    }
  }

  const quoted = raw.match(/^['"]([^'"]*)['"]$/);
  return quoted ? quoted[1] : raw;
}

export function resolveLocator(page: Page, locatorStr: string) {
  // ==================== PLAYWRIGHT QUERY METHODS ====================

  // getByRole('button', { name: 'Login' }) or getByRole('link', { name: /forgot password/i })
  if (locatorStr.includes('getByRole')) {
    const roleMatch = locatorStr.match(/getByRole\(\s*['"]([^'"]+)['"]/);
    const nameMatch = locatorStr.match(new RegExp(`name:\\s*${STRING_OR_REGEX}`, 'i'));

    if (roleMatch) {
      const role = roleMatch[1];
      const name = nameMatch ? parseStringOrRegex(nameMatch[1]) : '';

      if (name) {
        return (page.getByRole as any)(role, { name });
      } else {
        return (page.getByRole as any)(role);
      }
    }
  }

  // getByText('Search') or getByText(/search/i)
  if (locatorStr.includes('getByText')) {
    const textMatch = locatorStr.match(new RegExp(`getByText\\(\\s*${STRING_OR_REGEX}`));
    if (textMatch) {
      return page.getByText(parseStringOrRegex(textMatch[1]));
    }
  }

  // getByPlaceholder('Username') or getByPlaceholder(/username/i)
  if (locatorStr.includes('getByPlaceholder')) {
    const placeholderMatch = locatorStr.match(new RegExp(`getByPlaceholder\\(\\s*${STRING_OR_REGEX}`));
    if (placeholderMatch) {
      return page.getByPlaceholder(parseStringOrRegex(placeholderMatch[1]));
    }
  }

  // getByLabel('Email') or getByLabel(/email/i)
  if (locatorStr.includes('getByLabel')) {
    const labelMatch = locatorStr.match(new RegExp(`getByLabel\\(\\s*${STRING_OR_REGEX}`));
    if (labelMatch) {
      return page.getByLabel(parseStringOrRegex(labelMatch[1]));
    }
  }
  
  // getByTestId('login-button')
  if (locatorStr.includes('getByTestId')) {
    const testIdMatch = locatorStr.match(/getByTestId\(\s*['"]([^'"]+)['"]/);
    if (testIdMatch) {
      return page.getByTestId(testIdMatch[1]);
    }
  }
  
  // ==================== FALLBACK SELECTORS ====================
  
  // ID selector: #user-name or page.locator('#user-name')
  if (locatorStr.includes('#')) {
    const idMatch = locatorStr.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      return page.locator(`#${idMatch[1]}`);
    }
  }
  
  // Data attribute: [data-test="value"] or [name="field"]
  if (locatorStr.includes('[')) {
    const attrMatch = locatorStr.match(/\[([^\]]+)\]/);
    if (attrMatch) {
      return page.locator(`[${attrMatch[1]}]`);
    }
  }
  
  // Class selector: .classname
  if (locatorStr.includes('.') && !locatorStr.includes('getBy')) {
    const classMatch = locatorStr.match(/\.([a-zA-Z0-9_-]+)/);
    if (classMatch) {
      return page.locator(`.${classMatch[1]}`);
    }
  }
  
  // XPath: //div[@id="..."] or //*[contains(...)]
  // Handle both raw XPath and page.locator('//...') format
  if (locatorStr.startsWith('//') || locatorStr.startsWith('xpath=')) {
    let xpathStr = locatorStr;
    
    // Extract XPath from page.locator('//...') format
    if (locatorStr.includes("page.locator('//")) {
      const match = locatorStr.match(/page\.locator\('(\/\/[^']+)'\)/);
      if (match) {
        xpathStr = match[1];
      }
    } else if (locatorStr.startsWith('xpath=')) {
      xpathStr = locatorStr.substring(6);
    }
    
    return page.locator(`xpath=${xpathStr}`);
  }
  
  // Handle page.locator('//...') format in the string
  if (locatorStr.includes("page.locator('//")) {
    const match = locatorStr.match(/page\.locator\('(\/\/[^']+)'\)/);
    if (match) {
      return page.locator(`xpath=${match[1]}`);
    }
  }
  
  // ==================== FALLBACK: Raw locator string ====================
  // If nothing matches, treat as CSS selector
  return page.locator(locatorStr);
}