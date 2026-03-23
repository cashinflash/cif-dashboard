#!/usr/bin/env python3
"""
Cash in Flash — Underwriting Dashboard Web Server
Serves the dashboard app and proxies Firebase + Claude API calls.
"""
import json, os, ssl, time, http.client, urllib.request, urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

PORT = int(os.environ.get('PORT', 8080))
FB_BASE = 'https://cashinflash-a1dce-default-rtdb.firebaseio.com'
ANTHROPIC_KEY = os.environ.get('ANTHROPIC_API_KEY', '')

# ── USERS (set via env vars: USER_1=name:password, USER_2=name:password, etc.) ──
def load_users():
    users = {}
    for i in range(1, 10):
        u = os.environ.get(f'USER_{i}', '')
        if u and ':' in u:
            name, pwd = u.split(':', 1)
            users[name.strip()] = pwd.strip()
    # Defaults if no env vars set
    if not users:
        users = {
            'admin': os.environ.get('ADMIN_PASSWORD', 'cashinflash2024'),
        }
    return users

USERS = load_users()

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Method,X-Session',
}

# Simple in-memory sessions
sessions = {}

def make_session(username):
    token = f"{username}_{int(time.time())}_{os.urandom(8).hex()}"
    sessions[token] = {'user': username, 'created': time.time()}
    return token

def valid_session(token):
    if not token: return False
    s = sessions.get(token)
    if not s: return False
    # Sessions expire after 12 hours
    if time.time() - s['created'] > 43200:
        del sessions[token]
        return False
    return True

def read_file(path):
    try:
        with open(path, 'rb') as f: return f.read()
    except: return None

DIR = os.path.dirname(os.path.abspath(__file__))

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

    def send_bytes(self, code, data, ctype='text/html; charset=utf-8'):
        self.send_response(code)
        for k,v in CORS.items(): self.send_header(k,v)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def get_session(self):
        return self.headers.get('X-Session','') or ''

    def do_OPTIONS(self):
        self.send_response(200)
        for k,v in CORS.items(): self.send_header(k,v)
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]

        # Health check
        if path == '/health':
            self.send_json(200, {'status':'ok'})
            return

        # Login page — always public
        if path in ('/', '/login', '/login.html'):
            data = read_file(os.path.join(DIR, 'login.html'))
            if data: self.send_bytes(200, data)
            else: self.send_bytes(404, b'Not found')
            return

        # App — requires session
        if path in ('/app', '/app.html', '/dashboard'):
            if not valid_session(self.get_session()):
                # Redirect to login
                self.send_response(302)
                self.send_header('Location', '/')
                self.end_headers()
                return
            data = read_file(os.path.join(DIR, 'app.html'))
            if data: self.send_bytes(200, data)
            else: self.send_bytes(404, b'Not found')
            return

        # Firebase proxy — requires session
        if path.startswith('/fb/'):
            if not valid_session(self.get_session()):
                self.send_json(401, {'error':'Unauthorized'}); return
            fb_path = path[4:]
            try:
                url = f'{FB_BASE}/{fb_path}'
                with urllib.request.urlopen(url, timeout=10) as r:
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

        # Settings
        if path == '/api/settings':
            if not valid_session(self.get_session()):
                self.send_json(401, {'error':'Unauthorized'}); return
            try:
                with urllib.request.urlopen(f'{FB_BASE}/settings.json', timeout=10) as r:
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

        # LOGIN
        if path == '/api/login':
            try:
                body = json.loads(raw)
                username = body.get('username','').strip()
                password = body.get('password','').strip()
                if USERS.get(username) == password:
                    token = make_session(username)
                    self.send_json(200, {'ok': True, 'token': token, 'user': username})
                else:
                    self.send_json(401, {'ok': False, 'error': 'Invalid username or password'})
            except Exception as e:
                self.send_json(500, {'error': str(e)})
            return

        # LOGOUT
        if path == '/api/logout':
            token = self.get_session()
            if token in sessions: del sessions[token]
            self.send_json(200, {'ok': True})
            return

        # All other endpoints require session
        if not valid_session(self.get_session()):
            self.send_json(401, {'error':'Unauthorized'}); return

        # Firebase proxy POST/PATCH/DELETE
        if path.startswith('/fb/'):
            fb_path = path[4:]
            method = self.headers.get('X-Method', 'POST')
            try:
                url = f'{FB_BASE}/{fb_path}'
                req = urllib.request.Request(url, data=raw,
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
                self.send_json(500, {'error': str(e)})
            return

        # Claude API proxy
        if path == '/api/analyze':
            try:
                body = json.loads(raw)
                key = ANTHROPIC_KEY
                if not key:
                    self.send_json(401, {'error':{'message':'No API key configured'}}); return
                payload = json.dumps({
                    'model': body.get('model','claude-haiku-4-5-20251001'),
                    'max_tokens': 8000,
                    'system': body.get('system',''),
                    'messages': body.get('messages',[])
                }).encode()
                ctx = ssl.create_default_context()
                conn = http.client.HTTPSConnection('api.anthropic.com', timeout=300, context=ctx)
                conn.request('POST', '/v1/messages', body=payload, headers={
                    'Content-Type':'application/json',
                    'x-api-key': key,
                    'anthropic-version':'2023-06-01',
                    'Content-Length': str(len(payload))
                })
                resp = conn.getresponse()
                result = json.loads(resp.read().decode())
                conn.close()
                self.send_json(resp.status, result)
            except Exception as e:
                self.send_json(500, {'error':{'message': str(e)}})
            return

        # Save settings
        if path == '/api/settings':
            try:
                settings = json.loads(raw)
                payload = json.dumps(settings).encode()
                req = urllib.request.Request(f'{FB_BASE}/settings.json',
                    data=payload, headers={'Content-Type':'application/json'}, method='PATCH')
                urllib.request.urlopen(req, timeout=10)
                self.send_json(200, {'ok': True})
            except Exception as e:
                self.send_json(500, {'error': str(e)})
            return

        self.send_json(404, {'error':'not found'})

if __name__ == '__main__':
    print(f'Cash in Flash Dashboard starting on port {PORT}')
    print(f'Users configured: {list(USERS.keys())}')
    server = HTTPServer(('0.0.0.0', PORT), Handler)
    server.serve_forever()
