#!/usr/bin/env python3
"""Cash in Flash — Underwriting Dashboard Web Server"""
import collections, hashlib, hmac, http.client, json, os, secrets, ssl, time, urllib.error, urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get('PORT', 8080))
FB_BASE = 'https://cashinflash-a1dce-default-rtdb.firebaseio.com'
ANTHROPIC_KEY = os.environ.get('ANTHROPIC_API_KEY', '')

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


def make_session(username: str, ip: str) -> str:
    # 256 bits of entropy — no guessable content (no username, no timestamp).
    token = secrets.token_urlsafe(32)
    now = time.time()
    sessions[token] = {'user': username, 'created': now, 'last_active': now, 'ip': ip}
    return token


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
    """Extract session token from the HttpOnly cookie first (canonical).

    Falls back to the X-Session header and ?token= query param for
    backward compat with older clients. CSRF is blocked by the cookie's
    SameSite=Strict flag — cross-origin requests never send the cookie.
    """
    for c in handler.headers.get('Cookie', '').split(';'):
        c = c.strip()
        if c.startswith('cif_token='):
            return c[len('cif_token='):]
    t = handler.headers.get('X-Session', '').strip()
    if t:
        return t
    if '?' in handler.path:
        qs = handler.path.split('?', 1)[1]
        for part in qs.split('&'):
            if part.startswith('token='):
                return part[6:]
    return ''


def load_users() -> dict:
    users = {}
    if ADMIN_PASSWORD:
        users['admin'] = ADMIN_PASSWORD
    else:
        print('[AUTH WARN] ADMIN_PASSWORD not set — admin account is disabled.', flush=True)
    for i in range(1, 10):
        u = os.environ.get(f'USER_{i}', '')
        if u and ':' in u:
            name, pwd = u.split(':', 1)
            users[name.strip()] = pwd.strip()
    return users


USERS = load_users()


def read_file(path):
    try:
        with open(path, 'rb') as f:
            return f.read()
    except Exception:
        return None


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
}


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
            self.send_html(200, data or b'App not found')
            return

        if path in ('/favicon.png', '/favicon.ico', '/apple-touch-icon.png', '/logo.png'):
            fname = 'logo.png' if path == '/logo.png' else 'favicon.png'
            data = read_file(os.path.join(DIR, 'static', fname))
            if data:
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Cache-Control', 'public, max-age=86400')
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
            self.send_json(200, {'user': s.get('user', ''), 'idle_timeout_seconds': SESSION_IDLE_SECONDS})
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
            try:
                with urllib.request.urlopen(f'{FB_BASE}/{fb_path}', timeout=10) as r:
                    body = r.read()
                self.send_response(200)
                for k, v in CORS.items():
                    self.send_header(k, v)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_json(500, {'error': str(e)})
            return

        self.send_json(404, {'error': 'not found'})

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
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

        if path.startswith('/fb/'):
            fb_path = path[4:]
            method = self.headers.get('X-Method', 'POST')
            try:
                req = urllib.request.Request(f'{FB_BASE}/{fb_path}', data=raw,
                    headers={'Content-Type': 'application/json'}, method=method)
                with urllib.request.urlopen(req, timeout=10) as r:
                    body = r.read()
                self.send_response(200)
                for k, v in CORS.items():
                    self.send_header(k, v)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_json(500, {'error': str(e)})
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

        if path == '/api/rerun-engine':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[RERUN-ENGINE PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/rerun-engine',
                    data=payload, headers={'Content-Type': 'application/json'}, method='POST')
                with ur.urlopen(req, timeout=120) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except Exception as e:
                print(f'[RERUN-ENGINE ERROR] {e}', flush=True)
                self.send_json(500, {'error': {'message': str(e)}})
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
            password = body.get('password', '')  # no .strip() — allow trailing space if real
            stored = USERS.get(username)
            ok = bool(stored) and verify_password(password, stored, who=username)
            record_login_attempt(ip, ok)
            if ok:
                tok = make_session(username, ip)
                _audit('login.success', user=username, ip=ip)
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


if __name__ == '__main__':
    print(f'CIF Dashboard on port {PORT}')
    print(f'Users configured: {sorted(USERS.keys())}')
    HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
