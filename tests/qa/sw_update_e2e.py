"""Service-worker update reload never drops what the user is typing (Playwright).
Usage: python3 tests/qa/sw_update_e2e.py [BASE=http://localhost:8790/]"""
import os
exec(open(os.path.join(os.path.dirname(__file__), 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])   # BASE, rec, onboard
with sync_playwright() as p:
    b = p.chromium.launch(); c = b.new_context(viewport={'width': 412, 'height': 900}, timezone_id='Asia/Kolkata')
    pg = c.new_page(); pg.goto(BASE); pg.wait_for_selector('.onboarding, .shell'); onboard(pg)
    pg.wait_for_function('navigator.serviceWorker.controller', timeout=15000)
    pg.reload(); pg.wait_for_selector('#qa'); pg.wait_for_function('navigator.serviceWorker.controller')
    hide = """h => { Object.defineProperty(document, 'hidden', { value: h, configurable: true }); Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }"""
    # idle page: an update reloads right away
    pg.evaluate("window.__marker = 1; navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))"); pg.wait_for_timeout(1500)
    rec('idle page reloads on update', pg.evaluate('!window.__marker'))
    pg.wait_for_selector('#qa')
    # typing: no reload until the app goes to the background
    pg.fill('#qa', 'half-typed task'); pg.evaluate("window.__marker = 1; navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))"); pg.wait_for_timeout(1500)
    rec('typing is kept (no reload while busy)', pg.evaluate('window.__marker === 1') and pg.input_value('#qa') == 'half-typed task')
    pg.evaluate(hide, True); pg.wait_for_timeout(1500)
    rec('reloads once the app is in the background', pg.evaluate('!window.__marker'))
    print('SUMMARY', sum(1 for r in res if r[1]), '/', len(res))
