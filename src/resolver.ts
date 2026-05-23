import { Page } from '@playwright/test';

export function resolveLocator(page: Page, locatorStr: string) {
  // ==================== PLAYWRIGHT QUERY METHODS ====================
  
  // getByRole('button', { name: 'Login' })
  if (locatorStr.includes('getByRole')) {
    const roleMatch = locatorStr.match(/getByRole\(\s*['"]([^'"]+)['"]/);
    const nameMatch = locatorStr.match(/name:\s*['"]([^'"]+)['"]/);
    
    if (roleMatch) {
      const role = roleMatch[1];
      const name = nameMatch ? nameMatch[1] : '';
      
      if (name) {
        return (page.getByRole as any)(role, { name });
      } else {
        return (page.getByRole as any)(role);
      }
    }
  }
  
  // getByText('Search')
  if (locatorStr.includes('getByText')) {
    const textMatch = locatorStr.match(/getByText\(\s*['"]([^'"]+)['"]/);
    if (textMatch) {
      return page.getByText(textMatch[1]);
    }
  }
  
  // getByPlaceholder('Username')
  if (locatorStr.includes('getByPlaceholder')) {
    const placeholderMatch = locatorStr.match(/getByPlaceholder\(\s*['"]([^'"]+)['"]/);
    if (placeholderMatch) {
      return page.getByPlaceholder(placeholderMatch[1]);
    }
  }
  
  // getByLabel('Email')
  if (locatorStr.includes('getByLabel')) {
    const labelMatch = locatorStr.match(/getByLabel\(\s*['"]([^'"]+)['"]/);
    if (labelMatch) {
      return page.getByLabel(labelMatch[1]);
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