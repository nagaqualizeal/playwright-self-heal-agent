# QASH — Qualizeal Automation Self Healer

AI-powered self-healing for Playwright locators. When a `click`, `fill`, or similar
action fails because its locator broke, QASH first tries to match it for free
against the page's accessibility tree, then — only if that's not confident enough
— asks a configured AI provider to point at the element's new location, retries
the action, and — if it worked — caches the fix so the same call site doesn't
pay for another AI call again within that run.

## Install

QASH isn't published to the public npm registry yet, so for now it's installed
from a local build rather than a plain `npm install qash-playwright`:

```sh
# Build and pack it from source (in this repo) — run as two separate
# commands, not chained with && (Windows PowerShell doesn't support that
# as a statement separator; this works in every shell):
npm run build
npm pack
# → produces qash-playwright-<version>.tgz

# In your test project:
npm install /path/to/qash-playwright-<version>.tgz
```

This adds it to your project's `package.json`/`package-lock.json` like any
other dependency — nothing further to wire up for the install itself.

## Configure a provider

If your project already has an `.env` file, just add these to it; otherwise
copy `.env.example` to `.env` in your project root:

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
test `timeout` (add it if it isn't already set — QASH just reads whatever
value is there):

```ts
export default defineConfig({
  timeout: 30000,
  use: {
    actionTimeout: 10000,
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
— no extra fixture or wrapping needed for any of them. If you had a custom
fixture whose only job was registering a self-healer on new pages/tabs, it can
be deleted once you've migrated off it.

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

`.describe()` (or a decodable variable name) is the single most leveraged
piece of information you can give QASH — it's the *only* signal the free
rule-based pass below has to work with, and it's what turns the AI pass from
"guess from a dead selector" into "confirm a stated intent."

## How a heal is resolved

A broken locator goes through up to three passes, cheapest first, each one
only reached if the previous one couldn't confidently resolve it:

1. **Rule-based matching (free, no AI call).** Matches the element's
   description directly against the accessibility tree using plain text
   scoring — no model, no network, no cost. It only accepts a match when it's
   unambiguous; anything less certain is left alone rather than guessed at, so
   it falls through to the next pass. This is what heals the common case — an
   id/class changed but the visible label or accessible name didn't — for
   free and near-instantly.
2. **AI, ref-based.** The accessibility tree is captured with Playwright's
   `mode: 'ai'`, which tags every node with a `[ref=eN]` id. The AI is asked
   to point at the target node's ref rather than write a locator string
   itself — a ref resolves via Playwright's own `aria-ref=` locator engine to
   the literal node the tree enumerated, so it can't be subtly wrong the way
   a hand-written selector guess can. (The AI can still fall back to writing
   a locator string itself — `getByRole`, `getByText`, etc. — when it can't
   confidently map the failure to a single ref.) Since a ref is only valid
   for the current page load, a separate deterministic step then reads the
   *confirmed* element's own real attributes — test id, role + accessible
   name, placeholder, visible text, id, in that preference order — and builds
   a normal, portable locator string from them. That's what actually gets
   cached and reported; the ref itself never is.
3. **Vision fallback (last resort).** Only reached when both passes above
   found nothing, and only for a provider that supports it (OpenAI and
   Anthropic today — see [Providers](#providers) below). Takes a full-page
   screenshot, asks the AI to point at the element visually, resolves that
   point back to a real DOM node via `elementFromPoint`, and runs the same
   durable-locator derivation as the ref-based pass on whatever it found. Not
   guaranteed to produce a durable fix (a decorative element with no name,
   role, or id has nothing to derive from), but the *action* still succeeds
   for that run either way. Scoped to the main page only, not content inside
   an `<iframe>`.

Whichever pass succeeds, the result is validated against the live page before
anything is trusted: a strict pass (exactly one match) is preferred; a
relaxed pass (best candidate among several matches, closest to the
description) is only used if strict finds nothing.

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

If your own code deliberately treats a wait as optional (wrapped in a
`try`/`catch` that swallows the failure, e.g. a spinner/loading-indicator
check that's expected to sometimes not fire), be aware QASH can't distinguish
that intent from a genuinely broken locator — it will still attempt to heal
it. There's no per-call opt-out for this today.

## Action recovery (opt-in)

Sometimes a healed locator resolves to a real, visible element, but the
*action* on it still fails — mid-animation, momentarily covered, or scrolled
out of view. By default QASH tries the next candidate (or gives up) at that
point. Turning on action recovery adds one more step first: it retries the
same action against the same element using a fixed, ordered set of tactics —
scroll into view, then a short settle wait, then (for actions that support
it) `force: true` — and uses whichever one works.

```sh
HEALER_ACTION_RECOVERY_ENABLED=true
```

Off by default, deliberately: unlike swapping in a different locator,
`force: true` can make an action succeed in a way a real user couldn't
actually trigger, so this is a second, more speculative layer of
intervention you opt into rather than one QASH applies silently. A heal that
needed recovery is always flagged in the report (see **`needsReview`**
below) so it's easy to find and double-check.

## `needsReview`

Not every successful heal is equally trustworthy. Each one is flagged
`needsReview: true`, with a plain-English reason, when any of the following
is true:

- it only resolved via the **relaxed** pass (multiple elements matched; a
  best-candidate guess was used, not an exact single match),
- the source's own confidence was **low** (under 60%),
- it fell back to a **CSS/XPath** selector instead of a semantic one,
- the durable-locator derivation only had a **weak** signal to work with
  (plain visible text or a bare `id`, rather than a test id or role + name),
  or
- the action needed **recovery** (see above) to actually complete.

This shows up as a "Review" column in the HTML report, a "Needs Review" stat
card, and `[needs review: ...]` in the native Playwright report annotation.
Treat it as "this one's worth a human glance before you fully trust it" —
distinct from a hard failure, which is reported separately.

## Providers

| Provider | Text-based healing | Vision fallback | Auth |
|---|---|---|---|
| OpenAI | ✅ | ✅ | API key |
| Anthropic | ✅ | ✅ | API key |
| Gemini | ✅ | — | API key |
| Ollama (cloud) | ✅ | — | API key |
| Ollama (self-hosted) | ✅ | — | none |

Vision fallback is currently only wired up for OpenAI and Anthropic, since
both already support image input in the same chat/messages API this project
uses for text. Gemini and Ollama would need separate work to get there.

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
`qash.config.json` above). If your tests live somewhere else, point at it
directly instead:

```sh
npx qash-playwright checkup --dir <path-to-your-tests>
```

Connectivity and `actionTimeout` are checked either way, `--dir` only affects
the two locator-scanning checks.

## Running your tests

Run them the same way you always have:

```sh
npx playwright test
```

The first time you point QASH at a suite, run a single file rather than the
whole thing (`npx playwright test path/to/one.spec.ts`) — a broken locator
means a real AI call and a real wait the first time it's hit, so it's worth
seeing how one file behaves before scaling up. Since this sends page content
(accessibility tree, matched element attributes) to whichever provider you
configured, start on a disposable/throwaway branch with a provider you're
comfortable sending that content to, especially the first few times.

## Reports

Every heal attempt is written to `qash-heal-report.json` and rendered as
`qash-heal-report.html`, reset at the start of each test run. Each entry
records the test name, the **page URL** the failure happened on, the source
`file:line` the locator was declared at, the original and healed locator,
whether it needs review (and why — see **`needsReview`** above), whether
action recovery was needed (and which tactic worked), and — on failure — why
every candidate was rejected. The HTML dashboard adds stat cards (success,
failed, cache reuses, success rate, needs review) and a "Review" column
alongside the usual table.

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
`actionTimeout` first. The confidence and match mode (strict/relaxed) that
earned the original heal ride along in the cache entry too, so a cache hit
reports the same `needsReview` status the original heal did — reusing a fix
doesn't make it look more trustworthy than it actually is.

A cached locator is only trusted once the action it's replaying actually
succeeds on it (with action recovery, if enabled, getting a chance first) —
if it resolves but still can't be acted on, the entry is invalidated and
QASH falls through to a fresh heal instead of failing the test outright.

The cache is scoped to **one run**, not persisted indefinitely: within a
single `npx playwright test` invocation, every test shares it (test 2 reuses
whatever test 1 already healed at the same location), but the next separate
invocation — another single test, another full suite run — starts from a
clean cache automatically. This keeps "did this actually heal just now"
unambiguous run to run, at the cost of re-paying for an AI call on a
still-broken locator every time you run again. `qash-playwright apply`
(below) landing the fix into source is what actually stops paying for the
same heal repeatedly, run after run.

## `qash-playwright apply`

A runtime heal is a point-in-time fix — it's only as durable as the AI's guess
happened to be for that one run. Once you're happy with what a heal actually
did (check the reports above), `apply` reads every successful heal and
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

For non-interactive/CI use, there are two distinct commands — a preview that
writes nothing, and the real thing that writes immediately:

**Preview (`--dry-run`) — writes nothing to disk:**

```sh
npx qash-playwright apply --dry-run   # lists every heal; nothing written
```

In a real terminal this lists everything, then still asks "Apply which?" —
type `stop` (or just press Enter) to exit without writing anything. Add
`--yes` (`apply --dry-run --yes`) if you'd rather it just print the list and
exit on its own, no keypress needed.

**Apply for real — writes immediately, no prompts:**

```sh
npx qash-playwright apply --yes         # writes everything
npx qash-playwright apply --only 1,3    # writes just items 1 and 3
npx qash-playwright apply --only 2-4    # a range works too
```

`--dry-run` only disables the bulk `--yes`/`all` shortcut (as above) — it has
no effect on `--only`. **`--only` always writes for real, dry-run or not** —
there's no flag combination that previews a specific selection without
writing it; `--dry-run` alone (no `--yes`, no `--only`) is the only way to
see the full list without writing anything.

Nothing is ever committed automatically — review the diff yourself before
committing, the same way you would any other code change.

## Not in this version

- Vision fallback for Gemini or Ollama — only OpenAI and Anthropic implement it today.
- Subscription-based providers (using an existing Claude Code / GitHub Copilot
  login instead of an API key) — the providers above all use a plain API key.
- Per-heal token-usage/cost tracking in the report.
- A per-call opt-out for healing (e.g. marking a specific `waitFor` as
  "optional, never heal this") — see the note at the end of **What gets
  healed, and what never does** above.
- A dedicated Cucumber integration — `bind(page)` works from any runner's own
  hooks today, but there's no packaged Cucumber-specific wiring yet.

## License

MIT
