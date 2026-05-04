# Playwright Self-Heal Agent

An intelligent Playwright test framework extension that automatically detects and heals broken selectors/locators using AI (OpenAI or Claude). When a test fails due to a missing or invalid element locator, this agent suggests alternative selectors and validates them before updating your tests.

## Features

- 🤖 **AI-Powered Healing**: Uses LLM (OpenAI/Claude) to suggest alternative selectors
- 🔄 **Automatic Caching**: Caches healed selectors to avoid redundant API calls
- ✅ **Validation**: Validates suggested selectors before applying them
- 📝 **Detailed Reporting**: Logs all healing attempts with timestamps and results
- 🔧 **Easy Integration**: Works seamlessly with Playwright Test framework
- ⚡ **Fast Recovery**: Pre-checks and caches reduce test execution overhead

## Project Structure

### Source Files (`src/`)

| File | Purpose |
|------|---------|
| **register.ts** | Entry point that extends Playwright's `test` object with self-healing capabilities. Patches the page object for all tests. |
| **patcher.ts** | Intercepts Playwright page methods (click, fill, etc.) and triggers healing when actions fail or selectors are not found. |
| **analyzer.ts** | Analyzes error messages to determine the error type (primarily detects locator/selector errors). |
| **llmClient.ts** | Communicates with LLM providers (OpenAI or Claude) to get suggestions for alternative selectors. Reads configuration from `.selfhealrc.json`. |
| **resolver.ts** | Converts LLM-suggested selector strings into actual Playwright locator objects (handles xpath, getByRole, getByText, CSS selectors). |
| **validator.ts** | Validates suggested locators by checking if they exist and are visible on the page before applying them. |
| **healer.ts** | Main healing orchestrator that combines analyzer, LLM client, resolver, and validator to fix broken selectors. Manages caching via `.selfheal-cache.json`. |
| **cache.ts** | Utility functions for reading/writing cached locators to prevent redundant LLM API calls. |
| **reporter.ts** | Logs all healing attempts to `self-heal-report.json` with status, original selector, healed selector, and timestamp. Prevents duplicate entries. |

## Installation

### Prerequisites

- Node.js >= 16
- Playwright >= 1.40.0
- API key for OpenAI or Claude (depending on your LLM choice)

### Install Dependencies

```bash
npm install
```

### Configuration

Create a `.selfhealrc.json` file in your project root:

```json
{
  "llmProvider": "openai",
  "openai": {
    "model": "gpt-4"
  },
  "claude": {
    "model": "claude-3-sonnet-20240229"
  }
}
```

Create a `.env` file for API keys:

```env
OPENAI_API_KEY=sk-your-key-here
CLAUDE_API_KEY=sk-ant-your-key-here
```

## Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

This generates compiled `.js` and `.d.ts` files in the `dist/` directory.

## Pack

Create a distributable package:

```bash
npm pack
```

This generates `playwright-self-heal-agent-1.0.0.tgz` that can be published to npm or used locally.

### Install from Package

```bash
npm install playwright-self-heal-agent-1.0.0.tgz
```

## Usage in Playwright Framework

### 1. Import the Extended Test Object

In your test file (`tests/example.spec.ts`):

```typescript
import { test, expect } from 'playwright-self-heal-agent';

test('example test with self-healing', async ({ page }) => {
  await page.goto('https://example.com');
  
  // If this selector fails, the agent will auto-heal it
  await page.click('button.old-selector-that-no-longer-exists');
  
  // Continue with assertions
  expect(await page.isVisible('button')).toBe(true);
});
```

### 2. How It Works

1. **Test Execution**: Your test runs normally with the patched `page` object
2. **Failure Detection**: If `page.click()`, `page.fill()`, or other actions fail:
   - Pre-check: Immediately checks if the element exists
   - If not found, healing is triggered
3. **LLM Analysis**: The original selector is sent to the LLM with page context
4. **Suggestion**: LLM returns alternative selectors to try
5. **Validation**: Each suggestion is tested on the actual page
6. **Application**: First valid selector is applied and cached
7. **Logging**: Result is logged to `self-heal-report.json`

### 3. Monitor Healing Results

Check the healing report:

```bash
cat self-heal-report.json
```

Sample output:
```json
[
  {
    "original": "button.old-class",
    "healed": "button:has-text('Submit')",
    "action": "click",
    "status": "healed",
    "test": "example-suite → example test",
    "timestamp": "2024-05-04T10:30:45.123Z"
  }
]
```

### 4. Check Cache

Cached selectors are stored in `.selfheal-cache.json`:

```json
{
  "button.old-class": "button:has-text('Submit')",
  "input#email": "input[placeholder='Email Address']"
}
```

## Example Test File

```typescript
import { test, expect } from 'playwright-self-heal-agent';

test.describe('Login Tests', () => {
  test('user can login', async ({ page }) => {
    await page.goto('https://app.example.com/login');
    
    // These might be broken, but the agent will fix them
    await page.fill('input[name=email]', 'user@example.com');
    await page.fill('input[name=password]', 'password123');
    await page.click('button.login-btn');
    
    // Verify success
    await page.waitForURL('**/dashboard');
    expect(await page.isVisible('text=Dashboard')).toBe(true);
  });
});
```

## Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key (if using OpenAI)
- `CLAUDE_API_KEY`: Your Anthropic Claude API key (if using Claude)

## Supported LLM Providers

- **OpenAI**: GPT-4, GPT-3.5-turbo
- **Claude**: Claude 3 Sonnet, Claude 3 Opus

## Troubleshooting

### No healing happening
- Check `.selfhealrc.json` exists and is valid JSON
- Verify API key is set in `.env`
- Check console logs for error messages

### API rate limits
- The caching mechanism reduces unnecessary API calls
- Configure model in `.selfhealrc.json` to use a faster/cheaper model

### Invalid suggestions
- Improve your test's error context
- Consider using more specific selectors initially
- Review suggestions in `self-heal-report.json`

## Performance Tips

1. **Use caching**: The first healed selector is cached automatically
2. **Monitor logs**: Review `self-heal-report.json` regularly to identify patterns
3. **Update tests**: After healing, manually review and update your test code for long-term stability
4. **API costs**: Use Claude for cost savings or GPT-3.5 for basic healing

## License

MIT
