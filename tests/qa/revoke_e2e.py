"""Removing a device from another device erases that device's local copy (v1.4.2).
Two browsers on one account: B has data; A signs B out via the API (same as You > Devices);
B's next contact with the server wipes its local data, shows the signed-out notice, and the task is gone.
Run against the local stack: BASE=http://localhost:8790 python3 tests/qa/revoke_e2e.py"""
import os, sys, time, json
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
EMAIL = f"qa{int(time.time())}@example.com"; PW = 'correct horse 9'
ok = 0
def check(c, m):
    global ok
    if not c: print('FAIL', m); sys.exit(1)
    ok += 1; print('ok ', m)
js = lambda path, body=None, method='POST': f"""async () => {{ const r = await fetch('/api/{path}', {{ method: '{method}', credentials: 'same-origin', headers: {{ 'content-type': 'application/json', 'x-steady': '1' }}, body: {json.dumps(json.dumps(body)) if body is not None else 'undefined'} }}); return {{ s: r.status, b: await r.json().catch(() => null) }}; }}"""
with sync_playwright() as p:
    import urllib.parse
    px = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    if BASE.startswith('https') and px:
        u = urllib.parse.urlparse(px); br = p.chromium.launch(proxy={'server': f'http://{u.hostname}:{u.port}', 'username': urllib.parse.unquote(u.username or ''), 'password': urllib.parse.unquote(u.password or '')}, args=['--ignore-certificate-errors'])
    else: br = p.chromium.launch()
    A = br.new_context(viewport={'width': 412, 'height': 900}).new_page(); B = br.new_context(viewport={'width': 412, 'height': 900}).new_page()
    A.goto(BASE + '/'); B.goto(BASE + '/')
    check(A.evaluate(js('auth/signup', {'email': EMAIL, 'password': PW, 'name': 'QA'}))['s'] == 200, 'A signs up')
    now = int(time.time() * 1000)
    rec = {'coll': 'tasks', 'id': 'rv1', 'updatedAt': now, 'schemaVersion': 2, 'data': {'id': 'rv1', 'title': 'Revoke canary task', 'status': 'open', 'priority': 2, 'dueDate': time.strftime('%Y-%m-%d'), 'updatedAt': now, 'createdAt': now}}
    check(A.evaluate(js('sync/push', {'records': [rec]}))['s'] == 200, 'A pushes a task')
    B.evaluate("async ([e, p]) => { const m = await import('/js/data/sync.js'); await m.logIn(e, p); }", [EMAIL, PW])
    B.wait_for_timeout(2000)
    check(B.evaluate("async () => !!(await import('/js/data/store.js')).S.tasks?.get('rv1')"), 'B holds the synced task locally')
    sess = A.evaluate(js('auth/sessions', None, 'GET'))['b']['sessions']
    other = [s for s in sess if not s['current']]
    check(len(other) == 1, 'A sees B in Devices')
    check(A.evaluate(js('auth/sessions/revoke', {'id': other[0]['id']}))['b']['revoked'] == 1, 'A removes B')
    B.reload(); B.wait_for_timeout(5000)
    check(not B.evaluate("async () => !!(await import('/js/data/store.js')).S.tasks?.get('rv1')"), "B's local copy is erased")
    check('signed out from another device' in B.content(), 'B explains what happened')
    acct = B.evaluate("async () => (await import('/js/data/store.js')).local('account')")
    check(not acct, 'B is signed out')
    check(A.evaluate(js('auth/me', None, 'GET'))['b']['signedIn'], 'A still signed in')
    A.evaluate(js('auth/delete', {'password': PW}))
    br.close()
print(f'{ok}/{ok} passed')
