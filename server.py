#!/usr/bin/env python3
"""Cash in Flash — Underwriting Dashboard Web Server"""
import collections, hashlib, hmac, http.client, json, os, re, secrets, ssl, time, urllib.error, urllib.request
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get('PORT', 8080))
FB_BASE = 'https://cashinflash-a1dce-default-rtdb.firebaseio.com'
# Firebase RTDB legacy database secret. When set, every server-side
# Firebase REST call appends ?auth=<secret> (privileged, bypasses
# rules) so we can lock the rules to deny public access. UNSET =
# behaves exactly as before — deploying this before the env var
# exists is a no-op.
FIREBASE_DB_SECRET = os.environ.get('FIREBASE_DB_SECRET', '').strip()


def _fb_url(suffix):
    """Build a full Firebase REST URL ('<FB_BASE>/<suffix>' + auth).
    `suffix` may already contain a query string; auth is appended with
    & or ? accordingly."""
    url = f'{FB_BASE}/{suffix}'
    if FIREBASE_DB_SECRET:
        url += ('&' if '?' in url else '?') + 'auth=' + FIREBASE_DB_SECRET
    return url


# Compact /reportsIndex projection — MUST stay in lock-step with
# cif-apply run_server.py. cif-apply mirrors backend (intake/engine)
# writes; this dashboard mirrors OPERATOR writes (approve/decline/
# amount/notes) that go straight to /reports via the /fb/ write proxy
# and would otherwise leave the index stale ("everything Pending after
# refresh until you open each one").
_INDEX_TOP_FIELDS = (
    'name', 'status', 'createdAt', 'updatedAt', 'date', 'time',
    'source', 'amount', 'submissionId', 'filename', 'claudeDecision',
    'reason', 'v2Decision', 'vergentGuid', 'processingComplete',
    # v4 (spec §8): list-row subtitle + tier badge + human action.
    # 'score' dropped — dead v1 field, no longer written by cif-apply.
    # humanActionBy/autoDeclineBucket: so the queue can badge auto-declines.
    'v4ReasonLine', 'v4Decision', 'v4Tier', 'humanAction',
    'humanActionBy', 'autoDeclineBucket',
)
_INDEX_APPDATA_FIELDS = ('email', 'phone', 'firstName', 'lastName')


def _mirror_report_write_to_index(fb_path, method, raw):
    """Keep /reportsIndex in lock-step with operator writes to
    /reports/{id} via the /fb/ proxy:
      - PATCH|PUT → mirror the small list fields into reportsIndex/{id}
      - DELETE of the whole record → delete reportsIndex/{id} too, or
        the deleted applicant ghosts the list (row stays, opens empty)
        because the dashboard now reads the index, not /reports.
    One tiny write per operator action — not a per-poll cost.
    Best-effort: never raises."""
    try:
        if not fb_path.startswith('reports/'):
            return
        rest = fb_path[len('reports/'):]
        if rest.endswith('.json'):
            rest = rest[:-5]

        # Whole-record delete → drop the matching index entry.
        if method == 'DELETE' and '/' not in rest and rest:
            dreq = urllib.request.Request(
                _fb_url(f'reportsIndex/{rest}.json'), method='DELETE')
            urllib.request.urlopen(dreq, timeout=10).read()
            return

        if method not in ('PATCH', 'PUT'):
            return
        sent = json.loads(raw or b'{}')
        if not isinstance(sent, dict):
            return
        rid, proj = None, None
        if '/' not in rest:                                   # reports/{id}
            rid = rest
            proj = {k: sent[k] for k in _INDEX_TOP_FIELDS if k in sent}
            ad = sent.get('applicationData')
            if isinstance(ad, dict):
                for k in _INDEX_APPDATA_FIELDS:
                    if k in ad:
                        proj[k] = ad[k]
                proj['hasApp'] = True
            # Derived: Vergent customer id -> the index, so the servicing
            # pages resolve customer -> application client-side. Lock-step
            # with cif-apply run_server.py's _derive_vergent_idx_fields.
            vm = sent.get('vergentMatch')
            cid = str((vm or {}).get('customerId') or '').strip() \
                if isinstance(vm, dict) else ''
            if not cid:
                cid = str(sent.get('vergentCustomerId') or '').strip()
            if cid:
                proj['vergentCid'] = cid
        elif rest.endswith('/applicationData'):               # reports/{id}/applicationData
            rid = rest[:-len('/applicationData')]
            proj = {k: sent[k] for k in _INDEX_APPDATA_FIELDS if k in sent}
        elif rest.endswith('/vergentMatch'):                  # reports/{id}/vergentMatch
            # The Phase-2 badge ("Use this ID" etc.) writes the match via
            # the /fb/ proxy — mirror the cid so client-side resolution
            # sees it immediately.
            rid = rest[:-len('/vergentMatch')]
            _vm_cid = str(sent.get('customerId') or '').strip()
            proj = {'vergentCid': _vm_cid} if _vm_cid else None
        if rid and proj:
            ireq = urllib.request.Request(
                _fb_url(f'reportsIndex/{rid}.json'),
                data=json.dumps(proj).encode(),
                headers={'Content-Type': 'application/json'},
                method='PATCH')
            urllib.request.urlopen(ireq, timeout=10).read()
    except Exception as e:
        print(f'[REPORTS-INDEX-MIRROR] {fb_path} failed: {e}', flush=True)
ANTHROPIC_KEY = os.environ.get('ANTHROPIC_API_KEY', '')

# Instant-Funding vault (for /if page submissions).
# IF_API_BASE is the cif-portal HttpApi root (no trailing /api).
# IF_VIEW_SECRET is the shared secret for GET /api/if/list + /view.
# Both live in Render env vars — set once per deploy.
IF_API_BASE = os.environ.get(
    'IF_API_BASE',
    'https://anh066l1wf.execute-api.us-east-1.amazonaws.com/dev'
).rstrip('/')
IF_VIEW_SECRET = os.environ.get('IF_VIEW_SECRET', '')

# Portal admin proxy (Phase U.2 — Plaid bank links from cif-portal).
# Auth flow: cif-dashboard backend authenticates as a Cognito
# service user that's a member of the cif-admin group, then signs
# requests to cif-portal /api/admin/* with the resulting ID token.
# Per-admin attribution is preserved via cif-dashboard's own
# session log (same pattern as /api/if/* above).
#
# Set these in Render env vars after running cif-portal's
# provision-admin-group.yml workflow (it prints them to the
# workflow summary one-time).
PORTAL_ADMIN_SVC_EMAIL = os.environ.get('PORTAL_ADMIN_SVC_EMAIL', '')
PORTAL_ADMIN_SVC_PASSWORD = os.environ.get('PORTAL_ADMIN_SVC_PASSWORD', '')
PORTAL_COGNITO_USER_POOL_ID = os.environ.get(
    'PORTAL_COGNITO_USER_POOL_ID', 'us-east-1_U508xOs95'
)
PORTAL_COGNITO_APP_CLIENT_ID = os.environ.get(
    'PORTAL_COGNITO_APP_CLIENT_ID', '1mddi61n19hftaldt9t3r622b'
)
PORTAL_API_BASE = os.environ.get('PORTAL_API_BASE', IF_API_BASE).rstrip('/')
# Portal frontend origin — used to build the "View as customer"
# new-tab URL. Defaults to the dev CloudFront URL where the
# cif-portal frontend is served from S3 (the same default the
# cif-portal Lambda's PORTAL_ORIGIN env var uses). When the
# customer portal moves to a custom domain (e.g.
# https://cashinflash.com), set PORTAL_FRONTEND_ORIGIN in the
# Render environment for cif-dashboard.
PORTAL_FRONTEND_ORIGIN = os.environ.get(
    'PORTAL_FRONTEND_ORIGIN', 'https://d1zucrj1ouu3c.cloudfront.net'
).rstrip('/')

# Module-level cache for the service user's Cognito ID token.
# Refreshed on TTL expiry or on a 401 from the portal.
_portal_admin_token = {'value': '', 'expires_at': 0.0}


def _get_portal_admin_token():
    """Fetch + cache a Cognito ID token for the service user.

    Returns a tuple (token, error_code). On success: (token, '').
    On failure: ('', '<code>') where code is one of:
      env_vars_missing       — PORTAL_ADMIN_SVC_EMAIL/PASSWORD unset
      cognito_<TypeName>     — Cognito __type from error body
                               (e.g. cognito_NotAuthorizedException,
                               cognito_UserNotFoundException)
      cognito_http_<code>    — HTTPError without parseable __type
      cognito_network        — urllib failed (timeout, DNS, etc.)
      cognito_no_token       — 200 OK but AuthenticationResult missing
    """
    now = time.time()
    cached = _portal_admin_token
    if cached['value'] and now < cached['expires_at']:
        return cached['value'], ''
    if not (PORTAL_ADMIN_SVC_EMAIL and PORTAL_ADMIN_SVC_PASSWORD):
        return '', 'env_vars_missing'
    # Region = first segment of the user pool id ("us-east-1_xxx").
    region = (PORTAL_COGNITO_USER_POOL_ID.split('_') or ['us-east-1'])[0]
    payload = {
        'AuthFlow': 'USER_PASSWORD_AUTH',
        'ClientId': PORTAL_COGNITO_APP_CLIENT_ID,
        'AuthParameters': {
            'USERNAME': PORTAL_ADMIN_SVC_EMAIL,
            'PASSWORD': PORTAL_ADMIN_SVC_PASSWORD,
        },
    }
    req = urllib.request.Request(
        f'https://cognito-idp.{region}.amazonaws.com/',
        data=json.dumps(payload).encode('utf-8'),
        method='POST',
        headers={
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = (e.read() or b'').decode('utf-8', 'replace')[:500]
        except Exception:
            pass
        print(f'[portal-admin-auth] HTTP {e.code}: {body}')
        # Cognito error bodies are JSON with shape:
        # {"__type":"NotAuthorizedException","message":"..."}
        # Some responses prefix the type with a module path
        # (e.g. "com.amazonaws.cognitoidp#NotAuthorizedException")
        # — strip everything up to the last '#' or '.'.
        err_type = ''
        err_msg = ''
        try:
            parsed = json.loads(body) if body else {}
            err_type = (parsed.get('__type') or '').strip()
            err_msg = (parsed.get('message') or parsed.get('Message') or '').strip()
            for sep in ('#', '.'):
                if sep in err_type:
                    err_type = err_type.rsplit(sep, 1)[-1]
        except Exception:
            pass
        # Bake the Cognito message into the error code (truncated)
        # so the dashboard surfaces it directly without log-digging.
        # NotAuthorizedException covers both "wrong password" and
        # "flow not enabled" — only the message disambiguates.
        suffix = f': {err_msg[:140]}' if err_msg else ''
        if err_type:
            return '', f'cognito_{err_type}{suffix}'
        return '', f'cognito_http_{e.code}{suffix}'
    except Exception as e:
        print(f'[portal-admin-auth] failed: {type(e).__name__}: {e}')
        return '', 'cognito_network'
    auth = (data or {}).get('AuthenticationResult') or {}
    tok = auth.get('IdToken') or ''
    ttl = int(auth.get('ExpiresIn') or 0)
    if tok and ttl:
        _portal_admin_token['value'] = tok
        # Refresh 60s before actual expiry to avoid races.
        _portal_admin_token['expires_at'] = now + max(60, ttl - 60)
        return tok, ''
    return '', 'cognito_no_token'


def _call_portal_admin(method: str, path: str, body=None):
    """Proxy to /api/admin/* on cif-portal with the cached service
    JWT. Auto-refreshes on 401. Returns (status_code, body_bytes)."""
    for attempt in range(2):
        tok, err = _get_portal_admin_token()
        if not tok:
            return 0, json.dumps(
                {'error': err or 'portal_admin_auth_unavailable'}
            ).encode('utf-8')
        headers = {
            'Authorization': f'Bearer {tok}',
            'Accept': 'application/json',
        }
        data = None
        if body is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(body).encode('utf-8')
        req = urllib.request.Request(
            f'{PORTAL_API_BASE}{path}',
            method=method, headers=headers, data=data,
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.getcode(), r.read()
        except urllib.error.HTTPError as e:
            raw = b''
            try:
                raw = e.read() or b''
            except Exception:
                pass
            if e.code == 401 and attempt == 0:
                # Token expired or rotated → drop cache + retry once.
                _portal_admin_token['value'] = ''
                _portal_admin_token['expires_at'] = 0.0
                continue
            return e.code, raw
        except Exception as e:
            print(f'[portal-admin-call] {method} {path} failed: {type(e).__name__}: {e}')
            return 0, b''
    return 0, b''

def _call_portal_admin_pdf(path: str):
    """Variant of _call_portal_admin for binary PDF responses. Returns
    (status_code, body_bytes, content_type). Forwards the upstream
    Content-Type so the dashboard can hand the bytes off to the
    browser correctly."""
    for attempt in range(2):
        tok, err = _get_portal_admin_token()
        if not tok:
            return 0, json.dumps(
                {'error': err or 'portal_admin_auth_unavailable'}
            ).encode('utf-8'), 'application/json'
        req = urllib.request.Request(
            f'{PORTAL_API_BASE}{path}',
            method='GET',
            headers={
                'Authorization': f'Bearer {tok}',
                'Accept': 'application/pdf,application/json',
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                ctype = r.headers.get('Content-Type', 'application/pdf')
                return r.getcode(), r.read(), ctype
        except urllib.error.HTTPError as e:
            raw = b''
            try: raw = e.read() or b''
            except Exception: pass
            ctype = (
                e.headers.get('Content-Type', 'application/json')
                if hasattr(e, 'headers') and e.headers else 'application/json'
            )
            if e.code == 401 and attempt == 0:
                _portal_admin_token['value'] = ''
                _portal_admin_token['expires_at'] = 0.0
                continue
            return e.code, raw, ctype
        except Exception as e:
            print(f'[portal-admin-pdf] {path} failed: {type(e).__name__}: {e}')
            return 0, b'', 'application/json'
    return 0, b'', 'application/json'


# Admin password is required — no hardcoded default. If ADMIN_PASSWORD is not
# set in the environment, the admin account is disabled.
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD')

DIR = os.path.dirname(os.path.abspath(__file__))

# ─────────────────────────────────────────────────────────────────────────────
# Password hashing (scrypt — NIST-approved, stdlib-only so no new dependency)
#
# Stored format:  scrypt$<salt-hex>$<hash-hex>
# ─────────────────────────────────────────────────────────────────────────────
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P, _SCRYPT_DKLEN = 16384, 8, 1, 32


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(
        password.encode('utf-8'), salt=salt,
        n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=_SCRYPT_DKLEN,
    )
    return f"scrypt${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str, who: str = '?') -> bool:
    """Constant-time compare. Accepts scrypt-hashed OR plaintext (with warning)
    for backward compatibility during migration."""
    if not stored:
        return False
    if stored.startswith('scrypt$'):
        try:
            _, salt_hex, hash_hex = stored.split('$', 2)
            salt = bytes.fromhex(salt_hex)
            expected = bytes.fromhex(hash_hex)
            actual = hashlib.scrypt(
                password.encode('utf-8'), salt=salt,
                n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=_SCRYPT_DKLEN,
            )
            return hmac.compare_digest(expected, actual)
        except Exception:
            return False
    # Plaintext fallback — must be explicitly allowed during migration.
    if hmac.compare_digest(stored, password):
        print(
            f'[AUTH WARN] User {who!r} has a plaintext password. Rotate to a '
            f'scrypt hash via: python3 hash_password.py <newpassword>',
            flush=True,
        )
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Sessions + rate limiting (both in-process — OK for single-instance Render app)
# ─────────────────────────────────────────────────────────────────────────────
sessions = {}   # token -> {'user', 'created', 'last_active', 'ip'}
_login_attempts = collections.defaultdict(list)  # ip -> [(ts, success), ...]

# 30-minute idle timeout, 4-hour absolute session lifetime.
SESSION_IDLE_SECONDS = 30 * 60
SESSION_MAX_SECONDS = 4 * 60 * 60

# Rate limit: 5 failed attempts per IP in any rolling 5-minute window locks
# that IP out for 15 minutes.
RATE_LIMIT_MAX_FAILS = 5
RATE_LIMIT_WINDOW = 5 * 60
RATE_LIMIT_COOLDOWN = 15 * 60


def _client_ip(handler) -> str:
    # Render / most proxies forward the original IP in X-Forwarded-For (comma-separated).
    xff = handler.headers.get('X-Forwarded-For', '')
    if xff:
        return xff.split(',')[0].strip()
    return handler.client_address[0] if handler.client_address else '?'


def check_rate_limit(ip: str) -> tuple[bool, int]:
    """Return (allowed, retry_after_seconds). Prunes stale attempts in-place."""
    now = time.time()
    attempts = _login_attempts[ip]
    # Prune anything older than the cooldown window — we never need it again.
    attempts[:] = [(t, ok) for t, ok in attempts if now - t < RATE_LIMIT_COOLDOWN]
    recent_fails = [t for t, ok in attempts if not ok and now - t < RATE_LIMIT_WINDOW]
    if len(recent_fails) >= RATE_LIMIT_MAX_FAILS:
        oldest = min(recent_fails)
        retry_in = int(RATE_LIMIT_COOLDOWN - (now - oldest))
        return False, max(1, retry_in)
    return True, 0


def record_login_attempt(ip: str, success: bool) -> None:
    _login_attempts[ip].append((time.time(), success))


def make_session(username: str, ip: str, role: str = 'user') -> str:
    # 256 bits of entropy — no guessable content (no username, no timestamp).
    token = secrets.token_urlsafe(32)
    now = time.time()
    sessions[token] = {'user': username, 'role': role, 'created': now, 'last_active': now, 'ip': ip}
    return token


def is_admin_session(token: str) -> bool:
    s = sessions.get(token) or {}
    return s.get('role') == 'admin'


def valid_session(token: str) -> bool:
    if not token or token not in sessions:
        return False
    s = sessions[token]
    now = time.time()
    if now - s['created'] > SESSION_MAX_SECONDS:
        del sessions[token]
        return False
    if now - s['last_active'] > SESSION_IDLE_SECONDS:
        del sessions[token]
        return False
    s['last_active'] = now
    return True


def get_token_from_request(handler) -> str:
    """Extract session token from the HttpOnly cookie.

    Previously fell back to an X-Session header and ?token= query param
    for legacy compat. Both fallbacks were removed — tokens in URLs leak
    via referer / proxy logs / browser history, and the current app.html
    + login.html never use either path. CSRF is blocked by the cookie's
    SameSite=Strict flag — cross-origin requests never send the cookie.
    """
    for c in handler.headers.get('Cookie', '').split(';'):
        c = c.strip()
        if c.startswith('cif_token='):
            return c[len('cif_token='):]
    return ''


# ─────────────────────────────────────────────────────────────────────────────
# User store — Firebase is the primary source of truth, env vars are a
# bootstrap fallback so an accidentally corrupted Firebase can't lock everyone
# out. Users added via the dashboard UI persist to /users/<name> in Firebase
# and show up on the next cache refresh (or immediately via invalidate()).
# ─────────────────────────────────────────────────────────────────────────────

_USERNAME_RE = __import__('re').compile(r'^[a-z0-9_.-]{2,32}$')
_USER_CACHE_TTL = 60  # seconds
_user_cache = {'data': {}, 'loaded_at': 0.0}


def valid_username(name: str) -> bool:
    return bool(name) and bool(_USERNAME_RE.match(name))


def valid_password(pw: str) -> tuple[bool, str]:
    if not pw or len(pw) < 8:
        return False, 'Password must be at least 8 characters.'
    return True, ''


def firebase_get_users() -> dict:
    """Fetch /users subtree from Firebase. Returns {} on any error (caller
    decides whether to fall back to env vars)."""
    try:
        with urllib.request.urlopen(_fb_url('users.json'), timeout=5) as r:
            data = json.loads(r.read().decode() or 'null')
        return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f'[USERS] firebase fetch failed: {e}', flush=True)
        return {}


def firebase_put_user(username: str, record: dict) -> bool:
    try:
        payload = json.dumps(record).encode()
        req = urllib.request.Request(
            _fb_url(f'users/{username}.json'),
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='PUT',
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            r.read()
        return True
    except Exception as e:
        print(f'[USERS] firebase put failed for {username}: {e}', flush=True)
        return False


def firebase_delete_user(username: str) -> bool:
    try:
        req = urllib.request.Request(
            _fb_url(f'users/{username}.json'), method='DELETE',
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            r.read()
        return True
    except Exception as e:
        print(f'[USERS] firebase delete failed for {username}: {e}', flush=True)
        return False


def _env_fallback_users() -> dict:
    """Legacy env-var users in the same shape as Firebase records."""
    users = {}
    if ADMIN_PASSWORD:
        users['admin'] = {'hash': ADMIN_PASSWORD, 'role': 'admin', 'source': 'env'}
    for i in range(1, 10):
        u = os.environ.get(f'USER_{i}', '')
        if u and ':' in u:
            name, pwd = u.split(':', 1)
            name = name.strip()
            if valid_username(name):
                users[name] = {'hash': pwd.strip(), 'role': 'user', 'source': 'env'}
    return users


def get_users(force_reload: bool = False) -> dict:
    """Return merged user map {name: {hash, role, ...}}. Firebase wins over env."""
    now = time.time()
    if not force_reload and now - _user_cache['loaded_at'] < _USER_CACHE_TTL and _user_cache['data']:
        return _user_cache['data']
    env_users = _env_fallback_users()
    fb_users = firebase_get_users()
    merged = dict(env_users)
    for name, rec in fb_users.items():
        if not isinstance(rec, dict) or not valid_username(name):
            continue
        # Firebase entries must have at least a hash; role defaults to 'user'.
        if not rec.get('hash'):
            continue
        merged[name] = {
            'hash': rec['hash'],
            'role': rec.get('role', 'user'),
            'source': 'firebase',
            'created_at': rec.get('created_at'),
            'created_by': rec.get('created_by'),
            'last_login': rec.get('last_login'),
        }
    if not merged and ADMIN_PASSWORD is None:
        print('[AUTH WARN] ADMIN_PASSWORD not set and no Firebase users — login is disabled.', flush=True)
    _user_cache['data'] = merged
    _user_cache['loaded_at'] = now
    return merged


def invalidate_user_cache() -> None:
    _user_cache['loaded_at'] = 0.0


# Backward-compat shim: some code paths still reference USERS as a dict.
class _UsersProxy:
    def get(self, name, default=None):
        u = get_users().get(name)
        return u['hash'] if u else default

    def keys(self):
        return get_users().keys()

    def __contains__(self, name):
        return name in get_users()


USERS = _UsersProxy()


def read_file(path):
    try:
        with open(path, 'rb') as f:
            return f.read()
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Phase 2: small client-side panel injected into app.html on serve.
#
# Watches the dashboard's currently-rendered application (best-effort —
# detects via several common selectors) and surfaces the `vergentMatch`
# status that cif-apply now writes after every /submit:
#
#   found      — green "✓ Existing customer #12345"
#   not_found  — orange "✗ Not in Vergent yet" + "Create + Push" button
#   ambiguous  — yellow "⚠ N matches — pick one" + candidate picker
#   error      — red error pill
#
# The panel calls POST /api/push-to-vergent (which proxies to cif-apply's
# new multi-doc handler). The legacy POST /api/push-plaid-to-vergent
# proxy below still works through the cif-apply shim, so the existing
# button wiring in app.html keeps functioning unchanged.
#
# This is an additive overlay — does not modify app.html on disk. When
# we eventually edit app.html directly to integrate the panel inline,
# this injection becomes redundant and can be deleted.
#
# Stored as `str` and encoded to UTF-8 at module load — Python 3
# bytes literals (b"""...""") cannot contain non-ASCII characters,
# and this string contains check marks / em-dashes / ellipsis used
# by the panel's user-facing copy.
# ─────────────────────────────────────────────────────────────────────────────
_PHASE2_PANEL_HTML = ("""
<style>
  /* Vergent panel — labeled card sitting below the analysis-tools
     toolbar in the Report tab. Card chrome (white bg + thin border +
     header) gives the operator's primary CRM action a clear visual
     home; the action buttons / pill / checkboxes inside still use
     the inline-style tokens that match app.html's design language. */
  .v2chip {
    display: block;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 12px 14px;
    margin: 10px 0;
    font-family: inherit; font-size: 12px; line-height: 1.4;
  }
  .v2chip-hdr {
    color: #6b7280; font-size: 10px; font-weight: 700;
    letter-spacing: .06em; text-transform: uppercase;
    margin-bottom: 8px;
  }
  .v2chip-row {
    display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  }
  .v2pill {
    display: inline-flex; align-items: center;
    padding: 6px 10px; border-radius: 20px;
    font-size: 11px; font-weight: 700; letter-spacing: .02em;
    border: 1px solid; white-space: nowrap;
  }
  .v2pill-found    { background:#e8f3f8; color:#1a4d6b; border-color:#6cb1e2; }
  .v2pill-notfound { background:#fff5e6; color:#5a3300; border-color:#ffd9a3; }
  .v2pill-ambig    { background:#fff5e6; color:#5a4a00; border-color:#f0c870; }
  .v2pill-err      { background:#fde7e7; color:#5a0d0d; border-color:#f0a3a3; }
  .v2pill-pending  { background:#f3f4f6; color:#374151; border-color:#d1d5db; }
  .v2btn {
    display: inline-flex; align-items: center;
    background:#e8f3f8; color:#1a4d6b; border:1px solid #6cb1e2;
    padding:8px 12px; border-radius:8px;
    font-size:12px; font-weight:700;
    cursor:pointer; font-family:inherit;
    white-space: nowrap;
  }
  .v2btn:hover    { background:#d4e9f3; }
  .v2btn:disabled { opacity:.5; cursor:not-allowed; }
  .v2btn.sec      { background:transparent; color:#374151; border-color:#d1d5db; }
  .v2btn.sec:hover { background:#f3f4f6; }
  .v2input {
    padding:7px 10px; border-radius:8px; border:1px solid #d1d5db;
    font-size:12px; width:160px; font-family:inherit;
    box-sizing: border-box;
  }
  .v2b-meta {
    font-size:11px; color:#6b7280; font-style:italic;
  }
  .v2b-result { font-size:11px; font-weight:700; }
  .v2kind, .v2cand {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 12px; cursor: pointer;
    padding: 4px 4px;
  }
  .v2kind input, .v2cand input { margin: 0; cursor: pointer; }
  .v2note {
    flex: 1 1 200px; min-width: 160px;
    font-family: inherit; font-size: 12px;
    padding: 6px 8px;
    border: 1px solid #d1d5db; border-radius: 6px;
    background: white; color: #111827;
  }
  .v2note:focus { outline: 2px solid #6cb1e2; outline-offset: -1px; }
  .v2populated { font-size:11px; color:#374151; margin-top:4px; line-height:1.4; }
</style>
<script>
(function() {
  // Phase 2: inject an inline Vergent status badge into each applicant's
  // detail view, right after the legacy "Push to Vergent" button.
  // Polls every 2s; re-fetches from Firebase every 30s for the same fbId
  // so it picks up the auto-search result written ~15s after submission.
  if (window.__vergentPhase2Init) return;
  window.__vergentPhase2Init = true;

  function findCurrentFirebaseId() {
    var m = window.location.hash.match(/-O[A-Za-z0-9_-]{15,}/);
    if (m) return m[0];
    m = window.location.search.match(/[?&]id=(-O[A-Za-z0-9_-]{15,})/);
    if (m) return m[1];
    var el = document.querySelector('[data-firebase-id]:not([hidden]):not([style*="display: none"])');
    if (el) return el.getAttribute('data-firebase-id');
    if (window.currentFirebaseId) return window.currentFirebaseId;
    if (window.currentApp && window.currentApp.firebaseId) return window.currentApp.firebaseId;
    return null;
  }

  function getOrInsertBadge(fbId) {
    var id = 'vergent-badge-' + fbId;
    var badge = document.getElementById(id);
    if (badge) return badge;
    badge = document.createElement('div');
    badge.id = id;
    // Strategy 1: place the card right BELOW the analysis-tools
    // toolbar in the Report tab. Walk up two levels from any toolbar
    // button (push / rerun / refresh) to the outer rerunHeader <div>,
    // then insert the card as its next sibling. Keeps the card from
    // becoming a flex-item inside the toolbar row.
    var toolbarBtn = document.getElementById('vergentpush-' + fbId)
                  || document.getElementById('v2run-' + fbId)
                  || document.getElementById('plaidref-' + fbId);
    if (toolbarBtn && toolbarBtn.parentNode
        && toolbarBtn.parentNode.parentNode
        && toolbarBtn.parentNode.parentNode.parentNode) {
      var rerunHeader = toolbarBtn.parentNode.parentNode;
      rerunHeader.parentNode.insertBefore(badge, rerunHeader.nextSibling);
      return badge;
    }
    // Strategy 2: insert right after the modal's sticky action bar.
    // .msticky exists in every #detailBody render (apply OR docs) so
    // docs-record applicants get an inline anchor too. We're called
    // from poll() only after findCurrentFirebaseId() returns this fbId
    // — meaning the URL hash already matches — so the .msticky we find
    // is guaranteed to belong to this applicant.
    var sticky = document.querySelector('#detailBody .msticky');
    if (sticky && sticky.parentNode) {
      sticky.parentNode.insertBefore(badge, sticky.nextSibling);
      return badge;
    }
    // Strategy 3: legacy data-firebase-id container (currently unused
    // by app.html but harmless to keep for forward-compat).
    var container = document.querySelector('[data-firebase-id="' + fbId + '"]');
    if (container) { container.appendChild(badge); return badge; }
    // Strategy 4: fixed banner (last resort — modal not open yet).
    badge.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;'
      + 'max-width:340px;box-shadow:0 4px 16px rgba(0,0,0,.2);';
    document.body.appendChild(badge);
    return badge;
  }

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function render(match, fbId) {
    var badge = getOrInsertBadge(fbId);
    var status = (match && match.status) || 'unknown';
    badge.className = 'v2chip';

    var docsHint = (match && match.searchNotes === 'partial_ssn_name_dob_only')
      ? '<span class="v2b-meta" title="docs form — full SSN not collected">name+DOB only</span>'
      : '';

    var html = '';
    if (status === 'found') {
      var cid = match.customerId || '';
      var pushed = match.vergentPushedDocs || {};
      var bsTag = pushed.bank_statement  ? ' ✓' : '';
      var dlTag = pushed.drivers_license ? ' ✓' : '';
      // Statement + DL are ALWAYS pushed on every Push action (operator
      // request: they're required, the checkboxes were noise). The
      // pushed-tags inline ("DL ✓ · Statement ✓") still show what's
      // already on file in Vergent.
      html = '<span class="v2pill v2pill-found">✓ Vergent: #' + cid + '</span>'
        + docsHint
        + '<span class="v2b-meta">Will push: DL' + dlTag + ' · Statement' + bsTag + '</span>'
        + '<button type="button" class="v2btn" data-action="push">↗ Push docs</button>'
        + '<span class="v2b-result"></span>';

    } else if (status === 'not_found') {
      // Branch on source. docs.cashinflash.com applicants are
      // re-applicants — they almost always already exist in Vergent
      // by virtue of having a prior loan. If our search couldn't
      // find them anyway (data drift, name change, etc.) the
      // operator handles it directly inside Vergent — the dashboard
      // shouldn't try to create or guess. apply.cashinflash.com
      // applicants ARE often genuinely new customers: keep the
      // Create + Push affordance.
      var isDocs = (match && match.source === 'docs');
      if (isDocs) {
        html = '<span class="v2pill v2pill-notfound">+ Vergent: New</span>'
          + docsHint
          + '<span class="v2b-meta">Not found via auto-search. Locate them in Vergent directly.</span>'
          + '<button type="button" class="v2btn sec" data-action="recheck">↻ Re-check</button>'
          + '<span class="v2b-result"></span>';
      } else {
        // Statement + DL are always sent on Create + Push (operator
        // request: they're required, the checkboxes were noise).
        html = '<span class="v2pill v2pill-notfound">+ Vergent: New</span>'
          + docsHint
          + '<input type="text" class="v2note" data-action="note-input" placeholder="Note for Vergent (optional, e.g. Approved $100)" maxlength="200">'
          + '<button type="button" class="v2btn" data-action="create-and-push">↗ Create Customer + Push docs</button>'
          + '<button type="button" class="v2btn sec" data-action="recheck">↻ Re-check</button>'
          + '<span class="v2b-result"></span>';
      }

    } else if (status === 'ambiguous') {
      var cands = (match.candidates || []).slice(0, 5);
      var rows = cands.map(function(c, i) {
        var cid2 = c.customerId || c.CustomerId || c.id || '?';
        var nm = ((c.firstName || '') + ' ' + (c.lastName || '')).trim();
        return '<label class="v2cand"><input type="radio" name="vcand" value="' + escAttr(cid2) + '"'
          + (i === 0 ? ' checked' : '') + '> #' + escAttr(cid2) + (nm ? ' ' + escAttr(nm) : '') + '</label>';
      }).join('');
      // Statement + DL are always pushed on Use + Push (operator
      // request: they're required, the checkboxes were noise).
      html = '<span class="v2pill v2pill-ambig">⚠ Vergent: ' + (match.totalCount || cands.length) + ' matches</span>'
        + docsHint
        + rows
        + '<button type="button" class="v2btn" data-action="push-pick">↗ Use + Push docs</button>'
        + '<button type="button" class="v2btn sec" data-action="recheck">↻ Re-check</button>'
        + '<span class="v2b-result"></span>';

    } else if (status === 'error') {
      var errFull = (match && match.errorBody) || 'Unknown error';
      var errShort = errFull.slice(0, 120);
      html = '<span class="v2pill v2pill-err">⚠ Vergent: Search error</span>'
        + '<span class="v2b-meta" title="' + escAttr(errFull) + '">' + escAttr(errShort) + '</span>'
        + '<button type="button" class="v2btn sec" data-action="recheck">↻ Re-check</button>';

    } else {
      html = '<span class="v2pill v2pill-pending">⏳ Vergent: Pending</span>'
        + '<button type="button" class="v2btn sec" data-action="recheck">↻ Re-check now</button>'
        + '<span class="v2b-result"></span>';
      // Auto-fire a server-side recheck the moment the badge enters
      // Pending state. setTimeout(0) defers until after this render
      // completes so the operator sees Pending briefly before the
      // recheck response (~1-3s) replaces it. Self-cancels if the
      // badge gets destroyed before the timer fires (e.g. modal
      // closed). Once vergentMatch is written, the badge won't
      // re-enter Pending so this fires at most once per applicant.
      setTimeout(function() {
        var stillPending = badge.querySelector('.v2pill-pending');
        if (stillPending && document.body.contains(badge)) {
          callRecheck(fbId, badge);
        }
      }, 0);
    }

    // Wrap the existing per-state HTML in a labeled card: small
     // "VERGENT" header on top, then a flex-wrap row of (pill +
     // action controls). Keeps the inline-flow row layout that the
     // checkbox / pill / button selectors all rely on, while giving
     // the panel a clear visual home in the Report tab.
    // Preserve any user-entered note text + focus position across the
    // re-render — the 30s poll cycle would otherwise wipe whatever
    // the operator was typing into the "Create + push" note field.
    var __noteEl = badge.querySelector('[data-action="note-input"]');
    var __noteVal = __noteEl ? (__noteEl.value || '') : '';
    var __noteFocused = !!(__noteEl && document.activeElement === __noteEl);
    var __noteCaret = __noteFocused ? (__noteEl.selectionStart || __noteVal.length) : 0;
    badge.innerHTML = '<div class="v2chip-hdr">Vergent</div>'
                    + '<div class="v2chip-row">' + html + '</div>';
    if (__noteVal || __noteFocused) {
      var __newNote = badge.querySelector('[data-action="note-input"]');
      if (__newNote) {
        __newNote.value = __noteVal;
        if (__noteFocused) {
          __newNote.focus();
          try { __newNote.setSelectionRange(__noteCaret, __noteCaret); } catch (_e) {}
        }
      }
    }
    badge.querySelectorAll('button[data-action]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var act = btn.getAttribute('data-action');
        if (act === 'recheck') { callRecheck(fbId, badge); return; }
        callPush(act, fbId, badge);
      });
    });
  }

  function showBadgeError(badge, msg) {
    var el = badge.querySelector('.v2b-result') || badge.querySelector('.v2b-meta');
    if (el) { el.style.color = '#5a0d0d'; el.textContent = msg; }
  }

  function callRecheck(fbId, badge) {
    badge.querySelectorAll('button').forEach(function(b) { b.disabled = true; });
    console.log('[VERGENT-RECHECK] requesting fbId=' + fbId);
    fetch('/api/vergent-recheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ firebase_id: fbId }),
    })
      // Read body as text first so we can see non-JSON responses
      // (HTML 404 pages from edges, etc.) instead of failing silently.
      .then(function(r) {
        return r.text().then(function(txt) {
          var parsed = null;
          try { parsed = JSON.parse(txt); } catch (e) { /* keep raw text */ }
          return { status: r.status, body: parsed, rawText: txt };
        });
      })
      .then(function(res) {
        console.log('[VERGENT-RECHECK] response', res);
        if (res.status >= 200 && res.status < 300 && res.body && res.body.vergentMatch) {
          // Bump the cache so the 2s poll doesn't re-fetch and overwrite
          // the freshly-rendered match before its TTL is up.
          window.__vergentPhase2LastFbId = fbId;
          window.__vergentPhase2LastFetch = Date.now();
          render(res.body.vergentMatch, fbId);
        } else {
          badge.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
          var rb = res.body || {};
          var detail = rb.error || rb.detail
            || (res.rawText && res.rawText.slice(0, 200))
            || ('HTTP ' + res.status);
          showBadgeError(badge, 'Re-check failed: ' + (detail + '').slice(0, 200));
        }
      })
      .catch(function(e) {
        console.error('[VERGENT-RECHECK] network error', e);
        badge.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
        showBadgeError(badge, 'Network error: ' + (e && e.message ? e.message : 'unknown'));
      });
  }

  function callPush(action, fbId, badge) {
    var resultEl = badge.querySelector('.v2b-result');
    if (resultEl) resultEl.textContent = 'Pushing...';
    badge.querySelectorAll('button').forEach(function(b) { b.disabled = true; });

    // Checkboxes were removed (operator request) -- both Statement and
    // DL are required on every push. We still read any surviving
    // input[name="kind"] for forward compatibility (in case the
    // checkboxes ever come back), but default to BOTH docs so nothing
    // ever silently ships without the DL.
    var checkedKinds = Array.from(badge.querySelectorAll('input[name="kind"]:checked'))
      .map(function(c) { return c.value; });
    var docKinds = checkedKinds.length
      ? checkedKinds
      : ['bank_statement', 'drivers_license'];

    var reqBody = { firebase_id: fbId, doc_kinds: docKinds };
    if (action === 'create-and-push') {
      reqBody.create_if_missing = true;
      // Optional free-text note for the new Vergent customer (e.g.
      // "Approved $100"). Only present in the 'not_found' state.
      var noteEl = badge.querySelector('[data-action="note-input"]');
      var note = noteEl ? noteEl.value.trim() : '';
      if (note) reqBody.note = note;
    } else if (action === 'push-pick') {
      var picked = badge.querySelector('input[name="vcand"]:checked');
      reqBody.use_vergent_customer_id = picked ? picked.value : '';
    }
    // 'push' (Existing state) needs no extra fields — doc_kinds already set.

    fetch('/api/push-to-vergent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(reqBody),
    })
      .then(function(r) { return r.json().then(function(d) { return { status: r.status, body: d }; }); })
      .then(function(res) {
        badge.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
        if (!resultEl) return;
        if (res.status >= 200 && res.status < 300 && res.body.ok) {
          var ups = res.body.uploads || {};
          var msg = 'Pushed to customer #' + (res.body.vergentCustomerId || '?');
          var parts = [];
          if (ups.drivers_license) parts.push('DL');
          if (ups.bank_statement)  parts.push('Statement');
          if (parts.length) msg += ' (' + parts.join(' + ') + ')';
          resultEl.style.color = '#1a6b3c'; resultEl.textContent = msg;
          // For create-and-push, surface per-entity backfill outcomes
          // so the operator immediately sees which child fields landed.
          var pop = res.body.populated;
          if (pop && typeof pop === 'object') {
            var existing = badge.querySelector('.v2populated');
            if (existing) existing.parentNode.removeChild(existing);
            var labels = { phone: 'Phone', address: 'Address',
                           employer: 'Employer', bank: 'Bank',
                           note: 'Note' };
            var bits = [];
            ['phone', 'address', 'employer', 'bank', 'note'].forEach(function(k) {
              var p = pop[k] || {};
              if (p.ok)                 bits.push(labels[k] + ' ✓');
              else if (p.detail && /no .* provided/i.test(p.detail))
                                        bits.push(labels[k] + ' —');
              else                      bits.push(labels[k] + ' ✗');
            });
            var sum = document.createElement('div');
            sum.className = 'v2populated';
            sum.textContent = bits.join(' · ');
            resultEl.parentNode.insertBefore(sum, resultEl.nextSibling);
          }
          // Auto-recheck after a successful Create + Push so the badge
          // flips from "+ Vergent: New" to "✓ Vergent: #N" without the
          // operator having to click Re-check. Small delay gives the
          // success message a beat to read; callRecheck swaps the badge
          // to the `found` render. Only fires on `create-and-push` so
          // we don't double-call for the simple Push docs path.
          if (action === 'create-and-push') {
            setTimeout(function() { callRecheck(fbId, badge); }, 1200);
          }
        } else {
          // Surface the actual Vergent response body first — that's what
          // tells the operator which field was rejected (e.g. "BirthDate
          // is required"). Fall back to the canonical handler-side
          // detail / error code only if Vergent didn't say anything.
          var rb = res.body || {};
          var status = rb.status ? ' [HTTP ' + rb.status + ']' : '';
          var errMsg = rb.body || rb.detail || rb.error || 'Push failed';
          // Log the full response for DevTools inspection — easier to
          // copy-paste than reading off the badge.
          console.log('[VERGENT-PUSH] error response', { status: res.status, body: rb });
          resultEl.style.color = '#5a0d0d';
          resultEl.textContent = 'Error' + status + ': ' + (errMsg + '').slice(0, 300);
        }
      })
      .catch(function(e) {
        badge.querySelectorAll('button').forEach(function(b) { b.disabled = false; });
        if (resultEl) { resultEl.style.color = '#5a0d0d'; resultEl.textContent = 'Network error: ' + e.message; }
      });
  }

  function poll() {
    // Cost control: never hit Firebase from a backgrounded tab.
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    var fbId = findCurrentFirebaseId();
    if (!fbId) return;
    var now = Date.now();
    if (window.__vergentPhase2LastFbId === fbId
        && (now - (window.__vergentPhase2LastFetch || 0)) < 30000) return;
    window.__vergentPhase2LastFbId = fbId;
    window.__vergentPhase2LastFetch = now;
    fetch('/fb/reports/' + fbId + '/vergentMatch.json', { credentials: 'same-origin' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(match) { render(match || { status: 'unknown' }, fbId); })
      .catch(function() {});
  }

  setInterval(poll, 2000);
  setTimeout(poll, 800);
})();
</script>
""").encode("utf-8")


# Messages panel removed 2026-05-30. Vergent has no working partner API
# for outbound SMS, no working read endpoint, and X-Frame-Options blocks
# embedding their UI. Per-applicant SMS work pauses until Vergent fixes
# their /api/V1/customer/{cid}/communication/messagehistory/{cell}/get
# endpoint (currently throws SolByText UriFormatException). When that
# lands, restore the panel + injector from PRs #88, #89, #90, #91.


def inject_phase2_panel(html_bytes: bytes) -> bytes:
    """Append the Phase 2 panel script + styles before </body> in the
    served app.html. Falls back to appending at the end if no </body>
    sentinel is found (defensive — modern HTML always has one)."""
    if not html_bytes:
        return html_bytes
    closing = b'</body>'
    idx = html_bytes.rfind(closing)
    if idx < 0:
        return html_bytes + _PHASE2_PANEL_HTML
    return html_bytes[:idx] + _PHASE2_PANEL_HTML + html_bytes[idx:]


# CORS: restrict to same-origin. The dashboard is a single app; there's no
# legitimate cross-origin caller. Keeping the old '*' was a CSRF vector.
CORS = {
    'Access-Control-Allow-Origin': 'https://app.cashinflash.com',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Method,X-Session',
}


SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    # Content-Security-Policy — limits where the page can pull resources
    # from. The dashboard's 315 KB app.html is full of inline scripts /
    # event handlers / styles (157 onclick=... attrs, inline <style>
    # blocks, inline style="" everywhere) so 'unsafe-inline' is required
    # for script-src and style-src. CSP still buys us:
    #   - external script blocking (only same-origin + inline)
    #   - external CSS blocking (only same-origin + inline + Google Fonts)
    #   - frame-ancestors 'none' protects against clickjacking even if a
    #     downstream proxy strips X-Frame-Options
    #   - connect-src limits where XHR/fetch can send data (same-origin
    #     only — all backend calls go through /fb/ and /api/* proxies)
    #   - object-src 'none' blocks legacy plugin attacks
    # img-src and frame-src stay broad (https:) because the dashboard
    # embeds applicant documents (DL / bank statements) served from
    # Firebase Storage with signed URLs that vary per applicant.
    'Content-Security-Policy': (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: https: blob:; "
        "connect-src 'self'; "
        "frame-src 'self' https:; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "object-src 'none'"
    ),
}


# Max JSON body size accepted on any POST. Anything above this is a
# misconfiguration or a DoS attempt — reject before reading rfile so an
# attacker can't OOM the process by claiming Content-Length: 10GB.
MAX_BODY_BYTES = 5 * 1024 * 1024   # 5 MB

# Whitelist of allowed Firebase root path prefixes for the /fb/ proxy.
# Operators only need these — write any other path and the proxy 403s.
# Closes path-traversal / arbitrary-read attack surface: an authenticated
# operator should NEVER be able to query e.g. /fb/users.json (the user
# table sits in Firebase too).
_FB_ALLOWED_PREFIXES = (
    'reports/',
    'reports.json',
    'reportsIndex/',
    'reportsIndex.json',
    'overrides/',
    'overrides.json',
    'emailLog/',
    'emailLog.json',
    'ifSubmissions/',
    'ifSubmissions.json',
    'dashboardState/',
    'dashboardState.json',
    # Vergent customer/loan -> firebase_id indexes — the servicing pages
    # download these small flat maps once and resolve customers locally
    # (zero backend lookups). Read-mostly; writes are harmless (the
    # backfill on cif-apply rebuilds them from /reports).
    'vergentCidIndex/',
    'vergentCidIndex.json',
    'vergentLoanIndex/',
    'vergentLoanIndex.json',
)


def _fb_path_is_safe(suffix: str) -> bool:
    """Return True iff `suffix` is a Firebase REST path the dashboard is
    allowed to proxy. Blocks path traversal (`..`) and anything outside
    the whitelist of operator-relevant prefixes.

    Note: Firebase REST treats `..` as a literal child name (not a
    directory traversal) but blocking it anyway is belt + suspenders
    against any future intermediary that DOES normalize URLs.
    """
    if not suffix:
        return False
    if '..' in suffix:
        return False
    if suffix.startswith('/') or '\\' in suffix:
        return False
    # Reject control chars / non-printable so headers can't be injected.
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in suffix):
        return False
    return suffix.startswith(_FB_ALLOWED_PREFIXES)


# Valid Firebase push-ID / submission-ID format. cif-apply mints these
# as `[A-Za-z0-9_-]{10,32}`-shaped tokens. Anything else is an attacker
# trying to slip a `/` or `..` into a path-interpolation.
_FB_ID_RE = re.compile(r'^[A-Za-z0-9_-]{6,64}$')


def _set_session_cookie(handler, token: str, max_age: int) -> None:
    cookie = (
        f'cif_token={token}; Path=/; Max-Age={max_age}; '
        f'HttpOnly; Secure; SameSite=Strict'
    )
    handler.send_header('Set-Cookie', cookie)


def _audit(event: str, **kwargs) -> None:
    """Single-line audit log. Never logs password values."""
    payload = ' '.join(f'{k}={v}' for k, v in kwargs.items())
    print(f'[AUDIT] {event} {payload}', flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, code, data, extra_headers=None):
        body = json.dumps(data).encode()
        self.send_response(code)
        for k, v in CORS.items():
            self.send_header(k, v)
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, code, data, extra_headers=None):
        self.send_response(code)
        for k, v in CORS.items():
            self.send_header(k, v)
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(200)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        token = get_token_from_request(self)

        if path == '/health':
            self.send_json(200, {'status': 'ok', 'sessions': len(sessions)})
            return

        if path in ('/', '/login', '/login.html'):
            data = read_file(os.path.join(DIR, 'login.html'))
            self.send_html(200, data or b'Login not found')
            return

        if path in ('/app', '/app.html', '/dashboard', '/index.html'):
            if not valid_session(token):
                self.send_response(302)
                self.send_header('Location', '/')
                self.end_headers()
                return
            data = read_file(os.path.join(DIR, 'app.html'))
            # Concept-8 renders its own inline Vergent card in the right
            # rail (#vg-card), so we do NOT inject the Phase 2 floating
            # badge here. /app/legacy still gets the full inject below.
            self.send_html(200, data or b'App not found')
            return

        # Legacy app shell — preserved at /app/legacy for any flow that the
        # Concept-8 redesign hasn't rewired yet (Plaid Customers, Connections,
        # advanced detail actions). Same auth as /app.
        if path in ('/app/legacy', '/app-legacy', '/app/legacy.html'):
            if not valid_session(token):
                self.send_response(302)
                self.send_header('Location', '/')
                self.end_headers()
                return
            data = read_file(os.path.join(DIR, 'app-legacy.html'))
            data = inject_phase2_panel(data) if data else data
            self.send_html(200, data or b'Legacy app not found')
            return

        # Static design mockups (auth-gated). Whitelisted by name; no arbitrary
        # file read. Serves <name>-mockup.html from repo root.
        if path.startswith('/mockup/'):
            if not valid_session(token):
                self.send_response(302)
                self.send_header('Location', '/')
                self.end_headers()
                return
            name = path[len('/mockup/'):].strip('/').lower()
            if name not in ('concept8', 'dashboard', 'detail'):
                self.send_response(404)
                self.end_headers()
                return
            data = read_file(os.path.join(DIR, name + '-mockup.html'))
            if not data:
                self.send_response(404)
                self.end_headers()
                return
            self.send_html(200, data)
            return

        # Public PWA/static assets (no auth — icons, manifest, service
        # worker; nothing sensitive). Exact-path map, no arbitrary file
        # reads. sw.js is no-cache so worker updates roll on deploy;
        # /apple-touch-icon.png now serves the real 180px icon instead
        # of the blurry 32px favicon.
        _pub_static = {
            '/favicon.png': ('static/favicon.png', 'image/png', 86400),
            '/favicon.ico': ('static/favicon.png', 'image/png', 86400),
            '/logo.png': ('static/logo.png', 'image/png', 86400),
            '/apple-touch-icon.png':
                ('static/icons/apple-touch-icon.png', 'image/png', 86400),
            '/apple-touch-icon-precomposed.png':
                ('static/icons/apple-touch-icon.png', 'image/png', 86400),
            '/apple-touch-icon-180x180.png':
                ('static/icons/apple-touch-icon.png', 'image/png', 86400),
            '/apple-touch-icon-180x180-precomposed.png':
                ('static/icons/apple-touch-icon.png', 'image/png', 86400),
            '/static/icons/icon-192.png':
                ('static/icons/icon-192.png', 'image/png', 86400),
            '/static/icons/icon-512.png':
                ('static/icons/icon-512.png', 'image/png', 86400),
            '/static/icons/apple-touch-icon.png':
                ('static/icons/apple-touch-icon.png', 'image/png', 86400),
            '/manifest.json':
                ('static/manifest.json', 'application/manifest+json', 3600),
            '/sw.js':
                ('static/sw.js', 'application/javascript; charset=utf-8', 0),
        }
        if path in _pub_static:
            rel, ctype, maxage = _pub_static[path]
            data = read_file(os.path.join(DIR, *rel.split('/')))
            if data:
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header(
                    'Cache-Control',
                    f'public, max-age={maxage}' if maxage else 'no-cache')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(204)
                self.end_headers()
            return

        if path == '/api/me':
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            s = sessions.get(token, {})
            self.send_json(200, {
                'user': s.get('user', ''),
                'role': s.get('role', 'user'),
                'idle_timeout_seconds': SESSION_IDLE_SECONDS,
            })
            return

        if path == '/api/users':
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            if not is_admin_session(token):
                self.send_json(403, {'error': 'Admin access required'}); return
            users = get_users(force_reload=True)
            safe_list = []
            for name, rec in sorted(users.items()):
                safe_list.append({
                    'username': name,
                    'role': rec.get('role', 'user'),
                    'source': rec.get('source', 'env'),
                    'created_at': rec.get('created_at'),
                    'created_by': rec.get('created_by'),
                    'last_login': rec.get('last_login'),
                })
            self.send_json(200, {'users': safe_list})
            return

        if path == '/api/v2-unclassified':
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            try:
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/v2-unclassified',
                    headers={'Content-Type': 'application/json'})
                with ur.urlopen(req, timeout=120) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[V2-UNCLASSIFIED ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path.startswith('/fb/'):
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            fb_path = path[4:]
            # Path-traversal guard — operators can only read the
            # dashboard-relevant prefixes. Without this, an authenticated
            # operator could read e.g. /fb/users.json (the user table
            # also lives in Firebase under USERS_FB_PATH).
            if not _fb_path_is_safe(fb_path):
                self.send_json(403, {'error': 'forbidden_fb_path'}); return
            try:
                with urllib.request.urlopen(_fb_url(fb_path), timeout=10) as r:
                    body = r.read()
                self.send_response(200)
                for k, v in CORS.items():
                    self.send_header(k, v)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                # Never leak `str(e)` here — urllib HTTPError can carry
                # the upstream URL (with the ?auth=<secret> querystring).
                self.send_json(500, {'error': 'firebase_proxy_failed'})
            return

        # ─── Instant-Funding vault — staff views ─────────────────
        # The standalone /if and /if/view/<id> HTML pages were removed
        # in favor of a native tab inside the main dashboard (app.html
        # → showView('if') + revealIFCard). Only the JSON proxies
        # below are reachable; staff navigate to /app to see the vault.

        # JSON: list of pending submissions (used by the HTML page via fetch)
        if path == '/api/if/list':
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            try:
                req = urllib.request.Request(
                    f'{IF_API_BASE}/api/if/list',
                    headers={'X-View-Secret': IF_VIEW_SECRET, 'Accept': 'application/json'},
                )
                with urllib.request.urlopen(req, timeout=10) as r:
                    body = r.read()
                self.send_response(r.getcode())
                for k, v in CORS.items(): self.send_header(k, v)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except urllib.error.HTTPError as e:
                self.send_json(e.code, {'error': f'upstream {e.code}'})
            except Exception as e:
                self.send_json(502, {'error': str(e)})
            return

        # JSON: view-once plaintext for a single submission. Hitting this
        # burns the vault record — Lambda deletes it after decrypting.
        if path.startswith('/api/if/view/'):
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            sub_id = path[len('/api/if/view/'):]
            if not sub_id:
                self.send_json(400, {'error': 'missing id'}); return
            try:
                req = urllib.request.Request(
                    f'{IF_API_BASE}/api/if/view/{sub_id}',
                    headers={'X-View-Secret': IF_VIEW_SECRET, 'Accept': 'application/json'},
                )
                with urllib.request.urlopen(req, timeout=10) as r:
                    body = r.read()
                _audit('if_view', user=sessions.get(token, {}).get('user', '?'),
                       ip=_client_ip(self), submission_id=sub_id)
                self.send_response(r.getcode())
                for k, v in CORS.items(): self.send_header(k, v)
                self.send_header('Content-Type', 'application/json')
                # Never cache — this response contains full PAN/CVV and
                # is single-use.
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except urllib.error.HTTPError as e:
                self.send_json(e.code, {'error': f'upstream {e.code}'})
            except Exception as e:
                self.send_json(502, {'error': str(e)})
            return

        # ─────────────────────────────────────────
        # Portal Bank Links — Phase U.2 admin proxy.
        # cif-portal stores Plaid items keyed by Vergent customerId
        # in DynamoDB. We surface them in the dashboard's "Portal
        # Bank Links" tab so admins can search a customer and
        # (Phase U.3) re-pull asset reports any time.
        # ─────────────────────────────────────────

        # JSON: admin customer search (proxies to cif-portal
        # /api/admin/customers/search). Single ?q=<term> param;
        # backend decides whether it's a customerId, email, or
        # last-name lookup based on the shape of q. Used by the
        # dashboard's Customers tab to find a customer to support
        # or impersonate.
        if path == '/api/portal-customers/search':
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            qs = ''
            if '?' in self.path:
                qs = '?' + self.path.split('?', 1)[1]
            code, raw = _call_portal_admin(
                'GET', f'/api/admin/customers/search{qs}',
            )
            self.send_response(code or 502)
            for k, v in CORS.items(): self.send_header(k, v)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw or b'{}')
            return

        # JSON: list of all customers who've linked a bank via the portal.
        # Optional ?search=… filter on name / email / customerId / institution.
        if path == '/api/portal-plaid/customers':
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            qs = ''
            if '?' in self.path:
                qs = '?' + self.path.split('?', 1)[1]
            code, raw = _call_portal_admin(
                'GET', f'/api/admin/plaid/customers{qs}',
            )
            self.send_response(code or 502)
            for k, v in CORS.items(): self.send_header(k, v)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw or b'{}')
            return

        # JSON: full detail for one customer (Vergent profile +
        # every Plaid Item + a fresh /accounts/get pull per Item).
        if path.startswith('/api/portal-plaid/customer/'):
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            cid = path[len('/api/portal-plaid/customer/'):]
            if not cid:
                self.send_json(400, {'error': 'missing cid'}); return
            code, raw = _call_portal_admin(
                'GET', f'/api/admin/plaid/customer/{cid}',
            )
            _audit('portal_plaid_view',
                   user=sessions.get(token, {}).get('user', '?'),
                   ip=_client_ip(self), customer_id=cid)
            self.send_response(code or 502)
            for k, v in CORS.items(): self.send_header(k, v)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw or b'{}')
            return

        # Stream a Vergent document's binary back to the browser for the
        # Documents tab's "quick view" eye icon. We forward straight to
        # cif-apply which talks to Vergent. Inline disposition so the
        # browser's PDF / image viewer renders the doc in the new tab.
        if path == '/api/vergent-doc':
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            qs = ''
            if '?' in self.path:
                qs = self.path.split('?', 1)[1]
            try:
                import urllib.request as ur
                req = ur.Request(
                    f'https://cif-apply.onrender.com/api/vergent-doc?{qs}',
                    method='GET',
                )
                with ur.urlopen(req, timeout=30) as r:
                    body = r.read()
                    upstream_ctype = r.headers.get('Content-Type') or 'application/octet-stream'
                    upstream_disp = r.headers.get('Content-Disposition') or 'inline'
                self.send_response(200)
                for k, v in CORS.items(): self.send_header(k, v)
                self.send_header('Content-Type', upstream_ctype)
                self.send_header('Content-Disposition', upstream_disp)
                self.send_header('Cache-Control', 'private, max-age=300')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except urllib.error.HTTPError as e:
                try: err_body = e.read().decode(errors='replace')
                except Exception: err_body = str(e)
                print(f'[VERGENT-DOC UPSTREAM {e.code}] {err_body[:200]}', flush=True)
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(err_body.encode() if isinstance(err_body, str) else b'{}')
            except Exception as e:
                print(f'[VERGENT-DOC ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # List a Vergent customer's cards on file for the Create Loan
        # disbursement-card dropdown. Forwards GET to cif-apply's
        # /api/vergent-list-cards (which calls Vergent V1 GetCustomerCards
        # + falls back to GetCustomerData if dedicated list 404s).
        if path == '/api/vergent-list-cards':
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            qs = ''
            if '?' in self.path:
                qs = self.path.split('?', 1)[1]
            try:
                import urllib.request as ur
                req = ur.Request(
                    f'https://cif-apply.onrender.com/api/vergent-list-cards?{qs}',
                    method='GET',
                )
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-LIST-CARDS UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-LIST-CARDS ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Phase U.3: poll a Plaid asset report. Path:
        # /api/portal-plaid/asset-report/{token}        → JSON (poll)
        # /api/portal-plaid/asset-report/{token}/pdf    → binary PDF
        if path.startswith('/api/portal-plaid/asset-report/'):
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            tail = path[len('/api/portal-plaid/asset-report/'):]
            if tail.endswith('/pdf'):
                # PDF binary path — forward Content-Type + bytes raw.
                tok = tail[:-len('/pdf')]
                if not tok:
                    self.send_json(400, {'error': 'missing token'}); return
                code, body, ctype = _call_portal_admin_pdf(
                    f'/api/admin/plaid/asset-report/{tok}/pdf',
                )
                self.send_response(code or 502)
                for k, v in CORS.items(): self.send_header(k, v)
                self.send_header('Content-Type', ctype or 'application/pdf')
                self.send_header(
                    'Content-Disposition',
                    f'attachment; filename="asset-report-{tok[:12]}.pdf"',
                )
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body or b'')
                return
            # JSON poll
            tok = tail
            if not tok:
                self.send_json(400, {'error': 'missing token'}); return
            code, raw = _call_portal_admin(
                'GET', f'/api/admin/plaid/asset-report/{tok}',
            )
            self.send_response(code or 502)
            for k, v in CORS.items(): self.send_header(k, v)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw or b'{}')
            return

        self.send_json(404, {'error': 'not found'})

    def do_POST(self):
        # Bound the body size BEFORE reading rfile — an attacker who
        # claims Content-Length: 10GB would otherwise have us happily
        # block on rfile.read() and OOM the process.
        try:
            length = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            length = 0
        if length < 0 or length > MAX_BODY_BYTES:
            self.send_json(413, {'error': 'payload_too_large'}); return
        raw = self.rfile.read(length) if length else b'{}'
        path = self.path.split('?')[0]

        if path == '/api/login':
            self._handle_login(raw)
            return

        token = get_token_from_request(self)

        if path == '/api/logout':
            user = sessions.get(token, {}).get('user', '?')
            if token in sessions:
                del sessions[token]
            _audit('logout', user=user, ip=_client_ip(self))
            resp_body = json.dumps({'ok': True}).encode()
            self.send_response(200)
            for k, v in CORS.items():
                self.send_header(k, v)
            for k, v in SECURITY_HEADERS.items():
                self.send_header(k, v)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp_body)))
            self.send_header('Set-Cookie', 'cif_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict')
            self.end_headers()
            self.wfile.write(resp_body)
            return

        if not valid_session(token):
            self.send_json(401, {'error': 'Unauthorized'}); return

        # Impersonation: mint a short-lived token at cif-portal and
        # construct a "View as customer" URL with the operator's
        # service JWT + the impersonation token in the URL fragment.
        # Fragment so the JWT/token don't get logged by any HTTP
        # intermediary; portal.js scrubs them on load.
        if path == '/api/portal-customers/impersonate':
            try:
                req_body = json.loads(raw or b'{}')
            except Exception:
                self.send_json(400, {'error': 'invalid_json'}); return
            if not isinstance(req_body, dict):
                self.send_json(400, {'error': 'invalid_body'}); return
            cognito_sub = (req_body.get('cognitoSub') or '').strip()
            customer_id = (req_body.get('customerId') or '').strip()
            if not (cognito_sub or customer_id):
                self.send_json(400, {'error': 'missing_target'}); return

            mint_body = {}
            if cognito_sub: mint_body['cognitoSub'] = cognito_sub
            if customer_id: mint_body['customerId'] = customer_id
            code, raw_resp = _call_portal_admin(
                'POST', '/api/admin/impersonate', mint_body,
            )
            if code != 200:
                # Pass the upstream error body through verbatim so
                # the operator sees why minting failed.
                try:
                    err_body = json.loads(raw_resp or b'{}')
                except Exception:
                    err_body = {'error': f'upstream_http_{code}',
                                'raw': (raw_resp or b'').decode(
                                    'utf-8', 'replace')[:300]}
                self.send_json(code or 502, err_body); return

            try:
                resp = json.loads(raw_resp or b'{}')
            except Exception:
                self.send_json(502, {'error': 'invalid_upstream_response'})
                return

            imp_token = resp.get('token') or ''
            expires_at = resp.get('expiresAt') or 0
            target = resp.get('target') or {}
            # Get the service JWT we used to mint (the portal
            # frontend uses it to satisfy the API Gateway authorizer).
            svc_tok, _err = _get_portal_admin_token()

            # Build the destination URL. Fragment params:
            #   impersonationToken — DDB token (read by portal.js)
            #   jwt                — operator's service JWT (Cognito)
            #   name, cid, email   — meta for the banner
            #   exp                — unix epoch for the countdown
            from urllib.parse import urlencode
            frag = urlencode({
                'impersonationToken': imp_token,
                'jwt': svc_tok or '',
                'name': target.get('fullName') or '',
                'cid': target.get('customerId') or '',
                'email': target.get('email') or '',
                'exp': str(expires_at),
            })
            portal_url = f'{PORTAL_FRONTEND_ORIGIN}/dashboard.html#{frag}'

            self.send_json(200, {
                'portalUrl': portal_url,
                'expiresAt': expires_at,
                'target': target,
            })
            return

        # ── §8.2 override / human-action log ─────────────────────────
        # Records what a HUMAN did, distinct from the engine verdict.
        # Body: {firebase_id, humanAction: 'funded'|'declined', amount,
        #        reason, engineVerdict, engineTier, isOverride}
        # The operator is stamped SERVER-SIDE from the session — the
        # override log grades reviewers against the engine later, so it
        # must not be client-spoofable. isOverride=true additionally
        # writes /overrides/{firebase_id}; every call patches
        # humanAction/humanActionAt on the report + mirrors the index.
        if path == '/api/override':
            try:
                body = json.loads(raw or b'{}')
            except Exception:
                self.send_json(400, {'error': 'invalid_json'}); return
            fb_id = (body.get('firebase_id') or '').strip()
            action = (body.get('humanAction') or '').strip().lower()
            if not fb_id or action not in ('funded', 'declined'):
                self.send_json(400, {'error': 'firebase_id and humanAction (funded|declined) required'})
                return
            # Format-validate fb_id before interpolating into Firebase
            # paths below (`overrides/{fb_id}.json`, `reports/{fb_id}.json`).
            # Without this guard, fb_id="a/b" would write to a nested
            # node instead of the intended top-level record.
            if not _FB_ID_RE.match(fb_id):
                self.send_json(400, {'error': 'invalid_firebase_id'})
                return
            operator = sessions.get(token, {}).get('user', 'unknown')
            now_ms = int(time.time() * 1000)
            try:
                if body.get('isOverride'):
                    override_rec = json.dumps({
                        'ts': now_ms,
                        'operator': operator,
                        'engineVerdict': body.get('engineVerdict') or '',
                        'engineTier': body.get('engineTier') or 0,
                        'humanAction': action,
                        'amount': body.get('amount') or 0,
                        'reason': (body.get('reason') or '').strip(),
                    }).encode()
                    oreq = urllib.request.Request(
                        _fb_url(f'overrides/{fb_id}.json'), data=override_rec,
                        headers={'Content-Type': 'application/json'}, method='PUT')
                    urllib.request.urlopen(oreq, timeout=10).read()
                    _audit('engine_override', user=operator, fb_id=fb_id,
                           action=action, engine=body.get('engineVerdict') or '')
                ha_patch = json.dumps({
                    'humanAction': action,
                    'humanActionAt': now_ms,
                    'humanActionBy': operator,
                    'updatedAt': now_ms,
                }).encode()
                hreq = urllib.request.Request(
                    _fb_url(f'reports/{fb_id}.json'), data=ha_patch,
                    headers={'Content-Type': 'application/json'}, method='PATCH')
                urllib.request.urlopen(hreq, timeout=10).read()
                _mirror_report_write_to_index(f'reports/{fb_id}.json', 'PATCH', ha_patch)
                self.send_json(200, {'ok': True, 'operator': operator,
                                     'override': bool(body.get('isOverride'))})
            except Exception as e:
                self.send_json(500, {'error': str(e)})
            return

        if path.startswith('/fb/'):
            fb_path = path[4:]
            # Same whitelist as the GET-side guard above.
            if not _fb_path_is_safe(fb_path):
                self.send_json(403, {'error': 'forbidden_fb_path'}); return
            # Only the methods we actually use. PUT/PATCH overwrite/merge,
            # POST appends a child, DELETE removes. Reject anything else
            # so a creative attacker can't smuggle a GET or HEAD through.
            method = self.headers.get('X-Method', 'POST').upper()
            if method not in ('POST', 'PUT', 'PATCH', 'DELETE'):
                self.send_json(405, {'error': 'method_not_allowed'}); return
            try:
                req = urllib.request.Request(_fb_url(fb_path), data=raw,
                    headers={'Content-Type': 'application/json'}, method=method)
                with urllib.request.urlopen(req, timeout=10) as r:
                    body = r.read()
                _mirror_report_write_to_index(fb_path, method, raw)
                self.send_response(200)
                for k, v in CORS.items():
                    self.send_header(k, v)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                # See GET-side note — don't leak the upstream URL.
                self.send_json(500, {'error': 'firebase_proxy_failed'})
            return

        if path == '/api/send-denial':
            try:
                import urllib.request as ur
                payload = raw
                req = ur.Request('https://cif-apply.onrender.com/api/send-denial',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = r.read()
                self.send_json(200, json.loads(result))
            except Exception as e:
                self.send_json(500, {'error': str(e)})
            return

        if path in ('/api/send-returned-payment', '/api/send-thank-you-payment', '/api/send-approval', '/api/send-card-failed', '/api/send-card-request', '/api/send-google-review', '/api/send-trustpilot-review'):
            try:
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com' + path,
                    data=raw, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = r.read()
                self.send_json(200, json.loads(result))
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[EMAIL PROXY ERROR] {path}: {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Portal-registration email with a per-customer magic link. Own
        # branch (not the tuple above) because cif-apply has to mint the
        # onboarding link first — a server-to-server round-trip to the
        # portal — before it can send, so this needs a longer timeout than
        # the plain template sends. Body: {to_email, to_name?, customer_id?,
        # force_resend?, test?}. Forwarded verbatim to cif-apply.
        if path == '/api/send-registration':
            try:
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/send-registration',
                    data=raw, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=90) as r:
                    result = r.read()
                self.send_json(200, json.loads(result))
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[REGISTRATION PROXY {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[REGISTRATION PROXY ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Portal-account status: does this Vergent customer already have a
        # portal account? Drives the "Portal Invite" button + status chip in
        # the application detail. Forwarded verbatim to cif-apply (which proxies
        # to the portal with the shared key). Body: {customer_id|customerId} or
        # {email}. Never mints or sends.
        if path == '/api/portal-status':
            try:
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/portal-status',
                    data=raw, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = r.read()
                self.send_json(200, json.loads(result))
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[PORTAL-STATUS PROXY ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/rerun-plaid':
            try:
                body = json.loads(raw)
                import urllib.request as ur
                payload = json.dumps(body).encode()
                print(f'[RERUN PROXY] Forwarding rerun request to cif-apply...', flush=True)
                req = ur.Request('https://cif-apply.onrender.com/rerun-plaid',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                try:
                    with ur.urlopen(req, timeout=60) as r:
                        resp_body = r.read()
                        print(f'[RERUN PROXY] cif-apply responded: {resp_body}', flush=True)
                except Exception as proxy_err:
                    print(f'[RERUN PROXY ERROR] {proxy_err}', flush=True)
                self.send_json(200, {'ok': True})
            except Exception as e:
                print(f'[RERUN ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # ── Marketing Campaigns — proxy all /api/marketing/* to cif-apply.
        # Operator-only (valid session). For send-campaign we stamp the
        # logged-in operator as created_by server-side so the audit trail
        # records who blasted.
        if path.startswith('/api/marketing/'):
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            try:
                import urllib.request as ur
                try:
                    body = json.loads(raw) if raw else {}
                except Exception:
                    body = {}
                if path == '/api/marketing/send-campaign':
                    s = sessions.get(token, {})
                    body['created_by'] = s.get('user', '') or body.get('created_by', '')
                payload = json.dumps(body).encode()
                req = ur.Request('https://cif-apply.onrender.com' + path,
                    data=payload, headers={'Content-Type': 'application/json'},
                    method='POST')
                with ur.urlopen(req, timeout=120) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[MARKETING PROXY ERROR] {path}: {e}', flush=True)
                self.send_json(502, {'error': str(e)})
            return

        if path == '/api/refresh-from-plaid':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[REFRESH-PLAID PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/refresh-from-plaid',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # Longer timeout — Plaid asset_report/get can take up to ~2 min
                # the first time, quick on subsequent pulls.
                with ur.urlopen(req, timeout=180) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[REFRESH-PLAID UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[REFRESH-PLAID ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Phase U.3: Portal-rerun engine pipeline. Dashboard hands off the
        # Plaid asset report it just polled (cif-portal admin endpoint) to
        # cif-apply, which converts → extracted_data, synthesizes
        # applicationData from Vergent, runs engine_v3, persists to
        # /reports/{portal_<cid>_<ts>}, returns the synthetic firebase_id.
        # Dashboard then opens that record in the standard Report modal.
        # Store a portal Plaid asset-report PDF on a Firebase report.
        # Two-hop because the PDF lives behind the portal admin service
        # (different Plaid app than cif-apply) and Firebase Storage admin
        # access is in cif-apply:
        #   1. We fetch the PDF here via _call_portal_admin_pdf.
        #   2. Forward the bytes (base64) to cif-apply's /api/store-portal-pdf
        #      which uploads to Firebase Storage + patches bankStatementUrl.
        if path == '/api/store-portal-pdf':
            try:
                body = json.loads(raw)
                fb_id = (body.get('firebase_id') or '').strip()
                token = (body.get('asset_report_token') or '').strip()
                if not fb_id or not token:
                    self.send_json(400, {'error': 'Missing firebase_id or asset_report_token'})
                    return
                code, pdf_bytes, ctype = _call_portal_admin_pdf(
                    f'/api/admin/plaid/asset-report/{token}/pdf',
                )
                if not pdf_bytes or (code and code >= 400):
                    self.send_json(502, {
                        'error': 'portal_pdf_fetch_failed',
                        'detail': f'portal returned HTTP {code}',
                    })
                    return
                import base64 as _b64
                import urllib.request as ur
                payload = json.dumps({
                    'firebase_id': fb_id,
                    'pdf_base64': _b64.b64encode(pdf_bytes).decode('ascii'),
                    'asset_report_token': token,
                }).encode()
                req = ur.Request(
                    'https://cif-apply.onrender.com/api/store-portal-pdf',
                    data=payload, headers={'Content-Type': 'application/json'},
                    method='POST',
                )
                with ur.urlopen(req, timeout=60) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except Exception as e:
                print(f'[STORE-PORTAL-PDF PROXY ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/portal-engine-v3':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[PORTAL-ENGINE-V3 PROXY] Forwarding to cif-apply '
                      f'cid={body.get("vergent_customer_id")}...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/portal-engine-v3',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # 180s — engine_v3 LLM classifier takes ~30-60s for
                # typical applicants; large transaction sets up to ~2 min.
                with ur.urlopen(req, timeout=180) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[PORTAL-ENGINE-V3 UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[PORTAL-ENGINE-V3 ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # PDF re-extraction recovery path. Counterpart to /api/refresh-from-plaid
        # for non-Plaid applicants whose original Claude extraction had errors
        # (duplicate transactions, miscounts). cif-apply runs the slow
        # extract+engine work on a daemon thread and returns 202 Accepted
        # immediately (~1-2s for the synchronous PDF download). The dashboard
        # JS then polls /fb/reports/{id}/reExtractStatus.json until the
        # background job finishes. Short proxy timeout because the upstream
        # response is fast — long Claude calls don't block this connection.
        if path == '/api/re-extract-pdf':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[RE-EXTRACT-PDF PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/re-extract-pdf',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # 15s — upstream now returns 202 immediately after PDF download.
                # If we ever wait this long it means the synchronous download
                # itself stalled, in which case the operator deserves a fast
                # error rather than a hung request.
                with ur.urlopen(req, timeout=15) as r:
                    upstream_status = r.status
                    result = json.loads(r.read().decode())
                # Preserve 202 Accepted vs 200 so the dashboard JS sees the
                # correct status and triggers the polling path.
                self.send_json(upstream_status, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[RE-EXTRACT-PDF UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[RE-EXTRACT-PDF ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/push-plaid-to-vergent':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[VERGENT-PUSH PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/push-plaid-to-vergent',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # 60s — Vergent uploads are usually fast, but leave headroom for
                # token refresh + retry on the cif-apply side.
                with ur.urlopen(req, timeout=60) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-PUSH UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-PUSH ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Phase 2: synchronous Vergent re-check. Proxies to cif-apply's
        # /api/vergent-recheck which calls run_vergent_match server-side
        # and writes the fresh result back to Firebase. Used by the
        # "Re-check now" button on the badge — the previous re-poll-only
        # behavior could never recover from a missing vergentMatch field.
        if path == '/api/vergent-recheck':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[VERGENT-RECHECK PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-recheck',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # 30s — synchronous Vergent search is usually <5s but
                # leave headroom for V1 token refresh on a cold cache.
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-RECHECK UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-RECHECK ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Live Plaid balance check ($0.10/call) for the customer modal —
        # forwards {firebase_id} to cif-apply's /api/plaid-balance. Only
        # called when the operator clicks "Check balance"; cif-apply caches
        # the reading so a re-open doesn't re-bill.
        # TIMEOUT: 90s — must OUTLAST cif-apply's 60s Plaid budget. A live
        # balance check queries the customer's actual bank; slow banks take
        # 30-45s. With a 30s proxy timeout the proxy aborted FIRST: the
        # operator saw a failure and re-clicked (double-billing $0.10) while
        # cif-apply's original call completed behind the scenes.
        if path == '/api/plaid-balance':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print('[PLAID-BALANCE PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/plaid-balance',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=90) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[PLAID-BALANCE UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[PLAID-BALANCE ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # On-demand Plaid asset-report PDF ($0.99) — forwards {firebase_id}
        # to cif-apply's /api/generate-plaid-pdf. Powers the "View asset PDF"
        # button for applicants whose submit-time PDF was deferred for cost.
        if path == '/api/generate-plaid-pdf':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print('[GEN-PLAID-PDF PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/generate-plaid-pdf',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=60) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[GEN-PLAID-PDF UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[GEN-PLAID-PDF ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Push a single free-text note to a Vergent customer. Used by the
        # Notes tab on the dashboard — every operator-posted note also
        # lands in Vergent (with the Must-Read flag so it surfaces on the
        # customer's main page, not just the Notes tab). Body:
        #   { firebase_id, text }
        # Vergent loan history — proxies to cif-apply's /api/vergent-loans.
        # Body: {firebase_id} or {customer_id}. Used by the dashboard's
        # Profile tab to render a per-customer loan list.
        if path == '/api/vergent-loans':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print('[VERGENT-LOANS PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-loans',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-LOANS UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-LOANS ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Vergent Credit/Debit Card History report — proxies to
        # cif-apply's /api/vergent-card-payments. Body:
        # {start_date, end_date, region_id?, district_id?}.
        # Used by the dashboard's Payments view.
        if path == '/api/vergent-card-payments':
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-card-payments',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # Scraping the ASPX login + report can take 5-10s on a
                # cold cif-apply; give it room to breathe.
                with ur.urlopen(req, timeout=60) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-CARD-PAYMENTS UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-CARD-PAYMENTS ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Schedule a future payment (ACH or Card) — used by the
        # Payments page detail modal's "Schedule Payment" button on
        # declined-payment rows.
        if path == '/api/vergent-schedule-payment':
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-schedule-payment',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[SCHED-PMT UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[SCHED-PMT ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Fbid lookup by Vergent customer_id — used by the Payments
        # page detail modal's "Create Loan" button. cif-apply walks
        # /reports to find the matching firebase_id; we just pass
        # through with a snappy timeout.
        if path == '/api/lookup-fbid-by-vergent-cid':
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/lookup-fbid-by-vergent-cid',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # 60s: unindexed customers fall back to a walk of the
                # multi-MB /reports tree, which regularly outlives 30s.
                with ur.urlopen(req, timeout=60) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[FBID-LOOKUP UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[FBID-LOOKUP ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Batch firebase-id resolver for the "Check due-today balances"
        # button — ONE call resolves every customer (at most one /reports
        # walk on cif-apply) instead of N sequential walks that each blew
        # the timeout. Long deadline: the single walk can take a while.
        if path == '/api/lookup-fbids-by-vergent-cids':
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/lookup-fbids-by-vergent-cids',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=120) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[FBIDS-LOOKUP UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[FBIDS-LOOKUP ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Vergent scheduled payments — proxies to cif-apply's
        # /api/vergent-scheduled-payments. Body: {hdr_id}. Used by the
        # Loans Due table to show a card icon when a scheduled card
        # payment exists for a row.
        if path == '/api/vergent-scheduled-payments':
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-scheduled-payments',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=20) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-SCHED-PMTS UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-SCHED-PMTS ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Funding Status page: list/refresh the loan funding queue and
        # remove rows. Forwards to cif-apply. 60s timeout because a
        # refresh fans out one get_customer_loans call per non-terminal
        # entry; cif-apply caps it to actually-pending loans.
        if path in ('/api/funding-queue', '/api/funding-queue-remove', '/api/funding-queue-backfill'):
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com' + path,
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=60) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[FUNDING-QUEUE UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[FUNDING-QUEUE ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/vergent-report-pastdue':
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-report-pastdue',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # Reports can pull thousands of rows; give Vergent room to respond.
                with ur.urlopen(req, timeout=60) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-REPORT-PASTDUE ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/vergent-report-upcoming':
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-report-upcoming',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # Same shape/size as past-due (~300KB for 2,744 rows); give it room.
                with ur.urlopen(req, timeout=90) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-REPORT-UPCOMING ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/vergent-contact-queue':
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-contact-queue',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # Queues can enumerate every loan model; give Vergent room.
                with ur.urlopen(req, timeout=90) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-CONTACT-QUEUE ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/vergent-appointment-create':
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-appointment-create',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-APPOINTMENT-CREATE ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path in ('/api/vergent-appointment-update', '/api/vergent-appointment-delete',
                    '/api/vergent-debug-list-appointments',
                    '/api/vergent-debug-option-classes'):
            try:
                body = json.loads(raw) if raw else {}
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request(f'https://cif-apply.onrender.com{path}',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-APPOINTMENT-{path.rsplit("-",1)[1].upper()} ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/vergent-customer-docs':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-customer-docs',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=20) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-CUSTOMER-DOCS ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # /api/vergent-doc?cid=...&docId=... is handled in do_GET because
        # it streams binary bytes (PDF / image) from Vergent through
        # cif-apply. See do_GET below.

        if path == '/api/vergent-add-note':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[VERGENT-ADD-NOTE PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-add-note',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-ADD-NOTE UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-ADD-NOTE ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Save the applicant's debit card to their Vergent customer record.
        # Mirrors the add-note proxy: forwards {firebase_id} to cif-apply,
        # which pulls the card from applicationData.debitCard and pushes
        # via Vergent's APIM /CustomerPortal/Customer/Cards endpoint.
        if path == '/api/vergent-save-card':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[VERGENT-SAVE-CARD PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-save-card',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-SAVE-CARD UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-SAVE-CARD ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Create a loan in Vergent for an approved applicant + trigger the
        # e-sign email. Chained PostCustomerLoan -> sendEsignDocs on the
        # cif-apply side. 60s timeout -- the chained call can take ~10-15s
        # if Vergent's loan-creation does any synchronous fee + amortization
        # math server-side.
        if path == '/api/vergent-create-loan':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[VERGENT-CREATE-LOAN PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-create-loan',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=60) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-CREATE-LOAN UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-CREATE-LOAN ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Save an Instant-Funding-submitted debit card to a Vergent customer
        # record. Mirrors /api/vergent-save-card but reads from
        # /ifSubmissions/{rowKey} (no nested applicationData) and requires
        # the Vergent customer_id from the caller — IF submissions are
        # standalone card data with no auto-search context.
        if path == '/api/vergent-save-card-if':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[VERGENT-SAVE-CARD-IF PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/vergent-save-card-if',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-SAVE-CARD-IF UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-SAVE-CARD-IF ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Phase 2: multi-doc Vergent push (resolve-or-create + upload). Proxies
        # to cif-apply's new /api/push-to-vergent route. Body shape:
        #   { firebase_id, use_vergent_customer_id?, create_if_missing?,
        #     doc_kinds: [...] }
        # The injected dashboard panel calls this; the legacy proxy above
        # remains for any callers still on the old contract.
        if path == '/api/push-to-vergent':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[VERGENT-PUSH-V2 PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/push-to-vergent',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                # 90s — multi-doc push (DL + statement) plus optional customer
                # creation can take longer than the single-doc path.
                with ur.urlopen(req, timeout=90) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                print(f'[VERGENT-PUSH-V2 UPSTREAM {e.code}] {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[VERGENT-PUSH-V2 ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # Phase U.3: trigger a Plaid asset report. Path:
        # /api/portal-plaid/asset-report/{itemId}
        # Posts to cif-portal's admin endpoint via the service-user proxy
        # to mint a fresh asset_report_token. The dashboard then polls
        # GET /api/portal-plaid/asset-report/{token} until ready.
        if path.startswith('/api/portal-plaid/asset-report/'):
            if not valid_session(token):
                self.send_json(401, {'error': 'Unauthorized'}); return
            item_id = path[len('/api/portal-plaid/asset-report/'):]
            if not item_id:
                self.send_json(400, {'error': 'missing itemId'}); return
            code, raw_body = _call_portal_admin(
                'POST', f'/api/admin/plaid/asset-report/{item_id}',
                body={},
            )
            _audit('portal_plaid_asset_report_trigger',
                   user=sessions.get(token, {}).get('user', '?'),
                   ip=_client_ip(self), item_id=item_id)
            self.send_response(code or 502)
            for k, v in CORS.items(): self.send_header(k, v)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw_body)))
            self.end_headers()
            self.wfile.write(raw_body or b'{}')
            return

        if path == '/api/rerun-v2':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[RERUN-V2 PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/rerun-v2',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=60) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try:
                    err_body = json.loads(e.read().decode())
                except Exception:
                    err_body = {'error': str(e)}
                print(f'[RERUN-V2 UPSTREAM HTTP ERROR] {e.code}: {err_body}', flush=True)
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[RERUN-V2 ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/analyze-engine':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[ANALYZE-ENGINE PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/analyze-engine',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=300) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except Exception as e:
                print(f'[ANALYZE-ENGINE ERROR] {e}', flush=True)
                self.send_json(500, {'error': {'message': str(e)}})
            return

        if path == '/api/v2-entities-add':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/v2-entities-add',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[V2-ENTITIES-ADD ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        if path == '/api/v2-unclassified-skip':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/v2-unclassified-skip',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=30) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except urllib.error.HTTPError as e:
                try: err_body = json.loads(e.read().decode())
                except Exception: err_body = {'error': str(e)}
                self.send_json(e.code, err_body)
            except Exception as e:
                print(f'[V2-UNCLASSIFIED-SKIP ERROR] {e}', flush=True)
                self.send_json(500, {'error': str(e)})
            return

        # ──────────────────────────────────────────────────────────────────
        # User management (admin-only except /api/password which is self-serve)
        # ──────────────────────────────────────────────────────────────────
        if path in ('/api/users/add', '/api/users/reset', '/api/users/delete', '/api/users/migrate-from-env', '/api/users/role'):
            if not is_admin_session(token):
                self.send_json(403, {'error': 'Admin access required'}); return
            session = sessions.get(token, {})
            actor = session.get('user', '?')
            try:
                body = json.loads(raw)
            except Exception:
                self.send_json(400, {'error': 'Invalid JSON'}); return
            username = (body.get('username') or '').strip().lower()

            if path == '/api/users/add':
                password = body.get('password') or ''
                role = (body.get('role') or 'user').strip()
                if role not in ('admin', 'user'):
                    self.send_json(400, {'error': 'role must be admin or user'}); return
                if not valid_username(username):
                    self.send_json(400, {'error': 'Username must be 2-32 chars: lowercase letters, digits, dot, underscore, hyphen.'}); return
                ok_pw, msg = valid_password(password)
                if not ok_pw:
                    self.send_json(400, {'error': msg}); return
                existing = get_users(force_reload=True).get(username)
                if existing and existing.get('source') == 'firebase':
                    self.send_json(409, {'error': f'User {username!r} already exists'}); return
                record = {
                    'hash': hash_password(password),
                    'role': role,
                    'created_at': int(time.time()),
                    'created_by': actor,
                }
                if existing and existing.get('source') == 'env':
                    record['migrated_from'] = 'env-var'
                if not firebase_put_user(username, record):
                    self.send_json(500, {'error': 'Failed to persist user'}); return
                invalidate_user_cache()
                _audit('user.added', name=username, role=role, by=actor, shadow_env=bool(existing))
                self.send_json(200, {'ok': True, 'username': username, 'role': role, 'shadowed_env_var': bool(existing)})
                return

            if path == '/api/users/reset':
                password = body.get('password') or ''
                ok_pw, msg = valid_password(password)
                if not ok_pw:
                    self.send_json(400, {'error': msg}); return
                users_now = get_users(force_reload=True)
                target = users_now.get(username)
                if not target:
                    self.send_json(404, {'error': f'User {username!r} not found'}); return
                if target.get('source') == 'env':
                    self.send_json(400, {'error': 'Env-var users must be rotated via Render; migrate by re-adding via Add User.'}); return
                record = {
                    'hash': hash_password(password),
                    'role': target.get('role', 'user'),
                    'created_at': target.get('created_at') or int(time.time()),
                    'created_by': target.get('created_by') or actor,
                    'last_login': target.get('last_login'),
                    'reset_at': int(time.time()),
                    'reset_by': actor,
                }
                if not firebase_put_user(username, record):
                    self.send_json(500, {'error': 'Failed to persist password'}); return
                invalidate_user_cache()
                _audit('user.reset', name=username, by=actor)
                self.send_json(200, {'ok': True, 'username': username})
                return

            if path == '/api/users/delete':
                if username == actor:
                    self.send_json(400, {'error': 'Cannot delete yourself'}); return
                users_now = get_users(force_reload=True)
                target = users_now.get(username)
                if not target:
                    self.send_json(404, {'error': f'User {username!r} not found'}); return
                if target.get('source') == 'env':
                    self.send_json(400, {'error': 'Env-var users must be removed via Render env vars.'}); return
                if not firebase_delete_user(username):
                    self.send_json(500, {'error': 'Failed to delete user'}); return
                invalidate_user_cache()
                for t, s in list(sessions.items()):
                    if s.get('user') == username:
                        del sessions[t]
                _audit('user.deleted', name=username, by=actor)
                self.send_json(200, {'ok': True, 'username': username})
                return

            if path == '/api/users/role':
                new_role = (body.get('role') or '').strip()
                if new_role not in ('admin', 'user'):
                    self.send_json(400, {'error': "role must be 'admin' or 'user'"}); return
                if username == actor:
                    self.send_json(400, {'error': 'Cannot change your own role - ask another admin.'}); return
                users_now = get_users(force_reload=True)
                target = users_now.get(username)
                if not target:
                    self.send_json(404, {'error': f'User {username!r} not found'}); return
                if target.get('source') == 'env':
                    self.send_json(400, {'error': 'Env-var users cannot change role here. Migrate to Firebase first.'}); return
                if target.get('role') == new_role:
                    self.send_json(200, {'ok': True, 'username': username, 'role': new_role, 'noop': True})
                    return
                record = {
                    'hash': target['hash'],
                    'role': new_role,
                    'created_at': target.get('created_at') or int(time.time()),
                    'created_by': target.get('created_by') or actor,
                    'last_login': target.get('last_login'),
                    'role_changed_at': int(time.time()),
                    'role_changed_by': actor,
                }
                if not firebase_put_user(username, record):
                    self.send_json(500, {'error': 'Failed to persist role'}); return
                invalidate_user_cache()
                for t, s in sessions.items():
                    if s.get('user') == username:
                        s['role'] = new_role
                _audit('user.role_changed', name=username, new_role=new_role, by=actor)
                self.send_json(200, {'ok': True, 'username': username, 'role': new_role})
                return

            if path == '/api/users/migrate-from-env':
                users_now = get_users(force_reload=True)
                target = users_now.get(username)
                if not target:
                    self.send_json(404, {'error': f'User {username!r} not found'}); return
                if target.get('source') != 'env':
                    self.send_json(400, {'error': f'User {username!r} is not an env-var user'}); return
                record = {
                    'hash': target['hash'],
                    'role': target.get('role', 'user'),
                    'created_at': int(time.time()),
                    'created_by': actor,
                    'migrated_from': 'env-var',
                }
                if not firebase_put_user(username, record):
                    self.send_json(500, {'error': 'Failed to persist user'}); return
                invalidate_user_cache()
                _audit('user.migrated', name=username, by=actor)
                self.send_json(200, {'ok': True, 'username': username})
                return

        if path == '/api/password':
            session = sessions.get(token, {})
            actor = session.get('user', '')
            if not actor:
                self.send_json(401, {'error': 'Unauthorized'}); return
            try:
                body = json.loads(raw)
            except Exception:
                self.send_json(400, {'error': 'Invalid JSON'}); return
            current = body.get('current_password') or ''
            new_pw = body.get('new_password') or ''
            ok_pw, msg = valid_password(new_pw)
            if not ok_pw:
                self.send_json(400, {'error': msg}); return
            user_record = get_users().get(actor) or {}
            stored = user_record.get('hash')
            if not stored or not verify_password(current, stored, who=actor):
                self.send_json(401, {'error': 'Current password is incorrect'}); return
            if user_record.get('source') == 'env':
                self.send_json(400, {'error': 'Env-var users must change their password via Render env vars.'}); return
            record = {
                'hash': hash_password(new_pw),
                'role': user_record.get('role', 'user'),
                'created_at': user_record.get('created_at') or int(time.time()),
                'created_by': user_record.get('created_by') or actor,
                'last_login': user_record.get('last_login'),
                'changed_at': int(time.time()),
            }
            if not firebase_put_user(actor, record):
                self.send_json(500, {'error': 'Failed to save password'}); return
            invalidate_user_cache()
            _audit('user.password_changed', name=actor)
            self.send_json(200, {'ok': True})
            return

        if path == '/api/analyze':
            try:
                body = json.loads(raw)
                payload = json.dumps({
                    'model': body.get('model', 'claude-haiku-4-5-20251001'),
                    'max_tokens': 8000,
                    'system': body.get('system', ''),
                    'messages': body.get('messages', [])
                }).encode()
                ctx = ssl.create_default_context()
                conn = http.client.HTTPSConnection('api.anthropic.com', timeout=300, context=ctx)
                conn.request('POST', '/v1/messages', body=payload, headers={
                    'Content-Type': 'application/json',
                    'x-api-key': ANTHROPIC_KEY,
                    'anthropic-version': '2023-06-01',
                })
                resp = conn.getresponse()
                result = json.loads(resp.read().decode())
                conn.close()
                self.send_json(resp.status, result)
            except Exception as e:
                self.send_json(500, {'error': {'message': str(e)}})
            return

        self.send_json(404, {'error': 'not found'})

    # ──────────────────────────────────────────────────────────────────────
    # Login
    # ──────────────────────────────────────────────────────────────────────
    def _handle_login(self, raw):
        ip = _client_ip(self)
        allowed, retry_in = check_rate_limit(ip)
        if not allowed:
            _audit('login.rate_limited', ip=ip, retry_in=retry_in)
            self.send_json(429, {
                'ok': False,
                'error': f'Too many attempts. Try again in {retry_in // 60 + 1} minutes.',
                'retry_after': retry_in,
            })
            return
        try:
            body = json.loads(raw)
            username = body.get('username', '').strip()
            password = body.get('password', '')
            user_record = get_users().get(username) or {}
            stored = user_record.get('hash')
            ok = bool(stored) and verify_password(password, stored, who=username)
            record_login_attempt(ip, ok)
            if ok:
                role = user_record.get('role', 'user')
                tok = make_session(username, ip, role=role)
                if user_record.get('source') == 'firebase':
                    try:
                        fb_rec = dict(user_record)
                        fb_rec.pop('source', None)
                        fb_rec['last_login'] = int(time.time())
                        firebase_put_user(username, fb_rec)
                    except Exception:
                        pass
                _audit('login.success', user=username, role=role, ip=ip)
                resp_body = json.dumps({'ok': True, 'user': username}).encode()
                self.send_response(200)
                for k, v in CORS.items():
                    self.send_header(k, v)
                for k, v in SECURITY_HEADERS.items():
                    self.send_header(k, v)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp_body)))
                _set_session_cookie(self, tok, SESSION_MAX_SECONDS)
                self.end_headers()
                self.wfile.write(resp_body)
            else:
                _audit('login.fail', user=username or '(blank)', ip=ip)
                self.send_json(401, {'ok': False, 'error': 'Invalid username or password'})
        except Exception as e:
            print(f'[LOGIN ERROR] {e}', flush=True)
            self.send_json(500, {'error': 'Login failed'})


# ───────────────── gzip middleware (Render bandwidth fix, 2026-07) ─────────
# Render bills OUTBOUND bandwidth and nothing here compressed anything —
# the 60s reportsIndex polls alone shipped multiple GB/day of raw JSON.
# This buffers each handler call's full response and gzips the body when
# the client asked for gzip, the status is 200, the type is textual, and
# it's >= 500 bytes. Everything else (and every client that didn't ask)
# gets byte-identical output. DISABLE_GZIP=true is the kill switch.
# NOTE: identical copy lives in cif-apply/gzip_mw.py (tested there in
# tests/test_gzip_mw.py) — keep the two in sync.

import gzip as _gzip_lib
import io as _io_lib

_GZ_MIN_BODY = 500
_GZ_TEXTUAL = (b"text/", b"application/json", b"application/javascript",
               b"application/xml", b"image/svg", b"application/x-ndjson")


def compress_http_response(raw, accept_encoding):
    """Rewrite one buffered HTTP/1.x response with a gzipped body, or
    return it untouched when compression doesn't apply. Never raises."""
    try:
        if "gzip" not in (accept_encoding or "").lower():
            return raw
        if b"\r\n\r\n" not in raw:
            return raw
        head, body = raw.split(b"\r\n\r\n", 1)
        if len(body) < _GZ_MIN_BODY:
            return raw
        lines = head.split(b"\r\n")
        status_parts = lines[0].split()
        if len(status_parts) < 2 or status_parts[1] != b"200":
            return raw
        ctype = b""
        for ln in lines[1:]:
            low = ln.lower()
            if (low.startswith(b"content-encoding:")
                    or low.startswith(b"transfer-encoding:")):
                return raw
            if low.startswith(b"content-type:"):
                ctype = low
        if not any(t in ctype for t in _GZ_TEXTUAL):
            return raw
        gz = _gzip_lib.compress(body, 6)
        if len(gz) >= len(body):
            return raw
        out = [ln for ln in lines
               if not ln.lower().startswith(b"content-length:")]
        out.append(b"Content-Length: " + str(len(gz)).encode("ascii"))
        out.append(b"Content-Encoding: gzip")
        out.append(b"Vary: Accept-Encoding")
        return b"\r\n".join(out) + b"\r\n\r\n" + gz
    except Exception:
        return raw


def wrap_handler_method(method_fn, exclude_prefixes=()):
    """Wrap a BaseHTTPRequestHandler do_* method: buffer everything it
    writes, then send the (possibly gzipped) response in one shot. A
    handler crash mid-response still flushes what was written first."""
    def wrapped(self):
        if (os.environ.get("DISABLE_GZIP") or "").strip().lower() in \
                ("1", "true", "yes", "on"):
            return method_fn(self)
        path = getattr(self, "path", "") or ""
        for p in exclude_prefixes:
            if path.startswith(p):
                return method_fn(self)
        real = self.wfile
        buf = _io_lib.BytesIO()
        self.wfile = buf
        try:
            method_fn(self)
        except Exception:
            self.wfile = real
            pending = buf.getvalue()
            if pending:
                try:
                    real.write(pending)
                    real.flush()
                except Exception:
                    pass
            raise
        self.wfile = real
        raw = buf.getvalue()
        if not raw:
            return None
        try:
            ae = (self.headers.get("Accept-Encoding", "")
                  if getattr(self, "headers", None) is not None else "")
        except Exception:
            ae = ""
        out = compress_http_response(raw, ae)
        try:
            real.write(out)
            real.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            # Client hung up mid-response — same outcome as before.
            pass
        return None
    return wrapped


Handler.do_GET = wrap_handler_method(Handler.do_GET)
Handler.do_POST = wrap_handler_method(Handler.do_POST)
print('[GZIP] response compression enabled (DISABLE_GZIP=true to turn off)',
      flush=True)


if __name__ == '__main__':
    print(f'CIF Dashboard on port {PORT}')
    print(f'Users configured: {sorted(USERS.keys())}')
    # ThreadingHTTPServer — one thread per request. cif-apply already
    # uses this; we were on the single-threaded HTTPServer, which
    # meant any slow upstream call (Vergent ASPX scrape ~5-10s,
    # /reports walk on cif-apply, anything else proxied) blocked
    # every other request — including Render's health-check probes.
    # When the probe timed out, Render flagged the instance
    # unhealthy and restarted it, producing the
    # "dial tcp ... i/o timeout" alerts the operator reported.
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
