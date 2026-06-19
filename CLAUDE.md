# cif-dashboard — Claude handoff notes

This file is for Claude Code sessions taking over from a prior session.
Read this first before exploring; it answers the questions you'd otherwise
spend ~15 minutes finding answers to via grep.

## What this service is

`cif-dashboard` is the operator-facing back-office UI for CashinFlash.
It lets underwriters:
- Browse incoming applications (apply.cashinflash.com + docs.cashinflash.com)
- View application details (income, obligations, FCF, decision)
- Re-run the decision engine with stored Plaid data
- Refresh from Plaid (re-pull asset reports)
- Push documents to a customer's Vergent record (Phase 1 + Phase 2)
- Manage the cross-application Plaid customer index

It runs at `https://app.cashinflash.com` (Render). It proxies most data
calls to `cif-apply` (`https://cif-apply.onrender.com`).

## Architecture

Two server-side files do all the work:
- `server.py` — Python `http.server`-based proxy + auth + static serve.
  Currently ~3500 lines. **This is where Phase 2's Vergent badge HTML
  is injected from.**
- `app.html` — single-file dashboard SPA. ~315 KB. **Treat as read-only
  via injection pattern — see below.**

### The injection pattern

`app.html` is large (~315 KB) and has a complex internal structure that
the harness's tool-call output budget can't comfortably edit. To work
around this, Phase 2 introduced a server-side HTML injection pattern:

- `server.py` defines `_PHASE2_PANEL_HTML` (a UTF-8-encoded bytes
  constant) and `inject_phase2_panel(html_bytes) -> bytes`.
- When `/app` or `/app.html` is served, `inject_phase2_panel` appends
  the constant **before `</body>`** in the response.
- The injected blob is a `<style>` block + `<script>` block that
  client-side polls every 2s, finds the current applicant's firebase_id
  via URL hash / `data-firebase-id` / globals, and renders a status
  badge based on `vergentMatch` from Firebase.

**Edits to the Vergent badge UI go in `_PHASE2_PANEL_HTML` in
`server.py`, not `app.html`.** The injection pattern means we never
touch app.html for Phase 2 features.

If you need to edit `app.html` directly (e.g., to change the existing
"Push to Vergent" button or the Plaid Customers page), use Edit with a
small diff. Write would re-emit the whole file and hit the output budget.

## Recent work — Phase 2 Vergent badge

### What it does

Every time the operator opens an applicant detail, the injected JS
finds the firebase_id, fetches `/fb/reports/{id}/vergentMatch.json`,
and renders one of five badge states:

| status | Color | Title shown | Action buttons |
|---|---|---|---|
| `found` | green | "Vergent: Existing #12345" | "Push selected" (DL + Statement checkboxes) |
| `not_found` | orange | "Vergent: New" | "Create + Push All", manual-ID input + "Use this ID", "Re-check" |
| `ambiguous` | yellow | "Vergent: N matches" | radio picker + "Use selected + Push" |
| `error` | red | "Vergent: Search error" | "Re-check" |
| `unknown`/missing | gray | "Vergent: Pending" | "Re-check now" |

The badge is injected into the DOM next to the legacy
`#vergentpush-{fbId}` button (which lives in app.html line ~3454). If
that button doesn't exist (no `bankStatementUrl` on the record),
fallback inserts into `[data-firebase-id]` container, and last-resort
falls back to a fixed top-right banner.

### Push action

Clicking any of the push/create/use-ID buttons posts to
`/api/push-to-vergent` (proxied to cif-apply). Response is rendered as
either green "Pushed to customer #X (DL + Statement)" or red error.

### File map

```
cif-dashboard/
├── server.py                   # ~3500 lines; Phase 2 panel + proxies live here
│   ├── _PHASE2_PANEL_HTML      # lines ~326-557 (the injected blob)
│   ├── inject_phase2_panel()   # lines ~559-571
│   ├── /api/push-to-vergent    # proxy, lines ~878-906
│   └── /api/push-plaid-to-vergent  # legacy proxy, ~849-877
├── app.html                    # ~315 KB; single-file SPA
│   ├── pushPlaidToVergent()    # legacy push function, line ~3585-3658
│   ├── #vergentpush-{fbId}     # legacy push button, line ~3454
│   └── Plaid Customers page    # line ~3942 onward
├── render.yaml
└── login.html
```

## OPEN BUGS — start here

### Bug 1 (HIGH): "Re-check now" button does nothing for legacy applicants

**Symptom:** Operator clicks "Re-check now" on the badge. Spinner
absent, no visible change, badge stays in "Pending."

**Root cause:** The current implementation only re-fetches
`vergentMatch` from Firebase. For applicants whose record has NO
`vergentMatch` field (because they submitted before Phase 2 shipped, OR
because cif-apply's monkey-patched auto-search didn't fire for them),
the fetch returns null forever — re-fetching never produces new data.

**Fix needed:** The button must trigger a **fresh Vergent search on the
backend**, not just re-poll. Two coordinated changes:

1. **cif-apply** (see `cif-apply/CLAUDE.md` Bug 1): add `POST
   /api/vergent-recheck` endpoint that calls `run_vergent_match`
   synchronously and returns the resulting match.

2. **cif-dashboard** (this repo):
   - Add a proxy route in `server.py` for `/api/vergent-recheck` that
     forwards to cif-apply with a 30s timeout. Pattern matches the
     existing `/api/push-to-vergent` proxy at server.py:878-906.
   - In `_PHASE2_PANEL_HTML`'s `recheck` action handler, change from
     `window.__vergentPhase2LastFetch = 0; poll();` to a `fetch()` call
     against `/api/vergent-recheck` with `{firebase_id: fbId}`. On
     response, render the new match directly (don't poll — the response
     IS the fresh match).

```javascript
// Sketch (not tested):
if (act === 'recheck') {
  badge.querySelectorAll('button').forEach(function(b) { b.disabled = true; });
  fetch('/api/vergent-recheck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ firebase_id: fbId }),
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.vergentMatch) render(d.vergentMatch, fbId);
      badge.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
    })
    .catch(function() {
      badge.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
    });
  return;
}
```

### Bug 2 (HIGH): Badge styling looks out of place

**Symptom:** Operator says the badge "looks nothing like the rest of
our system."

**Root cause:** The badge in `_PHASE2_PANEL_HTML` uses a custom design
language (its own pill colors, its own button styles, its own typography
weights) that doesn't match `app.html`'s existing visual language.

**Reference design tokens (from app.html line ~3454-3460, the existing
"Push to Vergent" button):**

```css
/* Existing button style — match this */
background: #e8f3f8;          /* light blue */
color: #1a4d6b;               /* dark blue */
border: 1px solid #6cb1e2;    /* mid blue */
padding: 8px 12px;
border-radius: 8px;
font-size: 12px;
font-weight: 700;
cursor: pointer;
font-family: inherit;          /* IMPORTANT — don't override */
```

**Recommended badge restyle:**
- Drop custom font-family (`-apple-system, BlinkMacSystemFont, ...`).
  Use `font-family: inherit` like everything else in app.html.
- Match the radius (8px, not 5px on inner buttons).
- For "Existing" state, use a similar light-blue/dark-blue palette as
  the existing push button so the badge looks like a status pill in the
  same family. For "New" / "Ambiguous" / "Error", use lighter
  saturation versions of the existing app.html alert colors (search
  app.html for `background:#fff5e6` etc. — there should be existing
  warning/error pills to pattern-match).
- Buttons inside the badge should use exactly the same style attribute
  string as the existing `#vergentpush-{fbId}` button — copy/paste the
  inline-style verbatim and just change the text.
- Drop the custom class names (`.v2badge-*`, `.v2b-*`) — they don't fit
  the codebase's naming convention (which uses no namespacing because
  app.html is one big file).

**File to edit:** `server.py` `_PHASE2_PANEL_HTML` constant (lines
~326-557). Replace the `<style>` block and adjust the inline button
HTML to match the reference tokens above.

### Bug 3 (MEDIUM): Badge fallback positioning unreliable

When the legacy `#vergentpush-{fbId}` button doesn't exist (e.g.,
docs.cashinflash.com applicants without bankStatementUrl), the badge
falls back to a fixed top-right banner. This is the same problem the
floating-panel had — operators miss it.

**Better fix:** find a reliable inline anchor in app.html that exists
for ALL applicants. Candidates:
- The application detail modal's header area
- The status/decision pill (every applicant has one)
- A dedicated section in app.html for "operator actions"

Spend ~15 min reading app.html around the application detail render
function (search for `applicationModal` or similar) to find a stable
anchor. Then update `getOrInsertBadge()` in `_PHASE2_PANEL_HTML` to
prefer that anchor over the legacy push button.

## v4 dashboard changes (spec §8 — docs/v4_spec.md in cif-apply)

Landed on `claude/epic-davinci-cdufn9` alongside the cif-apply engine_v4
work. What changed and where:

- **Engine tier badge replaced the Score column** (`engineBadge()` in
  app.html, near the old scoreClass site): `APPROVE $X` / `DECLINE` /
  `REVIEW $X` from `claudeDecision` + canonical `amount`, rendered with
  the existing `.status` pill classes. The dead v1 `score` field is no
  longer written by cif-apply and was deleted from the snapshot cards,
  CSS, and reportsIndex projections.
- **Row subtitle** = `v4ReasonLine` (fallback: canonical `reason`) so
  the queue scans without opening modals.
- **Detail hero splits engine verdict from human action** (§8.1): big
  value mirrors `claudeDecision` until a human acts; tag shows
  `humanAction` (`funded`/`declined` + operator), legacy fallback shows
  `marked <status> (pre-v4)`. Never let one overwrite the other.
- **Override flow** (§8.2): every status change funnels through
  `setStatus(fbId, status, opts)`. Crossing the engine (funding an
  engine-DECLINE, declining an engine-APPROVE) opens the `#ovr-ov`
  modal — typed reason ≥20 chars required; funding overrides also
  collect the amount (the offer field deliberately does NOT pre-fill on
  engine declines, and `dv-approve-btn` renders gray). Confirm calls
  `POST /api/override` (server.py, just before the `/fb/` write proxy):
  operator stamped SERVER-SIDE from the session, writes
  `/overrides/{fbId}` on crossings, patches `humanAction`/
  `humanActionAt`/`humanActionBy` on every funded/declined action,
  mirrors the index, emits an `engine_override` audit line. At 250
  apps/day this log is how reviewers get graded against the engine.
- **Approval-email modal** pre-fills the engine tier only on engine
  APPROVE (the old code read a nonexistent `dv-offer-amount` element
  and defaulted every email to $255).
- `_INDEX_TOP_FIELDS` (server.py) must stay lock-step with cif-apply's
  run_server.py copy: `score` is out; `v4ReasonLine` / `v4Decision` /
  `v4Tier` / `humanAction` are in.

## Style language conventions in this repo

For ANY UI work, match these patterns from app.html:

- **Inline styles** are the convention (the file is too big to maintain
  separate stylesheets cleanly). Don't introduce new class-based CSS
  unless you're prepared to make it match the inline-style language.
- **Color palette:**
  - Primary brand blue: `#1a4d6b` text on `#e8f3f8` background, border
    `#6cb1e2`
  - Success green: `#1a6b3c` text on `#e8f5ee` background
  - Warning orange: `#5a3300` text on `#fff5e6` background
  - Error red: `#5a0d0d` text on `#fde7e7` background
- **Typography:**
  - `font-family: inherit` everywhere (don't set custom system stacks)
  - Font sizes: 11-12px for meta/badges, 13-14px for body, 16-18px for
    headers
  - Weights: 400 for body, 700 for emphasis/buttons
- **Spacing:**
  - Padding inside controls: 6-8px vertical, 10-12px horizontal
  - `border-radius: 8px` for buttons, `border-radius: 6px` for chips
  - Margins between elements: 6-8px
- **Buttons:**
  - 1px border in a darker shade of the background
  - 700 font-weight, 12px font-size
  - `cursor: pointer`, `font-family: inherit`

When adding new UI, **copy an existing similar element's inline style
string verbatim** rather than authoring a new one. The codebase has
strong style consistency via copy-paste, not via shared CSS.

## Endpoints (proxy to cif-apply)

All under `server.py` `do_POST` / `do_GET` handlers:

| Method | Path | Forwards to | Notes |
|---|---|---|---|
| POST | `/api/refresh-from-plaid` | cif-apply same path | Re-pull Plaid + re-run |
| POST | `/api/rerun-v2` | cif-apply same path | Re-run with stored data |
| POST | `/api/push-to-vergent` | cif-apply same path | **Phase 2 multi-doc** (90s timeout) |
| POST | `/api/push-plaid-to-vergent` | cif-apply same path | **Phase 1 legacy** (60s timeout) |
| GET | `/api/plaid-connections` | cif-apply same path | Cross-app Plaid index |
| GET | `/fb/reports/{id}.json` | direct Firebase REST | Used by the badge poll |
| GET | `/fb/reports/{id}/vergentMatch.json` | direct Firebase REST | Used by the badge poll |

When adding `/api/vergent-recheck` (Bug 1 fix), it goes here.

## What's been tried and ruled out (don't redo)

- **Editing app.html directly with Write:** hits the 315 KB output
  budget. Use Edit with small diffs, OR use the injection pattern.
- **Floating bottom-right panel:** the original Phase 2 design.
  Operators miss it. Already replaced with inline badge — don't go back
  to floating.
- **Caching `vergentMatch` per-fbId forever:** original poll bug. Now
  uses 30s TTL. Don't drop the TTL.
- **`b"..."` with non-ASCII chars:** Python 3.14 rejects it. Always use
  `("...").encode("utf-8")` for the panel HTML constant. We hit this
  with em-dashes / checkmarks in commit `66d48ad`.

## Branch convention

Active feature branch: `claude/epic-davinci-cdufn9` (the v4 engine /
dashboard work). Older work lived on
`claude/continue-previous-session-e2Z43`. Merges
to main when ready. Render auto-deploys main.

## Workflow rule: ALWAYS merge to main when finished

The user has been explicit (multiple sessions): **never leave a PR
sitting open**. The cycle is:

1. Commit on a feature branch
2. Open the PR via `mcp__github__create_pull_request`
3. **Merge it immediately** via `mcp__github__merge_pull_request`
   (squash merge), unless the change is risky enough to need explicit
   user review

Render only auto-deploys `main`. Leaving a PR unmerged means the change
is invisible to production tests — which has burned debug cycles before
(diagnostic logging committed but unmerged means the user keeps testing
the older deployed code).

If the change is risky / user-facing-breaking, still merge — but check
with the user FIRST before committing it.

## Plan file

The full multi-phase plan lives at
`/root/.claude/plans/this-session-is-to-snappy-allen.md` — read Part J
for the in-flight badge UX work. The open bugs above are the loose
ends from Part J.

## Coordinating with cif-apply

Many bugs span both repos (Bug 1 in particular). Read
`cif-apply/CLAUDE.md` before starting any Vergent work — it has
parallel sections covering the backend half of each bug.

# ════════════════════════════════════════════════════════════
# SESSION HANDOFF — current state & open items (2026-06-17)
# Read this FIRST. Everything below reflects what's LIVE in production.
# Branch: claude/epic-davinci-cdufn9 (all 3 repos). Render auto-deploys main.
# Backend half of every item lives in cif-apply/CLAUDE.md SESSION HANDOFF.
# ════════════════════════════════════════════════════════════

## WHERE WE ARE: dashboard is on the v4 canonical model

- **v4 is the LIVE primary engine** (cif-apply). The dashboard reads v4's
  canonical fields (`claudeDecision`, `amount`, `v4ReasonLine`, `v4Tier`,
  `v4Decision`, `humanAction`, `humanActionBy`, `autoDeclineBucket`). The
  v4 report HTML (cif-apply engine_v4/report_html.py) is what renders in
  the detail iframe — it is CANONICAL. Do NOT re-render through any v2
  renderer.
- Everything below shipped on `claude/epic-davinci-cdufn9` after the
  v4 §8 dashboard changes documented above.

## ACTION CENTER COCKPIT (app.html — renderActionCenter)

- New operator cockpit rendered into `#activity-feed`. Two columns:
  **Needs Review** (grouped: things to FUND / to REVIEW / to CONFIRM) and
  **Auto-declined today**. Built mobile-first (operator works from phone).
- Backed by `reviewQueue()` / `reviewGroups()` (deduped) and `counts()`
  computed over `dedupedApps` — there is now ONE source of truth for "what
  needs attention", not three divergent calcs.
- `filteredApps` uses a fund-first ordering so the highest-value actions
  surface at the top of the queue.

## PENDING-COUNT BUG: FIXED (was the #1 operator complaint)

Symptom was: the Pending chip showed N but clicking Pending showed an
empty list, and the count drifted up all day. Root cause = THREE divergent
"pending" definitions plus a catch-all `bucketStatus` that swept Error/
Processing/retry records into "pending". Fixes (all in app.html):

- **`bucketStatus` tightened**: `error → error`; `processing/retry/plaid →
  processing`; ONLY a genuinely-undecided record → `pending`. No more
  catch-all into pending.
- **`isDecided()`** is the single predicate for "operator/engine/auto has
  acted" (funded/declined/auto-declined). Used everywhere a count or queue
  needs to exclude resolved apps.
- **`reviewQueue()` dedupes** (same applicant can have multiple report
  rows; one entry per applicant).
- `counts()` now derives from `dedupedApps` + `isDecided()` so the chip
  number and the filtered list ALWAYS agree.

If a count looks wrong again, check these three functions FIRST — and make
sure any NEW status string is classified in `bucketStatus` (an unhandled
status silently falling into `pending` is exactly how this regressed).

## AUTO-DECLINE VISIBILITY (app.html)

- **AUTO badge** on rows the auto-decline system resolved (driven by
  `humanActionBy === 'auto-system'` / `autoDeclineBucket`).
- **"Auto-declined" filter** + the "Auto-declined today" column in the
  Action Center.
- Detail view shows **"declined automatically by system"** (with the
  bucket: out_of_state / no_income / dead_balance) instead of a bare
  "Declined", so the operator never mistakes an auto-decline for their own.
- The denial email shows on the Communications page tagged `auto`.

## OVERRIDE GATING: REMOVED — one-click approve/decline

Per operator request (2026-06-15). `setStatus()` no longer opens the
`#ovr-ov` forced-reason modal; the `dv-approve-btn` handler funds/declines
directly. The SILENT stamp (`humanAction`/`humanActionAt`/`humanActionBy`
via `POST /api/override`) is KEPT — it powers the auto-vs-manual labels and
the reviewer audit log. `openOverrideModal` / `_needsOverride` / the
`#ovr-ov` modal markup are now DEAD CODE (left in place, not wired). Do not
re-introduce the gating without an explicit operator request.

## REPORT PAGE CLEANUP (app.html)

Operator screenshot review: the old v2 snapshot cards were noise under v4.
Removed the dead **Obligations / FCF / DTI / Max Offer / Confidence** cards
and the "Recommended Decision" block (v4 has no FCF/DTI/confidence model).
**Verified Income + Bank Account** were kept and moved down into a slim
facts strip lower in the report. Mobile-friendly throughout. If you re-add
any metric card, confirm v4 actually writes that field first (most v2
fields are no longer produced).

## _INDEX_TOP_FIELDS LOCK-STEP (server.py)

`_INDEX_TOP_FIELDS` (the compact reportsIndex projection) MUST stay
identical to cif-apply's copy in `run_server.py`. Current additions:
`humanActionBy`, `autoDeclineBucket` (plus the v4 fields `v4ReasonLine`/
`v4Decision`/`v4Tier`/`humanAction`; `score` is OUT). If you add a field
the dashboard reads off the index list, add it in BOTH files or the
dashboard will read stale/missing data for that field.

## OPEN ITEMS (dashboard-relevant; full list in cif-apply/CLAUDE.md)

1. **[HIGH] Error filter + recovery surfacing.** Backend Open Item #1 adds
   retry + an auto-heal sweep for Error/stuck-Processing records; the
   dashboard side is an **Error filter** so the operator can see/triage
   them (today Error rows are invisible — they fall outside every queue).
   Wait for the backend recovery work, then add the filter + a re-run
   action.
2. Auto-decline phase 2 (pre-Plaid out-of-state short-circuit) is
   backend-only; no dashboard change expected beyond the existing AUTO
   surfacing.

## HOW THIS SESSION WORKED (match the operator's style)

- app.html is 315 KB — edit with SMALL Edits, and run `node --check` on
  EVERY `<script>` block you touch before committing (a single syntax slip
  white-screens the whole SPA). Match existing inline-style strings verbatim
  (see "Style language conventions" above). Mobile matters — operator runs
  this from their phone constantly. Merge-to-main immediately (squash) so
  Render deploys; never leave a PR open. Tell the operator the plan and get
  a final "go" before anything risky.
