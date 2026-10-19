# Preview screenshots for v1.3: Money tab, voice sheet (listening), draft cards, and the result — phone 390 px and
# Windows 1366 px, light and dark. Same local stack as agent_e2e.py. Output: qa-shots/money/ (or argv[2]).
import os, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.normpath(os.path.join(HERE, '..', '..', 'qa-shots', 'money'))
os.makedirs(OUT, exist_ok=True)
WAV = os.path.normpath(os.path.join(HERE, '..', 'fixtures', 'voice-te-mixed.wav'))
VPS = {'mobile390': ({'width': 390, 'height': 844}, 3, True), 'desktop1366': ({'width': 1366, 'height': 768}, 1, False)}
AUD = open(os.path.join(HERE, 'audit.js')).read()
issues = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-audio-capture={WAV}'])
    for name, (vp, dsf, mobile) in VPS.items():
        for scheme in ['light', 'dark']:
            c = b.new_context(viewport=vp, device_scale_factor=dsf, has_touch=mobile, color_scheme=scheme, timezone_id='Asia/Kolkata', service_workers='block', permissions=['microphone'])
            pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(BASE); pg.wait_for_selector('.onboarding'); onboard(pg)
            pg.evaluate("import('./js/data/demo.js').then(m=>m.seed(30))"); pg.wait_for_timeout(700)
            email = f'shots{int(time.time()*1000)}@example.com'
            open_signin(pg); pg.fill('[data-testid=si-email]', email); pg.click('[data-testid=si-continue]'); pg.wait_for_selector('[data-testid=si-new-password]')
            pg.fill('[data-testid=si-new-password]', PW); pg.fill('[data-testid=si-confirm]', PW); pg.click('[data-testid=si-create]'); pg.wait_for_selector('[data-testid=sync-status]', timeout=15000)
            pg.reload(); pg.wait_for_selector('#mic-fab'); pg.wait_for_timeout(500)
            pg.evaluate("location.hash='#/money'"); pg.wait_for_timeout(900)
            k = f'{name}-{scheme}'
            issues[f'{k}-money'] = pg.evaluate(AUD)
            pg.screenshot(path=f'{OUT}/{k}-1-money-tab.png')
            if not mobile: pg.screenshot(path=f'{OUT}/{k}-1b-money-tab-full.png', full_page=True)
            pg.click('#mic-fab'); pg.wait_for_selector('[data-testid=voice-sheet][data-state=listening]'); pg.wait_for_timeout(1600)
            pg.screenshot(path=f'{OUT}/{k}-2-voice-listening.png')
            if pg.locator('[data-testid=vx-stop]').count(): pg.click('[data-testid=vx-stop]')
            pg.wait_for_selector('.dcard'); pg.wait_for_timeout(700)
            issues[f'{k}-drafts'] = pg.evaluate(AUD)
            pg.screenshot(path=f'{OUT}/{k}-3-draft-cards.png')
            # scrolled to the end: the last card's buttons must clear the pinned Discard / Accept-all bar
            pg.evaluate("document.querySelector('.voice-sheet .sheet-body').scrollTop = 1e6"); pg.wait_for_timeout(300)
            gap = pg.evaluate("""() => { const f = document.querySelector('.vx-foot').getBoundingClientRect();
              const bs = [...document.querySelectorAll('.dcard')].pop().querySelectorAll('.dc-foot .btn');
              return Math.min(...[...bs].map(b => f.top - b.getBoundingClientRect().bottom)); }""")
            issues[f'{k}-foot-clearance'] = [] if gap >= 4 else [f'last card buttons overlap the action bar by {-gap:.0f}px']
            print(k, 'last-card clearance above action bar:', round(gap), 'px')
            pg.screenshot(path=f'{OUT}/{k}-3b-draft-cards-scrolled-end.png')
            pg.evaluate("document.querySelector('.voice-sheet .sheet-body').scrollTop = 0"); pg.wait_for_timeout(200)
            pg.click('.dcard[data-type=money] [data-vx=edit]'); pg.wait_for_timeout(300)
            pg.screenshot(path=f'{OUT}/{k}-4-draft-editing.png')
            pg.click('[data-testid=vx-accept-all]'); pg.wait_for_selector('[data-testid=voice-sheet]', state='detached'); pg.wait_for_timeout(500)
            pg.screenshot(path=f'{OUT}/{k}-5-accepted.png')
            pg.click('#mic-fab'); pg.wait_for_selector('[data-testid=voice-sheet]'); pg.click('[data-vx=type]'); pg.wait_for_selector('#vx-text'); pg.wait_for_timeout(300)
            pg.screenshot(path=f'{OUT}/{k}-6-voice-typing.png')
            pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
            pg.evaluate("location.hash='#/you'"); pg.wait_for_timeout(700)
            pg.locator('#sec-agent').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
            pg.screenshot(path=f'{OUT}/{k}-7-settings-voice.png')
            pg.click('[data-act=acct-delete]'); pg.wait_for_selector('#da'); pg.fill('#da input[name=password]', PW); pg.click('#da button[type=submit]'); pg.wait_for_timeout(1200)
            c.close()
    b.close()
for k, v in issues.items():
    if v: print(k, v)
print('errors', errs); print('shots in', OUT)
