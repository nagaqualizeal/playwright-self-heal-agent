# QASH — Qualizeal Automation Self Healer

AI-powered self-healing for Playwright locators. When a `click`, `fill`, or similar
action fails because its locator broke, QASH captures the page's accessibility
tree, asks a configured AI provider to find the element's new location, retries
the action, and — if it worked — caches the fix so the same call site doesn't
pay for another AI call again within that run.

## Install

```sh
npm install qash-playwright
```

## Configure a provider

Copy `.env.example` to `.env` and fill in one provider:

```sh
HEALER_ENABLED=true
HEALER_PROVIDER=openai   # openai | anthropic | gemini | ollama | ollama-local

OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-...
```

See `.env.example` for the other providers' variables.

## Set `actionTimeout` in your `playwright.config.ts`

Playwright lets a broken locator retry silently for your entire test `timeout`
before it ever throws — which means QASH never gets a turn, since it only
activates once an action actually fails. Set `actionTimeout` well below your
test `timeout`:

```ts
export default defineConfig({
  timeout: 30_000,
  use: {
    actionTimeout: 10_000,
  },
});
```

QASH reads this same value as its own healing budget, so a slow provider call
can never outlast the timeout your project already configured.

## Use it in your tests

Change one import — everything else about how you write tests stays the same:

```ts
// Before
import { test, expect } from '@playwright/test';

// After
import { test, expect } from 'qash-playwright';
```

```ts
import { test, expect } from 'qash-playwright';

test('logs in', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="username"]').describe('Username textbox').fill('demo');
  await page.locator('button[type="submit"]').describe('Login button').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
```

New tabs, popups, and elements inside `<iframe>`s are healing-aware automatically
— no extra fixture or wrapping needed for any of them.

Not using the `@playwright/test` fixtures? Wrap a page manually:

```ts
import { bind } from 'qash-playwright';

const page = bind(await context.newPage());
```

### A quick tip for better results

Chain `.describe('...')` onto a locator so QASH knows what it's actually
looking for — this matters most for plain CSS/XPath selectors, which carry no
readable intent of their own:

```ts
const usernameField = page.locator('input[name="username"]').describe('Username textbox');
```

If you skip `.describe()` but name your locator variables descriptively
(`txtUsername`, `submitButton`), QASH decodes that name into the same kind of
description for free — `.describe()` still wins when both are present.

## What gets healed, and what never does

QASH only ever touches `click`, `fill`, `check`, `uncheck`, `selectOption`,
`press`, `type`, `hover`, `tap`, `focus`, `waitFor`, `scrollIntoViewIfNeeded`,
and `setInputFiles`. Everything else — `isVisible`, `isHidden`, `count`, `all`,
and every `expect(...)` assertion — is never intercepted at all, so a
conditional check like `if (await locator.isVisible())` is never healed and
never affected by QASH being installed.

Within the methods above, two situations are deliberately skipped even when
the action fails:

- **The element was found but couldn't be acted on** (hidden, disabled,
  covered, still animating). Playwright's own error text says as much — in
  that case the locator wasn't the problem, so swapping it can't fix it and
  risks silently acting on the wrong element instead.
- **A `waitFor({ state: 'hidden' | 'detached' })` times out.** That kind of
  wait is confirming something is *gone* — there's no such thing as "a better
  locator for something that shouldn't exist." `waitFor({ state: 'visible' }
  )` (or the default `'attached'`), the common "wait for it, then interact"
  pattern, is healed like any other action.

## Reports

Every heal attempt is written to `qash-heal-report.json` and rendered as
`qash-heal-report.html`, reset at the start of each test run. Each entry
records the test name, the **page URL** the failure happened on, the source
`file:line` the locator was declared at, the original and healed locator, and
— on failure — why every candidate was rejected.

The same information is also mirrored into **Playwright's own HTML report**
(`playwright-report/index.html`, or whatever `reporter` your project
configures): every heal, cache hit, or heal failure shows up as an annotation
on its test (`qash-healed`, `qash-cache-hit`, `qash-heal-failed`), with the
full entry attached as downloadable JSON. Click into an individual test to see
it — the report's landing page itself still just shows pass/fail, same as
without QASH.

## Caching

A successful heal is cached by **selector + declaration site**, not by
selector text alone — so two different pages that happen to share a broken
selector never cross-apply a fix computed for the wrong element. A cache hit
skips both the AI call and, for locator-based actions, the wait itself: the
cached locator is tried immediately instead of waiting through the full
`actionTimeout` first.

The cache is scoped to **one run**, not persisted indefinitely: within a
single `npx playwright test` invocation, every test shares it (test 2 reuses
whatever test 1 already healed at the same location), but the next separate
invocation — another single test, another full suite run — starts from a
clean cache automatically. This keeps "did this actually heal just now"
unambiguous run to run, at the cost of re-paying for an AI call on a
still-broken locator every time you run again. `qash-playwright apply`
(below) landing the fix into source is what actually stops paying for the
same heal repeatedly, run after run.

## `qash-playwright checkup`

Validates your setup before you rely on it:

```sh
npx qash-playwright checkup
```

Checks provider connectivity (a real call, within your actual configured
timeout), whether `actionTimeout` is set and has real headroom below your test
`timeout`, which locators are missing a `.describe()` label, and which
locators are declared directly in test files instead of a Page Object.

The locator-hygiene checks scan `testDir` (default `tests`, override via
`qash.config.json` — see below). If your tests live somewhere else, point at
it directly instead:

```sh
npx qash-playwright checkup --dir <path-to-your-tests>
```

Connectivity and `actionTimeout` are checked either way, `--dir` only affects
the two locator-scanning checks.

## `qash-playwright apply`

A runtime heal is a point-in-time fix — it's only as durable as the AI's guess
happened to be for that one run. `apply` reads every successful heal and
rewrites the actual source line it came from, so future runs don't need to
heal (or pay for an AI call) at all.

Run it with no flags for an interactive session — it lists every heal,
numbered, with the source location, the enclosing method (`(in get
forgotPassword())`, `(in fillUsername())`, etc. — the method that actually
contains the locator, not whatever else happens to call it), and the
before/after diff:

```sh
npx qash-playwright apply
```

```
Found 2 successful heal(s):

[1] loginPage.ts:14  (in get submitButton())
    - return this.page.locator('.old-submit-class');
    + return this.page.getByRole('button', { name: 'Submit' });

[2] resetPage.ts:5  (in get passwordTextbox())
    - return this.page.locator('#encPasswordmain').describe('Password textbox');
    + return this.page.getByRole('textbox', { name: '...' }).describe('Password textbox');

Apply which? [all / number / list e.g. 1,3 / range e.g. 1-2 / stop] (2 remaining):
```

Type `all` to write everything, a number/list/range (e.g. `1`, `1,3`, `1-2`)
to write just those — each selection writes immediately, and you're asked
again for whatever's left, until you type `stop`.

`--dry-run` only disables the `all` shortcut — it won't let you bulk-apply
everything unreviewed. An explicit selection (a number, a list, a range)
still writes for real even under `--dry-run`; that's deliberate; use it to
apply specific ones now while previewing the rest before deciding on them.

For non-interactive/CI use:

```sh
npx qash-playwright apply --yes         # write everything, no prompts
npx qash-playwright apply --only 1,3    # write specific ones, no prompts
npx qash-playwright apply --only 2-4    # a range works too
```

Nothing is ever committed automatically — review the diff yourself before
committing, the same way you would any other code change.

## Config file

`qash.config.json` (optional) can override where QASH reads tests from and
writes its report/cache:

```json
{
  "testDir": "tests",
  "reportJsonPath": "qash-heal-report.json",
  "reportHtmlPath": "qash-heal-report.html",
  "cachePath": ".qash-cache.json"
}
```

## Trying it in an existing project

To evaluate QASH against a real test suite rather than a fresh install:

1. Build and pack it from source: `npm run build && npm pack` (produces
   `qash-playwright-<version>.tgz` in this repo's root).
2. In your test project: `npm install /path/to/qash-playwright-<version>.tgz`.
   This adds it to `package.json`/`package-lock.json` like any other dependency.
3. Set the QASH variables in your project's environment: if you already have
   an `.env` file, add `HEALER_ENABLED`/`HEALER_PROVIDER`/the model variables
   to it; otherwise copy `.env.example` to `.env` in your project root.
4. Change **one test file's** import from `@playwright/test` to
   `qash-playwright` (or from whatever custom fixture you were using before) —
   start with a single file, not the whole suite, for your first try. If you
   had a fixture whose only job was registering a self-healer on new
   pages/tabs, it can be deleted once you've migrated off it — QASH covers
   that automatically, no fixture needed.
5. Check `use.actionTimeout` in `playwright.config.ts` (see above) — add it
   if it isn't already set; QASH just reads whatever value is there.
6. Run `npx qash-playwright checkup --dir <path-to-your-tests>` (the default
   is `tests` — pass `--dir` if yours live elsewhere) to confirm the provider
   is reachable and see any locator-hygiene warnings before running anything.
7. Run just that one file (`npx playwright test path/to/that.spec.ts`), not
   your whole suite — a broken locator adds a real AI call and a real wait
   the first time it's hit, so validate on one file before scaling up. Check
   `qash-heal-report.html` for the aggregate view, or your usual Playwright
   report for the per-test annotations, to see what (if anything) got healed.
8. Once you're happy with what a heal actually did, use `npx qash-playwright
   apply` (see above) to land it in source permanently, rather than
   re-healing (and re-paying for it) on every future run.

Since this evaluates real, possibly-sensitive test flows, start with a
disposable/throwaway branch and a provider you're comfortable sending page
content to.

## Not in this version

- Vision-based (screenshot) healing — text/accessibility-tree healing only, for now.
- Subscription-based providers (using an existing Claude Code / GitHub Copilot
  login instead of an API key) — the four providers above all use a plain API key.
- A dedicated Cucumber integration — `bind(page)` works from any runner's own
  hooks today, but there's no packaged Cucumber-specific wiring yet.

## License

MIT
