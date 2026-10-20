# Voice robustness, real Chromium + fake mic, local stack with the AI mock (see agent_e2e.py header for the stack).
#  1. Rapid turns: 6 record→Done→review→close cycles back to back: every one must transcribe (no "mic busy", no stale errors).
#  2. Chaos: open and close the mic sheet 6 times within ~100 ms each, then one real turn must still work.
#  3. Long speech: with 3 s segments (test tune), holding for 8 s makes ≥ 2 segments whose transcripts are joined in order.
import os, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
WAV = os.path.normpath(os.path.join(HERE, '..', 'fixtures', 'voice-te-mixed.wav'))
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-audio-capture={WAV}'])
    A, a = ctx(b, {'width': 390, 'height': 844}); onboard(a); open_signin(a)
    a.fill('[data-testid=si-email]', EMAIL); a.click('[data-testid=si-continue]'); a.wait_for_selector('[data-testid=si-new-password]')
    a.fill('[data-testid=si-new-password]', PW); a.fill('[data-testid=si-confirm]', PW); a.click('[data-testid=si-create]'); a.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    a.evaluate("location.hash='#/today'"); a.wait_for_timeout(500)
    def state(): return a.evaluate("document.querySelector('#vx')?.dataset.state || null")
    def wait_end(timeout=15):
        t0 = time.time()
        while time.time() - t0 < timeout:
            s = state()
            if s in ('review', 'error'): return s
            a.wait_for_timeout(100)
        return state()
    ok = 0; detail = []
    for i in range(6):
        (a.evaluate("document.activeElement?.blur()"), a.keyboard.press('v')); a.wait_for_selector('[data-testid=voice-sheet][data-state=listening]', timeout=5000)
        a.wait_for_timeout(900)
        if state() == 'listening': a.click('[data-testid=vx-stop]')
        s = wait_end(); detail.append(s)
        if s == 'review': ok += 1
        else: detail.append(a.inner_text('[data-testid=voice-sheet]')[:120])
        a.keyboard.press('Escape'); a.wait_for_timeout(60)
    rec('6 rapid turns all transcribe', ok == 6, ' '.join(map(str, detail)))
    for i in range(6):
        (a.evaluate("document.activeElement?.blur()"), a.keyboard.press('v')); a.wait_for_timeout(80); a.keyboard.press('Escape'); a.wait_for_timeout(40)
    a.wait_for_timeout(400)
    (a.evaluate("document.activeElement?.blur()"), a.keyboard.press('v')); a.wait_for_selector('[data-testid=voice-sheet][data-state=listening]', timeout=5000); a.wait_for_timeout(900)
    if state() == 'listening': a.click('[data-testid=vx-stop]')
    s = wait_end(); rec('after open/close chaos a real turn still works', s == 'review', s or '')
    a.keyboard.press('Escape'); a.wait_for_timeout(300)
    # long speech, segmented
    a.add_init_script("window.__steadyVoiceTune = { seg: 3000 }"); a.reload(); a.wait_for_selector('#ask-fab'); a.wait_for_timeout(500)
    box = a.locator('#ask-fab').bounding_box(); a.mouse.move(box['x'] + 20, box['y'] + 20); a.mouse.down()
    a.wait_for_timeout(8200); a.mouse.up()
    s = wait_end(20)
    last = a.evaluate("JSON.stringify(window.__steadyVoice.last)")
    said = a.input_value('#vx-said') if a.locator('#vx-said').count() else ''
    rec('hold 8 s with 3 s segments → several segments joined', s == 'review' and '"segments":' in last and int(last.split('"segments":')[1].split('}')[0]) >= 2, f'{last} | {said[:160]}')
    a.keyboard.press('Escape'); a.wait_for_timeout(300)
    a.evaluate("location.hash='#/you'"); a.wait_for_timeout(700); a.click('[data-act=acct-delete]'); a.wait_for_selector('#da')
    a.fill('#da input[name=password]', PW); a.click('#da button[type=submit]'); a.wait_for_timeout(1500)
    rec('no console errors', not errs, '; '.join(errs[:5]))
    b.close()
print('SUMMARY', sum(1 for r in res if r[1]), '/', len(res))
