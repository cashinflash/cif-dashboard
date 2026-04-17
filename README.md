# cif-dashboard — app.cashinflash.com

Internal underwriting dashboard for the Cash in Flash team. Reviews bank
statements + Plaid data + v1/v2 engine decisions, lets underwriters approve or
decline applications, and acts as the operator UI for the engine.

## Stack

- Python stdlib `http.server` (no framework, empty `requirements.txt`)
- Vanilla JS SPA in `app.html` (~3,300 lines, inline CSS/JS)
- Firebase Realtime Database (reports + settings) via JSON REST
- Anthropic API (proxied for analysis calls)
- Render auto-deploy from `main`

## Files

- `server.py` — HTTP server, session/auth, proxy to cif-apply, Firebase passthrough
- `app.html` — single-page dashboard app
- `login.html` — login page
- `hash_password.py` — helper to generate scrypt hashes for env-var passwords
- `static/favicon.png` — brand icon (also used as header logo)
- `render.yaml`, `Procfile` — deploy config

## Auth

- scrypt-hashed passwords (stdlib only — no bcrypt dependency). Plaintext env-var
  passwords still work for backward compat, but log a warning on every login
  so they get migrated.
- HttpOnly, Secure, SameSite=Strict cookie for session (`cif_token`). JS can't
  read it (XSS-safe); browser sends it on every same-origin request via
  `credentials:'include'`.
- 30-minute idle timeout, 4-hour absolute max session lifetime.
- Rate limit: 5 failed attempts per IP in a rolling 5-minute window → 15-minute
  lockout. All attempts written to `[AUDIT]` log lines.
- CSRF protection: the SameSite=Strict cookie alone blocks cross-origin POSTs
  in modern browsers. No CSRF token needed.
- CORS restricted to `https://app.cashinflash.com` (was `*` before).
- `ADMIN_PASSWORD` is required (no hardcoded default). If unset, the admin
  account is disabled on startup.

## Setting / rotating a password

```bash
# Generate the hash
python3 hash_password.py "my-new-long-random-pw"
# → scrypt$abc123...$def456...

# Paste into Render env var:
#   ADMIN_PASSWORD = scrypt$abc123...$def456...
# or for a named user:
#   USER_1 = jane:scrypt$abc123...$def456...
```

## Endpoints (summary)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET  | `/` `/login` `/login.html` | Login page | Public |
| GET  | `/app` `/app.html` `/dashboard` | SPA (302 → `/` if no session) | Cookie |
| GET  | `/favicon.png` `/logo.png` | Static assets | Public |
| GET  | `/health` | Liveness + session count | Public |
| POST | `/api/login` | Credentials → sets `cif_token` cookie | Public (rate-limited) |
| POST | `/api/logout` | Invalidates session | Cookie |
| GET  | `/api/me` | Current user info | Cookie |
| GET  | `/fb/<path>` | Firebase RTDB read passthrough | Cookie |
| POST | `/fb/<path>` | Firebase RTDB write (uses `X-Method` header) | Cookie |
| POST | `/api/analyze` | Claude API proxy | Cookie |
| POST | `/api/analyze-engine` | cif-apply /api/analyze-engine proxy | Cookie |
| POST | `/api/rerun-engine` | cif-apply re-run v1 engine | Cookie |
| POST | `/api/rerun-v2` | cif-apply re-run v2 engine | Cookie |
| POST | `/api/rerun-plaid` | cif-apply refresh Plaid data | Cookie |
| GET  | `/api/v2-unclassified` | cif-apply Review Queue read | Cookie |
| POST | `/api/v2-entities-add` | cif-apply Review Queue commit | Cookie |
| POST | `/api/v2-unclassified-skip` | cif-apply Review Queue skip | Cookie |
| POST | `/api/send-denial` | cif-apply denial email | Cookie |

## Running locally

```bash
export ADMIN_PASSWORD='scrypt$...'   # or plaintext for quick dev
export ANTHROPIC_API_KEY='sk-ant-...'
python3 server.py
# http://localhost:8080
```

## Deploying

- `main` auto-deploys on Render.
- Feature branches → `claude/project-review-YLvks` by convention, merged via
  fast-forward.

## Audit log

Look for `[AUDIT]` lines in Render logs for login success / fail / rate-limit /
logout events. Password values are **never** logged.
