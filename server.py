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
            data = read_file(os.path.join(DIR, 'app.html'))
            self.send_html(200, data or b'App not found')
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
