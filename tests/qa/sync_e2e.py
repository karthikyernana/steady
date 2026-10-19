import time, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8790/'
EMAIL = f'qa{int(time.time())}@example.com'; PW = 'correct horse 9'
res = []; errs = []
def rec(name, ok, info=''): res.append((name, ok, info)); print(('PASS' if ok else 'FAIL'), name, info)
def ctx(b, vp):
    c = b.new_context(viewport=vp, has_touch=vp['width'] < 700, timezone_id='Asia/Kolkata', service_workers='block', ignore_https_errors=True)
    pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.goto(BASE); pg.wait_for_selector('.onboarding, .shell'); return c, pg
def onboard(pg, name='Karthik'):
    pg.fill('[data-testid=ob-name]', name); pg.click('form[data-ob=name] button[type=submit]'); pg.wait_for_selector('[data-testid=ob-goal-0]')
    pg.fill('[data-testid=ob-goal-0]', 'Land my first paying client'); pg.click('form[data-ob=goals] button[type=submit]'); pg.wait_for_selector('[data-testid=ob-wake]')
    pg.click('form[data-ob=rhythm] button[type=submit]'); pg.wait_for_selector('[data-ob-skip]'); pg.click('[data-ob-skip]')
    pg.wait_for_selector('[data-testid=ob-finish]'); pg.click('[data-testid=ob-finish]'); pg.wait_for_selector('#qa')
def open_signin(pg):
    pg.evaluate("location.hash='#/you'"); pg.wait_for_selector('[data-testid=sign-in]'); pg.click('[data-testid=sign-in]'); pg.wait_for_selector('[data-testid=si-email]')
with sync_playwright() as p:
    import os, urllib.parse
    px = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    if BASE.startswith('https') and px:
        u = urllib.parse.urlparse(px); b = p.chromium.launch(proxy={'server': f'http://{u.hostname}:{u.port}', 'username': urllib.parse.unquote(u.username or ''), 'password': urllib.parse.unquote(u.password or '')}, args=['--ignore-certificate-errors'])
    else: b = p.chromium.launch()
    A, a = ctx(b, {'width': 412, 'height': 900}); onboard(a)
    a.fill('#qa', 'pitch a client at 6pm'); a.wait_for_timeout(200)
    chips = a.inner_text('#qa-chips'); rec('quick-add links goal + time', '6 PM' in chips and 'Land my first' in chips, chips.replace('\n', ' | '))
    a.press('#qa', 'Enter'); a.wait_for_timeout(400)
    open_signin(a)
    a.fill('[data-testid=si-email]', 'not-an-email'); a.click('[data-testid=si-continue]'); a.wait_for_timeout(200)
    rec('rejects bad email, creates nothing', 'valid email' in a.inner_text('#si-err'))
    a.fill('[data-testid=si-email]', EMAIL); a.click('[data-testid=si-continue]'); a.wait_for_selector('[data-testid=si-new-password]')
    rec('unknown email asks to create account (no silent signup)', a.locator('[data-testid=si-create]').count() == 1)
    a.fill('[data-testid=si-new-password]', PW); a.fill('[data-testid=si-confirm]', 'different 123'); a.click('[data-testid=si-create]'); a.wait_for_timeout(300)
    rec('password mismatch caught', "don't match" in a.inner_text('#si-err'))
    a.fill('[data-testid=si-confirm]', PW); a.click('[data-testid=si-create]'); a.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    rec('account created + signed in', EMAIL in a.inner_text('[data-testid=sync-status]'))
    B, bpg = ctx(b, {'width': 1366, 'height': 768}); onboard(bpg, 'Karthik laptop')
    open_signin(bpg); bpg.fill('[data-testid=si-email]', EMAIL); bpg.click('[data-testid=si-continue]'); bpg.wait_for_selector('[data-testid=si-password]')
    bpg.fill('[data-testid=si-password]', 'wrong password'); bpg.click('[data-testid=si-login]'); bpg.wait_for_timeout(400)
    rec('wrong password refused', 'do not match' in bpg.inner_text('#si-err'))
    bpg.fill('[data-testid=si-password]', PW); bpg.click('[data-testid=si-login]'); bpg.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    bpg.evaluate("location.hash='#/today'"); bpg.wait_for_timeout(1500)
    rec('existing data synced to second device', bpg.locator('.task:has-text("Pitch a client")').count() >= 1)
    a.evaluate("location.hash='#/today'"); a.wait_for_timeout(600)
    a.fill('#qa', 'live sync probe'); a.press('#qa', 'Enter'); t0 = time.time()
    ok = False
    while time.time() - t0 < 10:
        if bpg.locator('.task:has-text("Live sync probe")').count(): ok = True; break
        bpg.wait_for_timeout(200)
    rec('live sync A→B', ok, f'{time.time()-t0:.1f}s')
    bpg.locator('.task:has-text("Live sync probe") .check').click(); t0 = time.time(); ok = False
    while time.time() - t0 < 10:
        if a.evaluate("window.__steady.all('tasks').find(t=>t.title==='Live sync probe')?.status") == 'done': ok = True; break
        a.wait_for_timeout(200)
    rec('live sync B→A (complete)', ok, f'{time.time()-t0:.1f}s')
    chip = a.inner_text('#top-sync') if a.locator('#top-sync').count() else ''
    rec('status shows Live', 'Live' in chip or 'Synced' in chip, chip)
    for r in ['goals', 'thoughts', 'insights', 'you', 'today', 'insights', 'today']:
        a.click(f'.tabbar [data-route={r}]'); a.wait_for_timeout(450)
    rec('tab switching ok', a.locator('.v-today').count() == 1)
    # clean up: delete the QA account from the server
    a.evaluate("location.hash='#/you'"); a.wait_for_timeout(600); a.click('[data-act=acct-delete]'); a.wait_for_selector('#da')
    a.fill('#da input[name=password]', PW); a.click('#da button[type=submit]'); a.wait_for_timeout(1500)
    rec('account deleted', a.locator('[data-testid=sign-in]').count() == 1)
    rec('no console errors', not errs, '; '.join(errs[:5]))
    b.close()
print('SUMMARY', sum(1 for r in res if r[1]), '/', len(res))
