# Voice agent + Money, end to end in real Chromium, against the local stack with the AI mock:
#   node tests/mocks/ai-mock.mjs 8791 &
#   DATABASE_URL=… SARVAM_API_KEY=mock GEMINI_API_KEY=mock SARVAM_BASE_URL=http://127.0.0.1:8791 GEMINI_BASE_URL=http://127.0.0.1:8791 PORT=8790 node scripts/dev-server.mjs &
#   python3 tests/qa/agent_e2e.py http://localhost:8790/
# Device A (phone, 390 px) records from a fake microphone fed with tests/fixtures/voice-te-mixed.wav → transcript (mock STT)
# → drafts (mock Gemini running Steady's planner) → Accept → local data changes → device B (laptop) receives them live.
import os, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
WAV = os.path.normpath(os.path.join(HERE, '..', 'fixtures', 'voice-te-mixed.wav'))
SHOTS = os.environ.get('SHOTS')  # optional: directory for screenshots

def all_(pg, coll): return pg.evaluate(f"window.__steady.all('{coll}')")
def wait_for(fn, secs=10):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = fn()
        if v: return v, time.time() - t0
        time.sleep(0.2)
    return None, time.time() - t0

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-audio-capture={WAV}'])
    def mk(vp, mobile):
        c = b.new_context(viewport=vp, has_touch=mobile, timezone_id='Asia/Kolkata', service_workers='block', permissions=['microphone'])
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.goto(BASE); pg.wait_for_selector('.onboarding, .shell'); return c, pg
    A, a = mk({'width': 390, 'height': 844}, True); onboard(a)
    a.fill('#qa', 'DSA: 2 problems'); a.press('#qa', 'Enter'); a.wait_for_timeout(300)
    # signed out: the mic still works by typing, understood on this device
    a.click('#mic-fab'); a.wait_for_selector('[data-testid=voice-sheet][data-state=typing]')
    rec('signed out → typing fallback with on-device understanding', 'Sign in' in a.inner_text('[data-testid=voice-sheet]'))
    a.fill('#vx-text', 'chai 30 rupees'); a.click('[data-testid=vx-understand]'); a.wait_for_selector('.dcard')
    rec('on-device draft without the server', a.inner_text('[data-testid=vx-meta]').endswith('this device') and a.locator('[data-testid=draft-money]').count() == 1, a.inner_text('[data-testid=vx-meta]'))
    a.click('[data-vx=discard-all]'); a.wait_for_timeout(400)
    rec('discard writes nothing', len(all_(a, 'money')) == 0)
    # sign up, second device
    open_signin(a); a.fill('[data-testid=si-email]', EMAIL); a.click('[data-testid=si-continue]'); a.wait_for_selector('[data-testid=si-new-password]')
    a.fill('[data-testid=si-new-password]', PW); a.fill('[data-testid=si-confirm]', PW); a.click('[data-testid=si-create]'); a.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    B, bp = mk({'width': 1366, 'height': 768}, False); onboard(bp, 'Karthik laptop')
    open_signin(bp); bp.fill('[data-testid=si-email]', EMAIL); bp.click('[data-testid=si-continue]'); bp.wait_for_selector('[data-testid=si-password]')
    bp.fill('[data-testid=si-password]', PW); bp.click('[data-testid=si-login]'); bp.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    bp.evaluate("location.hash='#/money'"); a.evaluate("location.hash='#/today'"); a.wait_for_timeout(800)
    # ---- voice: record → transcript → drafts
    a.reload(); a.wait_for_selector('#mic-fab'); a.wait_for_timeout(600)
    a.click('#mic-fab'); a.wait_for_selector('[data-testid=voice-sheet][data-state=listening]', timeout=5000)
    a.wait_for_timeout(1800)
    if SHOTS: a.screenshot(path=f'{SHOTS}/e2e-listening.png')
    rec('listening state with live waveform', a.locator('.vx-wave').count() == 1)
    if a.locator('[data-testid=vx-stop]').count(): a.click('[data-testid=vx-stop]')
    t0 = time.time()
    try: a.wait_for_selector('.dcard', timeout=15000)
    except Exception:
        print('STATE', a.evaluate("JSON.stringify(window.__steadyVoice.last)"), a.evaluate("document.querySelector('#vx')?.dataset.state"), a.inner_text('[data-testid=voice-sheet]')[:400]); print(errs); raise
    lat = time.time() - t0
    said = a.input_value('#vx-said')
    rec('transcript shown and editable', 'lunch' in said, said)
    types = a.eval_on_selector_all('.dcard', 'els => els.map(e => e.dataset.type)')
    rec('one utterance → several drafts (money + complete + reminder)', types == ['money', 'complete', 'reminder'], f'{types} in {lat:.1f}s (mock)')
    eff = a.inner_text('.dcard[data-type=complete] [data-effect]')
    rec('draft shows the matched existing task', 'DSA: 2 problems' in eff, eff)
    rec('nothing written before Accept', len(all_(a, 'money')) == 0 and all(t['status'] == 'open' for t in all_(a, 'tasks')))
    if SHOTS: a.screenshot(path=f'{SHOTS}/e2e-drafts.png')
    # edit one card before accepting: money amount 250 → 260
    a.click('.dcard[data-type=money] [data-vx=edit]'); a.fill('.dcard[data-type=money] [data-f=amount]', '260')
    a.click('[data-testid=vx-accept-all]'); a.wait_for_selector('[data-testid=voice-sheet]', state='detached', timeout=5000)
    money = all_(a, 'money'); tasks = {t['title']: t for t in all_(a, 'tasks')}
    rec('accept → money entry (edited amount kept)', len(money) == 1 and money[0]['amount'] == 260 and money[0]['category'] == 'Food', str([(m['amount'], m['category'], m['payee']) for m in money]))
    rec('accept → matched task marked done', tasks.get('DSA: 2 problems', {}).get('status') == 'done')
    rem = tasks.get('Call amma') or {}
    rec('accept → reminder for tomorrow 18:00', rem.get('dueTime') == '18:00' and rem.get('reminder') is True, f"{rem.get('dueDate')} {rem.get('dueTime')}")
    got, secs = wait_for(lambda: bp.evaluate("window.__steady.all('money').some(m => m.amount === 260) && window.__steady.all('tasks').some(t => t.title === 'DSA: 2 problems' && t.status === 'done')"))
    rec('changes sync live to the laptop', bool(got), f'{secs:.1f}s')
    bp.wait_for_timeout(600)
    rec('laptop Money tab shows it', '260' in bp.inner_text('[data-testid=money-spent]'), bp.inner_text('[data-testid=money-spent]'))
    # learning: a correction before accept reaches the server profile
    a.click('#mic-fab'); a.wait_for_selector('[data-testid=voice-sheet]'); a.wait_for_timeout(300)
    a.click('[data-vx=type]'); a.fill('#vx-text', 'rapido 80'); a.click('[data-testid=vx-understand]'); a.wait_for_selector('.dcard[data-type=money]')
    a.click('.dcard[data-type=money] [data-vx=edit]'); a.fill('.dcard[data-type=money] [data-f=category]', 'Commute')
    a.click('[data-testid=vx-accept]'); a.wait_for_timeout(1200)
    mem = a.evaluate("fetch('/api/agent/memory',{credentials:'same-origin'}).then(r=>r.json())")
    rec('your correction is learned (server profile memory)', any(c['word'] == 'rapido' and c['category'] == 'Commute' for c in mem['memory']['corrections']), str(mem['memory']['corrections']))
    # undo the whole session from the toast
    n_before = len(all_(a, 'money'))
    a.click('.toast-undo'); a.wait_for_timeout(700)
    rec('undo removes what was accepted', len(all_(a, 'money')) == n_before - 1)
    # money tab quick-add
    a.evaluate("location.hash='#/money'"); a.wait_for_timeout(500)
    a.fill('#mq', 'got 5000 stipend'); a.press('#mq', 'Enter'); a.wait_for_timeout(400)
    rec('money quick-add (income)', any(m['kind'] == 'income' and m['amount'] == 5000 for m in all_(a, 'money')))
    for r in ['today', 'goals', 'money', 'thoughts', 'insights', 'you', 'money']:
        a.click(f'.tabbar [data-route={r}], .topbar [data-route={r}]'); a.wait_for_timeout(350)
    rec('five tabs + You (header) switch cleanly', a.locator('.v-money').count() == 1)
    a.evaluate("location.hash='#/you'"); a.wait_for_timeout(600); a.click('[data-act=acct-delete]'); a.wait_for_selector('#da')
    a.fill('#da input[name=password]', PW); a.click('#da button[type=submit]'); a.wait_for_timeout(1500)
    rec('no console errors', not errs, '; '.join(errs[:5]))
    b.close()
print('SUMMARY', sum(1 for r in res if r[1]), '/', len(res))
sys.exit(0 if all(r[1] for r in res) else 1)
