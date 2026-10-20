"""Live-sync loop robustness (Playwright). Usage: python3 tests/qa/sync_live_e2e.py [BASE=http://localhost:8790/]
1. a pull that keeps failing after the long-poll says "changed" backs off (no hot loop of /sync/wait + /sync/pull)
2. a quick hide/show never leaves two long-polls running side by side"""
import sys, time
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
with sync_playwright() as p:
    b = p.chromium.launch()
    A, a = ctx(b, {'width': 412, 'height': 900}); onboard(a)
    open_signin(a); a.fill('[data-testid=si-email]', EMAIL); a.click('[data-testid=si-continue]'); a.wait_for_selector('[data-testid=si-new-password]')
    a.fill('[data-testid=si-new-password]', PW); a.fill('[data-testid=si-confirm]', PW); a.click('[data-testid=si-create]'); a.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    a.wait_for_timeout(1500)
    # 2. hide/show quickly a few times, then count long-polls in flight
    inflight = {'n': 0, 'max': 0}
    def onreq(r):
        if '/api/sync/wait' in r.url: inflight['n'] += 1; inflight['max'] = max(inflight['max'], inflight['n'])
    def ondone(r):
        if '/api/sync/wait' in r.url: inflight['n'] -= 1
    a.on('request', onreq); a.on('requestfinished', ondone); a.on('requestfailed', ondone)
    a.wait_for_timeout(500); inflight['max'] = inflight['n']
    for _ in range(4):
        a.evaluate("""() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }""")
        a.wait_for_timeout(300)
    a.wait_for_timeout(2500)
    rec('one long-poll after quick hide/show', inflight['max'] <= 1 and inflight['n'] <= 1, f"max in flight {inflight['max']}, now {inflight['n']}")
    # 1. another device writes (cursor behind) while every pull fails
    B, bpg = ctx(b, {'width': 1366, 'height': 768}); onboard(bpg, 'Laptop')
    open_signin(bpg); bpg.fill('[data-testid=si-email]', EMAIL); bpg.click('[data-testid=si-continue]'); bpg.wait_for_selector('[data-testid=si-password]')
    bpg.fill('[data-testid=si-password]', PW); bpg.click('[data-testid=si-login]'); bpg.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    n = {'wait': 0, 'pull': 0}
    a.route('**/api/sync/pull*', lambda r: (n.__setitem__('pull', n['pull'] + 1), r.fulfill(status=500, body='{"error":"down"}', content_type='application/json')))
    a.on('request', lambda r: n.__setitem__('wait', n['wait'] + 1) if '/api/sync/wait' in r.url else None)
    bpg.evaluate("location.hash='#/today'"); bpg.fill('#qa', 'from the laptop'); bpg.press('#qa', 'Enter'); bpg.wait_for_timeout(1200)
    a.wait_for_timeout(8000)
    rec('failing pull backs off (no hot loop)', n['pull'] <= 6 and n['wait'] <= 6, f"{n['pull']} pulls, {n['wait']} waits in 8 s")
    a.unroute('**/api/sync/pull*')
    a.wait_for_timeout(9000)
    got = a.evaluate("window.__steady.all('tasks').some(t => t.title === 'From the laptop')")
    rec('recovers once the server is back', got)
    a.evaluate("location.hash='#/you'"); a.wait_for_timeout(300)
    try:
        a.evaluate("fetch('/api/auth/delete',{method:'POST',headers:{'Content-Type':'application/json','X-Steady':'1'},body:JSON.stringify({password:%r})})" % PW)
    except Exception: pass
    print('errors:', [e for e in errs if 'Server error 500' not in e and 'down' not in e][:5])
    print('SUMMARY', sum(1 for r in res if r[1]), '/', len(res))
