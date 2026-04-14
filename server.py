#!/usr/bin/env python3
"""Cash in Flash — Underwriting Dashboard Web Server"""
import json, os, ssl, time, http.client, urllib.request, urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get('PORT', 8080))
FB_BASE = 'https://cashinflash-a1dce-default-rtdb.firebaseio.com'
ANTHROPIC_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'cashinflash2024')

DIR = os.path.dirname(os.path.abspath(__file__))

# Sessions stored in memory
sessions = {}

def make_session(username):
    token = f"{username}_{int(time.time())}_{os.urandom(8).hex()}"
    sessions[token] = {'user': username, 'created': time.time()}
    return token

def valid_session(token):
    if not token or token not in sessions:
        return False
    s = sessions[token]
    if time.time() - s['created'] > 43200:
        del sessions[token]
        return False
    return True

def get_token_from_request(handler):
    """Extract token from cookie, header, or query string."""
    # From cookie
    for c in handler.headers.get('Cookie','').split(';'):
        c = c.strip()
        if c.startswith('cif_token='):
            return c[len('cif_token='):]
    # From header
    t = handler.headers.get('X-Session','')
    if t: return t
    # From query string
    if '?' in handler.path:
        qs = handler.path.split('?',1)[1]
        for part in qs.split('&'):
            if part.startswith('token='):
                return part[6:]
    return ''

def load_users():
    users = {'admin': ADMIN_PASSWORD}
    for i in range(1, 10):
        u = os.environ.get(f'USER_{i}', '')
        if u and ':' in u:
            name, pwd = u.split(':', 1)
            users[name.strip()] = pwd.strip()
    return users

USERS = load_users()

def read_file(path):
    try:
        with open(path, 'rb') as f: return f.read()
    except: return None

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Method,X-Session',
}

# Whitelist of static files that can be served from repo root
STATIC_FILES = {
    'styles-1.css': 'text/css',
    'styles-2.css': 'text/css',
    'script-1-auth.js': 'application/javascript',
    'script-2-ui.js': 'application/javascript',
    'script-3-ocr.js': 'application/javascript',
    'script-4a-dash.js': 'application/javascript',
    'script-4b-dash.js': 'application/javascript',
    'script-5-misc.js': 'application/javascript',
}

# Parts of app.html that are concatenated at request time
APP_PARTS = ['app-1.html', 'app-2.html', 'app-3.html', 'app-4.html', 'app-5.html']

def read_app_html():
    """Concatenate all app-N.html parts into a single HTML response."""
    parts = []
    for name in APP_PARTS:
        data = read_file(os.path.join(DIR, name))
        if data is None:
            return None
        parts.append(data)
    return b''.join(parts)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        for k,v in CORS.items(): self.send_header(k,v)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, code, data, extra_headers=None):
        self.send_response(code)
        for k,v in CORS.items(): self.send_header(k,v)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        if extra_headers:
            for k,v in extra_headers.items(): self.send_header(k,v)
        self.end_headers()
        self.wfile.write(data)

    def send_static(self, code, data, content_type):
        self.send_response(code)
        for k,v in CORS.items(): self.send_header(k,v)
        self.send_header('Content-Type', content_type + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(200)
        for k,v in CORS.items(): self.send_header(k,v)
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        token = get_token_from_request(self)

        if path == '/health':
            self.send_json(200, {'status':'ok','sessions':len(sessions)})
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
            data = read_app_html()
            self.send_html(200, data or b'App not found')
            return

        # Serve whitelisted static files (CSS, JS) — requires valid session
        stripped_path = path.lstrip('/')
        if stripped_path in STATIC_FILES:
            if not valid_session(token):
                self.send_response(302)
                self.send_header('Location', '/')
                self.end_headers()
                return
            data = read_file(os.path.join(DIR, stripped_path))
            if data is None:
                self.send_json(404, {'error':'not found'})
                return
            self.send_static(200, data, STATIC_FILES[stripped_path])
            return

        if path.startswith('/fb/'):
            if not valid_session(token):
                self.send_json(401, {'error':'Unauthorized'}); return
            fb_path = path[4:]
            try:
                with urllib.request.urlopen(f'{FB_BASE}/{fb_path}', timeout=10) as r:
                    body = r.read()
                self.send_response(200)
                for k,v in CORS.items(): self.send_header(k,v)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_json(500, {'error': str(e)})
            return

        self.send_json(404, {'error':'not found'})

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length) if length else b'{}'
        path = self.path.split('?')[0]
        token = get_token_from_request(self)

        if path == '/api/login':
            try:
                body = json.loads(raw)
                username = body.get('username','').strip()
                password = body.get('password','').strip()
                if USERS.get(username) == password:
                    tok = make_session(username)
                    resp_body = json.dumps({'ok':True,'token':tok,'user':username}).encode()
                    self.send_response(200)
                    for k,v in CORS.items(): self.send_header(k,v)
                    self.send_header('Content-Type','application/json')
                    self.send_header('Content-Length', str(len(resp_body)))
                    self.send_header('Set-Cookie', f'cif_token={tok}; Path=/; SameSite=Lax; Max-Age=43200')
                    self.end_headers()
                    self.wfile.write(resp_body)
                else:
                    self.send_json(401, {'ok':False,'error':'Invalid username or password'})
            except Exception as e:
                self.send_json(500, {'error':str(e)})
            return

        if path == '/api/logout':
            if token in sessions: del sessions[token]
            resp_body = json.dumps({'ok':True}).encode()
            self.send_response(200)
            for k,v in CORS.items(): self.send_header(k,v)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length', str(len(resp_body)))
            self.send_header('Set-Cookie','cif_token=; Path=/; Max-Age=0')
            self.end_headers()
            self.wfile.write(resp_body)
            return

        if not valid_session(token):
            self.send_json(401, {'error':'Unauthorized'}); return

        if path.startswith('/fb/'):
            fb_path = path[4:]
            method = self.headers.get('X-Method','POST')
            try:
                req = urllib.request.Request(f'{FB_BASE}/{fb_path}', data=raw,
                    headers={'Content-Type':'application/json'}, method=method)
                with urllib.request.urlopen(req, timeout=10) as r:
                    body = r.read()
                self.send_response(200)
                for k,v in CORS.items(): self.send_header(k,v)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                self.send_json(500, {'error':str(e)})
            return

        if path == '/api/send-denial':
            try:
                import urllib.request as ur
                payload = raw
                req = ur.Request('https://cif-apply.onrender.com/api/send-denial',
                    data=payload, headers={'Content-Type':'application/json'}, method='POST')
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
                    data=payload, headers={'Content-Type':'application/json'}, method='POST')
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
                    data=payload, headers={'Content-Type':'application/json'}, method='POST')
                with ur.urlopen(req, timeout=120) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except Exception as e:
                print(f'[RERUN-ENGINE ERROR] {e}', flush=True)
                self.send_json(500, {'error':{'message':str(e)}})
            return

        if path == '/api/analyze-engine':
            try:
                body = json.loads(raw)
                payload = json.dumps(body).encode()
                print(f'[ANALYZE-ENGINE PROXY] Forwarding to cif-apply...', flush=True)
                import urllib.request as ur
                req = ur.Request('https://cif-apply.onrender.com/api/analyze-engine',
                    data=payload, headers={'Content-Type':'application/json'}, method='POST')
                with ur.urlopen(req, timeout=300) as r:
                    result = json.loads(r.read().decode())
                self.send_json(200, result)
            except Exception as e:
                print(f'[ANALYZE-ENGINE ERROR] {e}', flush=True)
                self.send_json(500, {'error':{'message':str(e)}})
            return

        if path == '/api/analyze':
            try:
                body = json.loads(raw)
                payload = json.dumps({
                    'model': body.get('model','claude-haiku-4-5-20251001'),
                    'max_tokens': 8000,
                    'system': body.get('system',''),
                    'messages': body.get('messages',[])
                }).encode()
                ctx = ssl.create_default_context()
                conn = http.client.HTTPSConnection('api.anthropic.com', timeout=300, context=ctx)
                conn.request('POST','/v1/messages', body=payload, headers={
                    'Content-Type':'application/json',
                    'x-api-key': ANTHROPIC_KEY,
                    'anthropic-version':'2023-06-01',
                    'Content-Length': str(len(payload))
                })
                resp = conn.getresponse()
                result = json.loads(resp.read().decode())
                conn.close()
                self.send_json(resp.status, result)
            except Exception as e:
                self.send_json(500, {'error':{'message':str(e)}})
            return

        self.send_json(404, {'error':'not found'})

if __name__ == '__main__':
    print(f'CIF Dashboard on port {PORT}')
    print(f'Users: {list(USERS.keys())}')
    HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
