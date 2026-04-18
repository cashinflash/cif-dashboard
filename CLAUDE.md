# cif-dashboard

Internal underwriter SPA at https://app.cashinflash.com.

## Deploy

- **Host**: Render, service auto-deploys from `main`
- **URL**: https://app.cashinflash.com
- **In-flight branch**: `claude/project-review-YLvks`

## Architecture

- `server.py` — stdlib HTTPServer. Handles auth, session management, Firebase proxy, Anthropic proxy, cif-apply proxy.
- `app.html` — single-file SPA (~3500+ lines, inline CSS + JS). All underwriter views live here.
- `login.html` — standalone login page.
- `render.yaml` — service config.

## Auth

- In-memory session tokens (12h expiry, `cif_token` cookie). Sessions lost on service restart.
- User store: **Firebase RTDB at `users/`**, scrypt-hashed passwords.
- Env-var fallback: `ADMIN_PASSWORD` + `USER_1..USER_9` for bootstrap.
- Admin UI for adding/resetting/deleting users (Round 8).

## Main views in `app.html`

| View | Purpose |
|---|---|
| Dashboard | App list with filters, date grouping, auto-decide candidate chip |
| Divergence | Reports where v1 ≠ v2 (decision or amount) |
| Review Queue | Unclassified merchants needing human category pick |
| Users | Admin-only — add/reset/delete users |
| Analysis modal | Opens a report with tabs: Application / Documents / Notes / v2 Engine |

## Key API routes (`server.py`)

- `POST /api/login` / `/api/logout`
- `GET /fb/*` + `POST /fb/*` — Firebase RTDB passthrough
- `POST /api/analyze` — Anthropic API proxy
- `POST /api/analyze-engine` — proxy to cif-apply `/api/analyze-engine`
- `POST /api/rerun-engine` — proxy to cif-apply `/api/rerun-engine`
- `POST /api/rerun-v2` — proxy to cif-apply `/api/rerun-v2`
- `POST /api/refresh-from-plaid` — proxy to cif-apply equivalent (Round 12)
- `POST /api/send-denial` — proxy for denial email send
- `POST /api/users/{add,reset,delete,migrate-from-env}` — admin-only

## Firebase shape (`reports/<id>`)

Main decision fields (v1):
- `claudeDecision` (APPROVE / DECLINE / MANUAL-REVIEW)
- `amount` ("$150"), `reason`, `score`
- `status` ("Processing" / "Complete" / "Error")

Shadow v2 fields (never touch these from v1):
- `v2Decision`, `v2TierAmount`, `v2Report` (HTML), `v2RunAt`, `v2AutoError`, `v2UnclassifiedJson`
- `plaidRefreshedAt`, `connectedAccountCount`
- `applicationData` (nested form fields)
- `bankStatementUrl`, `govIdUrl` (Firebase Storage URLs)

Underwriting rules settings: `settings/underwriting.json` with shape `{activeProfile, rules, updatedAt}`. Path A (new apps) and path B (dashboard recalculate) both read from here.

## Conventions

- No frontend framework — vanilla JS. Keep it that way.
- All Firebase access via `/fb/*` proxy; the browser never sees Firebase creds.
- When adding a new endpoint, register it in the server.py tuple AND add the handler BODY inside that branch — the Round 9 bug was a new route being unreachable because the tuple wasn't updated.

## Known unresolved issues

- `app.html` at ~3500 lines is painful. An `claude/dashboard-split` branch existed but is unmerged.
- In-memory sessions reset on deploy; sometimes underwriters have to re-login after a Render push.
