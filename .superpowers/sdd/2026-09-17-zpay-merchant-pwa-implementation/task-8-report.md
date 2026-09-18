# Task 8 Report — PWA Safety, Vercel, Documentation, and CI

Date: 2026-09-17

## Outcome

Implemented a deterministic dashboard test/build gate and Vercel Git-integration configuration without adding credentials or deployment commands. The production PWA artifact is built in a temporary directory during its safety test; its install manifest, service worker, and Vercel output contract are checked. Added local/deployment/security documentation and the single public frontend environment-variable example.

All requested low-risk deferred polish was incorporated: 44px copy targets, cumulative-receipt clarification, long key-name wrapping, semantic loading status, full post-login URL restoration, structured JSON media types, bounded/date-form `Retry-After`, and local payment-expiry badge reconciliation.

No external deployment was attempted. Root `src/`, `src-tauri/`, and other root Tauri inputs were not modified.

## RED / GREEN evidence

### Production artifact safety

The new `dashboard/src/pwa.test.ts` invokes the real Vite build into a fresh OS temporary directory. It parses `manifest.webmanifest`, reads the emitted Workbox worker, and parses the root Vercel configuration.

RED:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 failed (1)
Tests       1 failed | 2 passed (3)
AssertionError: expected a root Vercel configuration: expected false to be true
```

The install-manifest and service-worker safety assertions already passed. The deployment assertion failed for the intended reason: `vercel.json` did not exist.

GREEN after adding the exact dashboard install/build/output/rewrite contract:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 passed (1)
Tests       3 passed (3)
```

### Deferred behavior polish

Failing regressions were added before their production changes. The first combined run recorded failures for:

- protected redirect lost `?tab=receipts#latest`;
- skeleton had no `status` role or busy/text semantics;
- wallet summary still said `Confirmed received` with no cumulative/not-spendable clarification;
- an elapsed countdown left the payment-window badge at `Awaiting payment`;
- structured JSON error media type returned the generic detail;
- HTTP-date `Retry-After` returned `undefined`;
- excessive numeric `Retry-After` returned `999999` rather than the 86,400-second bound.

One test-only arrow-function typo initially caused an esbuild transform error; it was corrected and the API RED was rerun successfully as three behavioral failures (14 existing cases passed).

GREEN:

```text
$ npm test -- --run src/api/client.test.ts src/auth/auth.test.tsx src/pages/DashboardPage.test.tsx src/pages/PaymentDetailPage.test.tsx
Test Files  4 passed (4)
Tests       52 passed (52)
```

Self-review found that structured JSON success responses had a separate consumer boundary. Its change was temporarily removed, then the new regression was run:

```text
$ npm test -- --run src/api/client.test.ts
Test Files  1 failed (1)
Tests       1 failed | 17 passed (18)
AssertionError: promise rejected "ApiError: Invalid API response..." instead of resolving
```

After restoring the structured-media helper at the success boundary:

```text
$ npm test -- --run src/api/client.test.ts
Test Files  1 passed (1)
Tests       18 passed (18)
```

The pre-existing awaiting-payment fixture used an expiry timestamp that had become historical. Once local expiry reconciliation was active, four cases correctly appeared expired. The fixture was moved to 2099; the dedicated two-second fake-clock regression continues to prove the state transition.

## Implementation

- `vercel.json` runs `cd dashboard && npm ci`, builds with `npm run build`, publishes `dashboard/dist`, and rewrites non-asset paths to the SPA entry. It contains no localhost/API proxy or credentials.
- `.github/workflows/dashboard.yml` uses Node 22 and runs `npm ci`, `npm test -- --run`, and `npm run build` for dashboard/config changes. Vercel Git integration remains responsible for preview/production deployment; the workflow has no token or deploy step.
- `dashboard/.env.example` contains only `VITE_API_BASE_URL=https://api.example.com`.
- `dashboard/README.md` documents local startup, tests/build, Vercel setup, the real HTTPS API/CORS requirements, tab-scoped session-token storage, one-time API-key handling, service-worker network-only API behavior, scanner freshness, and the remaining live receipt/lightwalletd production gate.
- `.gitignore` now excludes local `.vercel/` metadata.
- The service-worker artifact test requires the ZPay name, standalone display, 192/512/maskable icons, and no `/api/`, `Authorization`, payment-request, transaction, or balance terms in its emitted worker/cache behavior.
- JSON recognition now accepts case-insensitive `application/json` and `application/*+json` with parameters, for success and error bodies. `Retry-After` accepts delta seconds or HTTP dates and is bounded to 86,400 seconds.
- Protected-route sign-in restores pathname, query, and fragment.
- Loading skeletons expose a named polite `status`, `aria-busy=true`, and visually hidden text.
- The dashboard calls confirmed receipts `Cumulative received` and explains they are lifetime receipts, not spendable balance.
- An awaiting payment whose valid expiry crosses locally changes its window badge/notice/countdown to expired without changing funding status or hiding funds.
- Copy buttons retain a 44px minimum hit target; API-key headings can shrink and wrap anywhere inside mobile cards.

## Verification commands and output

### Clean install

```text
$ cd dashboard && npm ci
added 490 packages in 16s
exit 0
```

Npm emitted the environment-level `Unknown env config "http-proxy"` warning and an upstream `glob@11.1.0` deprecation/security warning. Neither warning was introduced by this patch; `npm ci` followed the committed lockfile exactly.

### Frontend suite and production build

Pre-final full run (before the last structured-success regression raised the total by one):

```text
$ npm test -- --run
Test Files  14 passed (14)
Tests       103 passed (103)
exit 0

$ npm run build
tsc --noEmit && vite build
105 modules transformed
dist/assets/index-DXzJdq5-.css   12.82 kB
dist/assets/index-cxu6i1vB.js   392.29 kB
PWA generateSW: 11 precache entries (448.38 KiB)
generated dist/sw.js and dist/workbox-2fbc6a65.js
exit 0
```

The final fresh full-suite/build output is recorded in the final verification section appended below before commit.

### Backend tests and schema

No repository virtualenv existed. Attempts at `backend/.venv/bin/python`, `.venv/bin/python`, and system `python3` respectively found no executable or no Django. An isolated `/tmp/zpay-task8.*` virtualenv was therefore created, `backend/requirements.txt` installed, and no repository dependency file changed. The first Django start correctly required local safety configuration; rerunning with the documented `ZPAY_DEBUG=1` succeeded:

```text
$ ZPAY_DEBUG=1 /tmp/zpay-task8.*/bin/python backend/manage.py test payments -v 2
Found 25 test(s).
Ran 25 tests in 3.387s
OK
System check identified no issues (0 silenced).

$ ZPAY_DEBUG=1 /tmp/zpay-task8.*/bin/python backend/manage.py spectacular --validate --fail-on-warn
exit 0; no schema warnings
```

### Diff and scope

```text
$ git diff --check
exit 0

$ test -z "$(git diff --name-only -- src-tauri src package.json vite.config.ts tsconfig.json tsconfig.node.json public)"
root Tauri inputs unchanged
```

## Browser/manual evidence

Vite was started successfully:

```text
$ npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
VITE v7.3.6 ready in 91 ms
Local: http://127.0.0.1:4173/
```

The installed agent-browser skill was consulted as required, but the `agent-browser` executable is absent. No Playwright, Puppeteer, Chromium, Chrome, or browser-control MCP connector is available in this environment. Therefore I could not honestly perform visual 360/768/1440 viewport checks or manually exercise keyboard login, navigation, dialogs, copy feedback, retries, pagination, stale/offline states, or the install prompt. I did not substitute an HTTP response for a visual assertion.

Automated coverage still exercises meaningful login rendering and keyboard-auth flows under jsdom, responsive component behavior contracts, dialog focus/dismissal, copy feedback/races, safe payment retry, pagination recovery, stale/offline states, the real production build, install manifest, and service-worker cache exclusions. These are automated evidence, not a claim that the outstanding real-browser checklist ran.

## Files

Created:

- `.github/workflows/dashboard.yml`
- `dashboard/.env.example`
- `dashboard/README.md`
- `dashboard/src/pwa.test.ts`
- `vercel.json`
- this report

Modified:

- `.gitignore`
- `dashboard/src/api/client.ts`
- `dashboard/src/api/client.test.ts`
- `dashboard/src/auth/auth.test.tsx`
- `dashboard/src/components/AsyncState.tsx`
- `dashboard/src/pages/DashboardPage.tsx`
- `dashboard/src/pages/DashboardPage.test.tsx`
- `dashboard/src/pages/LoginPage.tsx`
- `dashboard/src/pages/PaymentDetailPage.tsx`
- `dashboard/src/pages/PaymentDetailPage.test.tsx`
- `dashboard/src/styles.css`

## Self-review and concerns

- Deployment config follows the exact approved dashboard commands/output/rewrite and contains no API proxy, `VERCEL_TOKEN`, Vercel CLI, or external-deploy action.
- `.env.example` exposes only the public API origin; no secrets or real credentials are present.
- Financial/API response caching is absent. The worker contains only generated shell/static precache behavior and no runtime financial cache.
- Root Tauri sources/config/assets are unchanged.
- No subagents or reviewers were dispatched, per instruction.
- All eight deferred polish items named in the Task 8 assignment were implemented; none remain code-deferred.
- Real-browser responsive/installability/manual interaction validation remains pending solely because no browser runtime was available here.
- The application must not be called production-ready until Vercel points at a persistent HTTPS backend, backend CORS names the exact deployed dashboard origin, the real-browser checklist passes, lightwalletd finishes its cache, and a live Zcash receipt is observed. The existing `sync_wallets --once` infrastructure failure remains a separate gate: preserve the previous snapshot and inspect wallet-service logs/cache height before retrying.

## Final verification

Fresh run immediately before staging/commit:

```text
$ cd dashboard && npm test -- --run && npm run build
Test Files  14 passed (14)
Tests       104 passed (104)
105 modules transformed
PWA generateSW: 11 precache entries (448.38 KiB)
generated dist/sw.js and dist/workbox-2fbc6a65.js
exit 0

$ ZPAY_DEBUG=1 /tmp/zpay-task8.*/bin/python backend/manage.py test payments -v 1
Ran 25 tests in 3.743s
OK
System check identified no issues (0 silenced).

$ ZPAY_DEBUG=1 /tmp/zpay-task8.*/bin/python backend/manage.py spectacular --validate --fail-on-warn
spectacular validation passed without warnings
exit 0

$ git diff --check
$ node [vercel contract assertion]
$ wc/rg [single exact public env assertion]
$ test [root Tauri input diff is empty]
diff/config/env/Tauri checks passed
exit 0
```

---

## Fix round 1/5 — structural service-worker cache safety

Date: 2026-09-18

### Finding addressed

The original artifact test only rejected worker source containing `/api/`, `Authorization`, `payment-requests`, `transactions`, or `balance`. A broad runtime route with innocuous names could therefore cache authenticated API/financial responses while passing the test.

The safety test now parses the emitted Workbox artifact and enforces the actual policy:

- exactly one parseable `precacheAndRoute` manifest;
- only the expected relative shell/icon paths with 32-character content revisions;
- only hashed `assets/*.js` and `assets/*.css` paths with no separate revision;
- all required shell/icon entries plus at least one versioned script and stylesheet;
- exactly one runtime route, matching only Workbox's `NavigationRoute(createHandlerBoundToURL("index.html"))` SPA fallback;
- no direct fetch-event handler.

The production `vite.config.ts` remains unchanged and contains no `runtimeCaching` policy.

### RED / GREEN

First, the keyword check was extracted into a reusable validator without changing behavior:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 passed (1)
Tests       3 passed (3)
```

Then a probe appended this keyword-free catch-all route to the real emitted worker:

```js
registerRoute(
  () => true,
  new CacheFirst({ cacheName: "all-requests" }),
);
```

RED against the original validator:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 failed (1)
Tests       1 failed | 3 passed (4)
AssertionError: expected [] to include
  'worker contains disallowed runtime caching behavior'
```

GREEN after structural precache/runtime-route validation:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 passed (1)
Tests       4 passed (4)
```

### Full verification

```text
$ npm test -- --run
Test Files  14 passed (14)
Tests       105 passed (105)
exit 0

$ npm run build
tsc --noEmit && vite build
105 modules transformed
PWA generateSW: 11 precache entries (448.38 KiB)
generated dist/sw.js and dist/workbox-2fbc6a65.js
exit 0

$ git diff --check
exit 0
```

### Files and self-review

- Modified `dashboard/src/pwa.test.ts` and this report only.
- No production PWA code/config, deployment files, root Tauri sources, or secrets changed.
- The broad-predicate `CacheFirst` probe does not rely on the original forbidden keywords.
- The check intentionally fails closed if a future Workbox/plugin version changes emitted manifest or navigation-route syntax; such an upgrade must be reviewed rather than silently weakening cache safety.
- Deferred icon existence/dimension validation and unrelated `Date.now` spy restoration remain unchanged as directed.

---

## Fix round 2/5 — direct `onfetch` cache handlers

Date: 2026-09-18

### Finding addressed

The structural validator rejected Workbox runtime routes and `addEventListener("fetch", ...)`, but a service worker could still install a standard direct handler through `self.onfetch = ...` or bare `onfetch = ...` and cache every request.

The validator now lexically removes inert JavaScript string, comment, and template-text content while preserving executable code/template expressions, then rejects executable `self.onfetch`, `globalThis.onfetch`, and bare `onfetch` assignments. This avoids flagging documentation-like text in strings or comments.

### RED / GREEN

The regression kept the valid emitted precache manifest and navigation fallback unchanged, then appended a keyword-free `self.onfetch` handler that opens `all-responses`, matches every request, fetches misses, and stores cloned responses.

RED before the direct-assignment guard:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 failed (1)
Tests       1 failed | 4 passed (5)
AssertionError: expected [] to include
  'worker contains disallowed runtime caching behavior'
```

The finalized regression checks both `self.onfetch =` and bare `onfetch =`. A companion case proves the same phrases in a string, line comment, or block comment remain harmless.

GREEN:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)
```

### Full verification

```text
$ npm test -- --run
Test Files  14 passed (14)
Tests       107 passed (107)
exit 0

$ npm run build
tsc --noEmit && vite build
105 modules transformed
PWA generateSW: 11 precache entries (448.38 KiB)
generated dist/sw.js and dist/workbox-2fbc6a65.js
exit 0

$ git diff --check
exit 0
```

### Files and self-review

- Modified `dashboard/src/pwa.test.ts` and this report only.
- Production service-worker/PWA configuration remains unchanged and has no runtime API cache.
- The real emitted worker still passes the structural allowlist; executable direct-fetch probes fail it.
- Harmless `onfetch` text in strings/comments is explicitly covered against false positives.
- No subagents or reviewers were used.
- No new concern beyond the existing intentional fail-closed dependency on reviewed Workbox output syntax.

---

## Fix round 3/5 — equivalent static `onfetch` assignments

Date: 2026-09-18

### Finding addressed

The round-2 direct-handler guard recognized only dot/bare direct `=` assignments. Equivalent static handlers could still use computed properties such as `self["onfetch"]` or `globalThis['onfetch']`, and compound assignment operators could bypass the check.

The validator now tokenizes the emitted JavaScript sufficiently to recognize static assignment sequences outside strings and comments. It fails closed for:

- bare `onfetch`;
- `self.onfetch` and `globalThis.onfetch`;
- `self["onfetch"]` and `globalThis['onfetch']`;
- `=`, `||=`, `&&=`, and `??=` for every target form.

It deliberately does not evaluate arbitrary dynamic property expressions.

### RED / GREEN

A table-driven 5×4 matrix appends each static target/operator combination to the otherwise valid emitted worker. Each handler is catch-all and can return a cached response for any request.

RED against the round-2 guard:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 failed (1)
Tests       17 failed | 9 passed (26)
```

The 17 failures were exactly the unguarded forms: all 15 compound assignments and both computed-property direct assignments. Existing dot/bare direct `=` cases remained protected.

GREEN after static token-sequence recognition:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 passed (1)
Tests       26 passed (26)
```

### Full verification

```text
$ npm test -- --run
Test Files  14 passed (14)
Tests       127 passed (127)
exit 0

$ npm run build
tsc --noEmit && vite build
105 modules transformed
PWA generateSW: 11 precache entries (448.38 KiB)
generated dist/sw.js and dist/workbox-2fbc6a65.js
exit 0

$ git diff --check
exit 0
```

### Files, scope, and concerns

- Modified `dashboard/src/pwa.test.ts` and this report only.
- Production PWA/service-worker configuration remains unchanged and runtime-cache-free.
- No subagents or reviewers were used.
- Static computed property strings and assignment operators are covered comprehensively; dynamic expressions such as `self["on" + "fetch"]` are intentionally outside this bounded recognizer.
- The existing intentional fail-closed dependency on reviewed Workbox output syntax remains.

---

## Fix round 4/5 — window targets, executable templates, and escaped names

Date: 2026-09-18

### Findings addressed

- Added `window.onfetch` and `window['onfetch']` to the complete `=`, `||=`, `&&=`, and `??=` target matrix.
- Restored inspection of executable template-literal expressions, including nested templates, nested braces/strings, multiple substitutions, and escaped literal substitutions followed by executable ones.
- Recognized JavaScript Unicode escapes in bare identifiers, global identifiers, and property names, plus Unicode/code-point/hex escapes in static string properties and escapes in no-substitution template properties.
- Removed the related false positives for regex literals containing assignment-like text. Regressions also ensure division expressions and assignments following regex literals remain detectable.

The handwritten tokenizer was replaced with syntax-only AST inspection using the already-declared TypeScript development dependency. It decodes static names and distinguishes executable template children from inert regex/string/comment/template text without evaluating source. Recognition remains bounded to the four requested assignment operators and bare `onfetch` or static properties on `self`, `globalThis`, and `window`. Arbitrary dynamic properties such as `self["on" + "fetch"]` are not evaluated. No dependency or lockfile change was needed.

### RED / GREEN evidence

Added the expanded target matrix and template, escape, regex, and division regressions before changing the validator. The new cases exercise the same safety validator against otherwise valid emitted production workers.

RED against the round-3 tokenizer:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 failed (1)
Tests       80 failed | 34 passed (114)
exit 1
```

Failures were the eight window target/operator combinations, 28 template target/operator combinations, three additional template-expression cases, 36 escaped target/operator combinations, and five inert-regex false positives. They were behavioral assertion failures, not transform or setup errors.

GREEN after syntax-only assignment inspection:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 passed (1)
Tests       114 passed (114)
exit 0
```

### Full verification

```text
$ npm test -- --run && npm run build
Test Files  14 passed (14)
Tests       215 passed (215)
tsc --noEmit && vite build
105 modules transformed
PWA generateSW: 11 precache entries (448.38 KiB)
generated dist/sw.js and dist/workbox-2fbc6a65.js
exit 0

$ git diff --check
exit 0
```

Npm continues to emit the pre-existing environment warning about unknown `http-proxy` configuration. No new test/build warning appeared.

### Files and scope

- Modified only `dashboard/src/pwa.test.ts` and this report.
- Production PWA configuration, application code, dependency files, and root Tauri inputs are unchanged.
- The SDD progress ledger was not modified.
- All prior safety tests and the actual emitted worker still pass. This is a bounded static regression guard, not a general JavaScript security analyzer.

---

## Fix round 5/5 — classic-worker var initialization and transparent parentheses

Date: 2026-09-18

### Findings addressed

The AST guard now recognizes initialized global `var onfetch` declarations in classic workers, including multi-declaration statements, escaped identifiers, and declarations inside global blocks. Function scopes and class static blocks are not mistaken for global var scope. Uninitialized `var onfetch` and lexical `let onfetch` declarations are not classified as global handler installation.

Transparent parentheses are unwrapped around assignment targets, global receiver expressions, and static property strings. The regression matrix covers `(onfetch)`, `(self.onfetch)`, `(self).onfetch`, `self[("onfetch")]`, and nested parentheses with `window` and `globalThis`, each for `=`, `||=`, `&&=`, and `??=`. This is syntactic unwrapping only; arbitrary dynamic property expressions remain unevaluated.

### RED / GREEN evidence

The regression cases were added before changing the recognizer.

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 failed (1)
Tests       28 failed | 119 passed (147)
exit 1
```

The 28 failures were exactly four global-var installation cases and 24 parenthesized target/operator combinations. All five non-installing declaration cases already passed. Failures were behavioral assertions, not setup or compilation errors.

After adding global-var initialization detection and transparent-parenthesis unwrapping:

```text
$ npm test -- --run src/pwa.test.ts
Test Files  1 passed (1)
Tests       147 passed (147)
exit 0
```

### Full verification

```text
$ npm test -- --run && npm run build
Test Files  14 passed (14)
Tests       248 passed (248)
tsc --noEmit && vite build
105 modules transformed
PWA generateSW: 11 precache entries (448.38 KiB)
generated dist/sw.js and dist/workbox-2fbc6a65.js
exit 0

$ git diff --check
exit 0
```

The only npm warning remains the pre-existing unknown `http-proxy` environment configuration.

### Files and scope

- Changed only `dashboard/src/pwa.test.ts` and this report.
- Production PWA configuration, dependency files, root Tauri inputs, and the SDD ledger remain unchanged.
- Existing strings/comments/regex harmless-text cases and all prior detection regressions pass.
- No source evaluation or dynamic-property interpretation was introduced.
