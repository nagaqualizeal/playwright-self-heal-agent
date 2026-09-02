// Playwright's Locator.describe(text) bakes the description into the selector
// string itself as `>> internal:describe="<json-escaped text>"`. Reading it back
// off the live selector gives us the developer's own stated intent, which is a
// stronger signal than anything inferred from the selector text.
export function extractDescribedLabel(selector: string): string | null {
  if (!selector) return null;

  const match = selector.match(/internal:describe=("(?:[^"\\]|\\.)*")/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

const PREFIX_WORDS: Record<string, string> = {
  txt: 'textbox',
  input: 'textbox',
  btn: 'button',
  lnk: 'link',
  link: 'link',
  chk: 'checkbox',
  radio: 'radio button',
  rdo: 'radio button',
  sel: 'dropdown',
  select: 'dropdown',
  ddl: 'dropdown',
  lbl: 'label',
  img: 'image',
  tbl: 'table',
  icon: 'icon',
  msg: 'message',
  err: 'error message',
};

const SUFFIX_WORDS: Record<string, string> = {
  button: 'button',
  btn: 'button',
  input: 'textbox',
  field: 'textbox',
  textbox: 'textbox',
  link: 'link',
  checkbox: 'checkbox',
  dropdown: 'dropdown',
  select: 'dropdown',
  label: 'label',
  icon: 'icon',
};

function splitIdentifier(name: string): string[] {
  return name
    .replace(/^(this\.)?/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Decodes a Page-Object-style variable name (txtUsername, submitButton, chkAgree)
// into a human-readable description, so undescribed locators still give the
// healer something better to reason from than a bare broken selector.
export function inferDescriptionFromVariableName(variableName: string | null | undefined): string | null {
  if (!variableName) return null;

  const words = splitIdentifier(variableName).map((w) => w.toLowerCase());
  if (words.length === 0) return null;

  let elementType: string | null = null;
  let labelWords = words;

  if (PREFIX_WORDS[words[0]]) {
    elementType = PREFIX_WORDS[words[0]];
    labelWords = words.slice(1);
  } else if (SUFFIX_WORDS[words[words.length - 1]]) {
    elementType = SUFFIX_WORDS[words[words.length - 1]];
    labelWords = words.slice(0, -1);
  }

  if (labelWords.length === 0 && !elementType) return null;

  const label = labelWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  if (!label) return elementType;
  return elementType ? `${label} (${elementType})` : label;
}

// Best-effort extraction of the variable/property name a locator was assigned to,
// by reading the source line the locator was declared on (e.g. "const txtUserName
// = page.locator(...)" or "this.submitButton = page.getByRole(...)").
export function extractVariableNameFromSourceLine(file: string, line: number): string | null {
  try {
    const fs = require('fs');
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    const sourceLine = lines[line - 1];
    if (!sourceLine) return null;

    const match = sourceLine.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)|this\.([A-Za-z_$][\w$]*)\s*=|get\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (!match) return null;

    return match[1] || match[2] || match[3] || null;
  } catch {
    return null;
  }
}
