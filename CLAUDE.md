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

## MicroBilt compliance pills (MLA + SSN, 2026-07-06)

NATIVE in app.html (renderComplianceCard + static markup in
#dv-panel-profile, right under the profile status hero): a "Compliance"
section on the PROFILE tab. Hydrates `/fb/reports/{id}/microbilt.json`
once per applicant (same pattern as the plaidBalance card), cached in
`_mbComplianceCache`. An injected version
(`_MICROBILT_PANEL_HTML`) was tried and DELETED 2026-07-06 — injection
targeting runtime DOM anchors broke twice after the 2026-07 overhaul
(deleted anchors), so this feature went native. Don't reintroduce
runtime-anchor injection for new features. The ORIGINAL injected
Vergent panel (`_PHASE2_PANEL_HTML`) is equally vestigial (the native
profile hero + rail card replaced it); don't anchor anything new to
either.

REDESIGNED 2026-07-11 into a `.profile-card` with one row per check
(MLA / Identity), token-palette status chips (dot + label; green
clear, red COVERED BORROWER / FRAUD RISK, amber genuine needs-review,
gray not-checked, dashed slate "Didn't run" for failed CALLS — keep the
dashed=plumbing-not-verdict distinction), per-row expandable detail
boxes, humanized skipReason wording, and the split re-run actions as
`.btn-ghost` buttons right-aligned in the `#dv-compliance-h` sec-h
(that id is the mobile Quick-Actions insertion anchor — `_placeQaSection`
inserts before it; NEVER rename/wrap it). Behavior contracts:
- Re-run failures NEVER wipe the cached verdicts (r.ok checked; error →
  toast, cache kept). A failed hydrate renders a distinct "couldn't
  load + Retry" state, not "no check on record".
- `window._mbRerunInFlight = {fbId, only}` is the shared billing guard —
  re-renders keep painting the running state; the MLA funding gate uses
  the same guard so nothing can double-bill.
- Split buttons POST `/api/microbilt-recheck` with `only='mla'|'identity'`
  (backend 400s unknown values; 503 prev_read_failed = safe abort,
  just re-click; 409 = checks disabled).

**MLA FUNDING GATE (2026-07-11)**: `mlaFundingGate(fbId)` runs before
EVERY funding action — inside `setStatus` for status==='Approved'
(covers the one-click Approve AND the override modal) and at the top of
`sendApprovalEmail` (the offer email counts as an offer). No MLA verdict
on record → it runs the MLA product right there (one billable report,
spinner toast); covered borrower → HARD BLOCK (alert + toast, never
confirmable); can't-run (docs-form no-SSN, MicroBilt outage) → explicit
operator confirm. This is what makes cif-apply's manual mode
(`MICROBILT_AT_INTAKE=false`) safe: intake checks can stop entirely and
it stays impossible to fund without the federally-required MLA check.
`microbiltSummary` is in `_INDEX_TOP_FIELDS` (lock-step with cif-apply) and
appends to the queue-row subtitle — '' when clean, so silence = clean.
DENIAL_REASONS gained "Unable to offer this loan product to MLA covered
borrowers" at index 13 — **_denialPrecheck references reasons BY INDEX;
only ever APPEND to that list, never insert.** The precheck pre-ticks 13
when `record.microbilt.mla.covered === true`. Backend details:
cif-apply/CLAUDE.md "MicroBilt intake checks".

## Reapply-block visibility (30-day cooldown, 2026-07-08)

Backend: cif-apply/CLAUDE.md "30-day reapplication block". Dashboard
half: `/api/override` fire-and-forgets `POST cif-apply
/api/reapply-register {firebase_id, action}` on every funded/declined
action (a daemon thread inside the handler — manual declines arm the
cooldown, fundings register instruments). `reapplyFlag` is in
`_INDEX_TOP_FIELDS` (lock-step with cif-apply): queue rows append a
human label to the subtitle and render a red **FLAG** chip next to the
status when `funded_instrument_reuse` (same bank/card as a FUNDED loan
under a different identity — possible duplicate identity; the record
holds as `funded_instrument_fraud_review`, never auto-actioned).
`reapply_blocked` has labels in BOTH `_AUTO_BUCKET` maps.
DENIAL_REASONS gained "A recent application is already on file" at
index 14 (append-only rule still stands); the precheck ticks it on
`autoDeclineBucket === 'reapply_blocked'` or
`reapplyFlag === 'instrument_reuse'`.

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

## Mobile layer (2026-07 overhaul)

app.html is now ~850 KB / ~15k lines (the "315 KB" notes above are
stale — same Edit-small-diffs rule applies, doubly so).

- **PWA app mode**: static/manifest.json + static/sw.js + static/icons/
  (generated from the wordmark's F-bolt glyph). server.py serves them
  pre-auth via the `_pub_static` exact-path map. sw.js is network-first
  for navigations (deploys visible immediately), never touches /api|/fb,
  only caches /app from a clean 200. Kill switch: unregister via
  DevTools or bump VERSION in sw.js.
- **Bottom tab bar** (<=600px): `.bottom-tabs` HTML after the mobile
  subnav; active state synced in setRoute; More sheet = #more-sheet.
  Top tab strips hidden on phones.
- **Back-gesture/Escape modal closing**: the single hashchange listener
  intercepts back-nav when an overlay is open; `_MOB_OVERLAYS` (end of
  main script) maps overlay id -> bespoke close fn. ADD NEW MODALS TO
  THIS LIST (inner-most first).
- **Mobile table cards**: Payments/Funding/IF/Comms + contact queue in
  the "MOBILE CARD PASS" CSS block; contact-queue tables carry
  `cq-tbl`/`cq-plain` classes so the Loans Due card map can't scramble
  them. New tables rendered into #rpt-table MUST get one of these
  classes.
- **Sheets**: `.appr-ov` family renders as bottom sheets <=600px.
- The topnav height var is `calc(60px + env(safe-area-inset-top))` —
  never hardcode 60px for offsets; use var(--topnav-h).

## Communications page (2026-07 perf fix)

The list loads via `GET /api/comms-list?limit=200[&before=<ms>]`
(server.py, right after the /fb/ GET proxy) — newest-first /emailLog
entries WITHOUT `rendered_html`/`replacements`. Never go back to
fetching the whole /emailLog node client-side: every record carries
~25 KB of rendered email HTML and the node grows forever. The endpoint
tries an indexed Firebase query first (needs `{"emailLog": {".indexOn":
"sent_at"}}` in the DB rules; constant-time) and falls back to a
server-side full fetch + strip when the index is missing — browser
payload is tiny either way. Preview bodies lazy-load per email via
`/fb/emailLog/{id}/rendered_html.json` in `openCommPreview` and are
cached on the entry. "Load older emails" pages back with `before=`.

The Payment Reminders card on this page (`#rem-card`) shows mode/last
sweep from `GET /api/reminders-status` and has two always-safe buttons:
"Email me the samples" (`POST /api/reminders-samples`) and "Run dry-run
sweep" (`POST /api/run-reminders-sweep` — backend forces dry_run unless
the cif-apply env is already live). All three proxy to cif-apply — see
cif-apply/CLAUDE.md "Payment reminders" for the backend. Reminder kinds
(`reminder_*`) have entries in `_COMM_KIND_LABELS`/`_COMM_KIND_COLORS`
and a grouped "Reminders" filter chip (startsWith match in
renderCommunications).

## Performance program (2026-07-09/10, phases 1-3)

Harry's ask: "Fast, reliable, professional. True fintech fortune 500."
Three phases, all shipped. Phase 1: optimistic setStatus +
updateQueueRowInPlace (row swap, not full rebuild), route-guarded
rerender(), fixed fast-poll predicate, async-ack emails
(`{ok,queued,to}` after dedup claim), consolidated one-PATCH
/api/override, gzip on the /fb/ proxy's upstream leg. Phase 2:
Open-in-Admin made deterministic (synchronous vergentCid/Loan index
writes at every link point, tri-state lookup contract
200/404-no_application/503-retryable, cid-first client flow). Phase 3
(the scale work) is below — read this before touching loadReports.

### Windowed queue + delta polling (phase 3 — how data loads now)

**The client NEVER downloads the full /reportsIndex (or /reports)
anymore.** Don't reintroduce a full fetch — that was the whole point.

- Boot + every ~10 min: `GET /api/reports-window?limit=1000` → newest
  1000 rows **plus every unsettled row** (pending/processing/error —
  so reviewQueue()/KPI-pending stay exact even when an old stuck
  Pending falls outside the window). Response carries `complete`,
  `total`, and `windowOldest` — the paging cursor, computed from the
  CONTIGUOUS createdAt window only (an ancient unsettled straggler
  must not drag the cursor back; caught by test, don't "simplify").
  **Straggler identity mask** (`_reports_customer_key`, lock-step with
  customerKey()): a straggler only ships if it's the customer's NEWEST
  application — the client dedups to latest-per-customer, so shipping
  an old Pending without its newer settled (outside-window) sibling
  "resurrects" it in the review queue. First deploy did exactly that
  (operator saw 60+ dead pendings reappear); don't remove the mask.
  When out-of-window stragglers exist, the indexed path defers to the
  full-fetch fallback (the mask needs the whole index — fine at
  current scale; the delta poll stays indexed either way).
- Every other poll (60s visible / 20s in-flight fast-poll):
  `GET /api/reports-delta?since=<watermark>` → only changed rows
  (updatedAt OR createdAt > since). `_mergeReportRows` replace-or-
  inserts by firebaseId. Watermark `_reportsSyncAt` = max
  created/updatedAt seen, polled with a 5s overlap (idempotent).
  `truncated: true` (>2000 changed) → client falls back to a full
  window reload. Deletes are invisible to delta — deleteApplication
  splices `apps` locally and the 10-min resync reconciles cross-tab.
- "Load older applications" button (queue tail, only when
  `!_reportsComplete`) pages back with `before=<cursor>`.
- **Servicing modals' identity fallback sweeps the full index**
  (`_identityFbIdWithServerSweep`): the cid lookup is authoritative,
  but customers whose applications PREDATE the Vergent-id linking get
  an honest no_application from it — pre-windowing, the local
  findAppByIdentity over all 8k rows caught them; post-windowing it
  went blind for exactly the old funded customers Servicing works
  (operator-reported "not finding the customer", 2026-07-10). The
  sweep re-uses _serverSearchReports (phone, then name), re-runs the
  guarded identity match, and on success writes the cid link onto the
  record (fire-and-forget) so the /fb/ mirror fans it into
  reportsIndex + vergentCidIndex — every later click is O(1).
- Global search: local filter as before, PLUS a 400ms-debounced
  `GET /api/reports-window?q=...` server sweep of the full index that
  merges matches into `apps` (`_serverSearchReports`) — operators can
  find ANY applicant ever. openCustomerInAdmin's email fallback does
  the same sweep before saying "No application found".
- Both endpoints live in server.py as pure helpers
  (`_reports_window_payload` / `_reports_delta_payload`) + thin
  handlers, right after /api/comms-list. They try indexed Firebase
  queries first and fall back to ONE server-side full fetch + filter.
  **Optional speed-up when the index grows:** add
  `{"reportsIndex": {".indexOn": ["createdAt","updatedAt","status"]}}`
  to the Firebase rules and the endpoints go constant-time (they log
  nothing when falling back — check `indexed` in the JSON).
- All-time dashboard stats come from `/fb/statsAggregates.json`
  (cif-apply computes total/byStatus/byDay-120d every 10 min, buckets
  mirror bucketStatus(), days in PT). renderDashboard uses
  `_statsCounts` whenever a KPI range reaches past the loaded window
  (`_statsRangeNeeded`); ranges inside the window count loaded rows
  exactly as before. Queue chips stay window-computed on purpose —
  they must equal the rows a click shows.
- The /fb/ GET proxy now FORWARDS query strings (safety-checked as a
  combined string), so `fbGet('node.json?orderBy=...')` works — the IF
  alert poll uses `?orderBy="$key"&limitToLast=50` ($key needs no
  .indexOn). loadPlaidCustomers/filterPlaidCustomers were deleted
  (dead since the App Links tab removal; last full-/reports readers).
- Hermetic tests exist in the session scratchpad pattern: stub server
  + Playwright (window boot, straggler-in-window, delta merge, load
  older, server search, stats KPI, "no full-index fetch" assertion).

## Coordinating with cif-apply

Many bugs span both repos (Bug 1 in particular). Read
`cif-apply/CLAUDE.md` before starting any Vergent work — it has
parallel sections covering the backend half of each bug.
