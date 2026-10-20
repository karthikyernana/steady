# Ask hold-to-talk, end to end in real Chromium with a fake microphone (local stack + AI mock, see agent_e2e.py):
#   python3 tests/qa/hold_e2e.py http://localhost:8790/
# Phone (412 px, real touch via CDP Input.dispatchTouchEvent) and desktop (mouse):
#  - while holding there is NO sheet: the button records (recording colour, bigger, live level, timer), a "Release to
#    send" note sits ABOVE the button (never under the finger, never covering it) and the page dims
#  - sliding > 80 px away says "Release to cancel" (and back says "Release to send"); releasing out there cancels
#  - release → the sheet opens on Transcribing… then the transcript and the drafts; a stray click never closes it
#  - a fumbled hold (< 0.6 s) is cancelled with "Hold to talk"; a tap still opens Chat
#  - a mic permission prompt that interrupts the first hold starts nothing hands-free, just "hold again"
import os, sys, json, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
WAV = os.path.normpath(os.path.join(HERE, '..', 'fixtures', 'voice-te-mixed.wav'))
SHOTS = os.environ.get('SHOTS')

def box(pg, sel): return pg.locator(sel).bounding_box()
def center(bb): return bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
def overlap(a, b): return not (a['x'] + a['width'] <= b['x'] or b['x'] + b['width'] <= a['x'] or a['y'] + a['height'] <= b['y'] or b['y'] + b['height'] <= a['y'])
def vstate(pg): return pg.evaluate("document.querySelector('#vx')?.dataset.state || null")
def shot(pg, name):
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=f'{SHOTS}/{name}.png')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-audio-capture={WAV}'])
    def mk(vp, mobile):
        c = b.new_context(viewport=vp, has_touch=mobile, is_mobile=mobile, device_scale_factor=2 if mobile else 1, timezone_id='Asia/Kolkata', service_workers='block', permissions=['microphone'])
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.goto(BASE); pg.wait_for_selector('.onboarding, .shell'); return c, pg
    M, m = mk({'width': 412, 'height': 892}, True); onboard(m)
    open_signin(m); m.fill('[data-testid=si-email]', EMAIL); m.click('[data-testid=si-continue]'); m.wait_for_selector('[data-testid=si-new-password]')
    m.fill('[data-testid=si-new-password]', PW); m.fill('[data-testid=si-confirm]', PW); m.click('[data-testid=si-create]'); m.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    m.wait_for_selector('.sheet-wrap', state='detached', timeout=5000); m.evaluate("location.hash='#/today'"); m.wait_for_selector('#qa'); m.wait_for_timeout(2600)
    cdp = M.new_cdp_session(m)
    def touch(kind, x=None, y=None):
        pts = [] if kind == 'touchEnd' else [{'x': x, 'y': y, 'radiusX': 8, 'radiusY': 8, 'force': 1, 'id': 1}]
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': pts})
    fab = box(m, '#ask-fab'); fx, fy = center(fab)

    # 1. hold: the button records, no sheet
    touch('touchStart', fx, fy); m.wait_for_timeout(1600)
    st = m.evaluate("(() => { const b = document.getElementById('ask-fab'), n = document.getElementById('ask-rec-note'); return { cls: b.className, label: b.querySelector('.ask-label').textContent, lvl: b.style.getPropertyValue('--lvl'), dim: document.documentElement.classList.contains('ask-rec'), note: n?.textContent, show: n?.classList.contains('show'), sheet: !!document.querySelector('.sheet-wrap'), bg: getComputedStyle(b).backgroundColor, scale: getComputedStyle(b).transform }; })()")
    rec('hold: no sheet while the finger is down', not st['sheet'], json.dumps(st))
    rec('hold: the button turns into the recorder (recording colour, grows)', 'recording' in st['cls'] and st['scale'] not in ('none', '') , st['bg'] + ' ' + st['scale'])
    rec('hold: an elapsed timer in the button', st['label'].startswith('0:0'), st['label'])
    rec('hold: a live level drives the ring', st['lvl'] != '', st['lvl'])
    rec('hold: the page dims', st['dim'] and m.evaluate("getComputedStyle(document.getElementById('ask-dim')).opacity") == '1')
    nb, fb = box(m, '#ask-rec-note'), box(m, '#ask-fab')
    rec('hold: "Release to send" sits above the button, never over it', st['show'] and st['note'] == 'Release to send' and nb['y'] + nb['height'] <= fb['y'] - 4 and not overlap(nb, fb), f'{nb} / {fb}')
    rec('hold: the note stays on screen', nb['x'] >= 0 and nb['x'] + nb['width'] <= 412, str(nb))
    shot(m, 'hold-m412-recording')
    # slide away → Release to cancel; back → Release to send
    touch('touchMove', fx - 130, fy - 40); m.wait_for_timeout(200)
    out = m.evaluate("[document.getElementById('ask-rec-note').textContent, document.getElementById('ask-fab').classList.contains('outside')]")
    rec('slide > 80 px away: "Release to cancel"', out == ['Release to cancel', True], str(out))
    shot(m, 'hold-m412-cancel')
    touch('touchMove', fx - 10, fy); m.wait_for_timeout(200)
    back = m.evaluate("[document.getElementById('ask-rec-note').textContent, document.getElementById('ask-fab').classList.contains('outside')]")
    rec('slide back: "Release to send" again', back == ['Release to send', False], str(back))
    m.wait_for_timeout(1400)
    touch('touchEnd'); m.wait_for_timeout(120)
    s1 = vstate(m)
    rec('release: the sheet opens on a thinking state (transcribing)', s1 in ('thinking', 'review'), str(s1))
    rec('release: the button is back to Ask, the dim is gone', 'recording' not in m.get_attribute('#ask-fab', 'class') and not m.evaluate("document.documentElement.classList.contains('ask-rec')") and m.inner_text('#ask-fab .ask-label') == 'Ask')
    try: m.wait_for_selector('#vx[data-state=review] .dcard[data-type]', timeout=15000)
    except Exception: pass
    rec('then the transcript and the drafts (nothing saved yet)', m.locator('#vx[data-state=review] .dcard[data-type]').count() >= 1 and m.locator('#vx-said').count() == 1, str(vstate(m)))
    m.wait_for_timeout(600)
    rec('no stray click closed the sheet after the hold', m.locator('[data-testid=voice-sheet]').count() == 1)
    shot(m, 'hold-m412-review')
    m.keyboard.press('Escape'); m.wait_for_selector('[data-testid=voice-sheet]', state='detached', timeout=5000); m.wait_for_timeout(400)

    # 2. a fumbled hold: cancelled with "Hold to talk", no sheet, nothing transcribed
    touch('touchStart', fx, fy); m.wait_for_timeout(470); touch('touchEnd'); m.wait_for_timeout(250)
    sh = m.evaluate("[document.getElementById('ask-rec-note').textContent, document.getElementById('ask-rec-note').classList.contains('show'), !!document.querySelector('.sheet-wrap'), window.__steadyVoice.state()]")
    rec('a hold under 0.6 s: cancelled with "Hold to talk", no sheet, mic released', sh[0] == 'Hold to talk' and sh[1] and not sh[2] and sh[3] is None, str(sh))
    m.wait_for_timeout(2000)

    # 3. slide away and let go: cancelled, nothing transcribed
    last0 = m.evaluate("JSON.stringify(window.__steadyVoice.last || null)")
    touch('touchStart', fx, fy); m.wait_for_timeout(1300); touch('touchMove', fx - 150, fy - 60); m.wait_for_timeout(150); touch('touchEnd'); m.wait_for_timeout(500)
    sc = m.evaluate("[!!document.querySelector('.sheet-wrap'), window.__steadyVoice.state(), document.getElementById('ask-rec-note').textContent]")
    rec('let go outside: cancelled (no sheet, no transcription)', not sc[0] and sc[1] is None and m.evaluate("JSON.stringify(window.__steadyVoice.last || null)") == last0, str(sc))
    m.wait_for_timeout(1400)

    # 4. a tap still opens Chat
    touch('touchStart', fx, fy); m.wait_for_timeout(90); touch('touchEnd'); m.wait_for_timeout(600)
    rec('tap Ask still opens Chat', m.evaluate("location.hash") == '#/chat' and m.locator('[data-testid=chat-panel]').is_visible())
    m.click('[data-testid=chat-close]'); m.wait_for_timeout(500)

    # 5. the first-use permission prompt interrupts the hold: nothing starts on its own, a note says hold again
    m.evaluate("""(() => { const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__permAsked = 0;
      navigator.permissions.query = async () => ({ state: 'prompt' });
      navigator.mediaDevices.getUserMedia = c => { window.__permAsked++; return new Promise(r => setTimeout(() => r(real(c)), 1800)); }; })()""")
    touch('touchStart', fx, fy); m.wait_for_timeout(900)
    m.evaluate("dispatchEvent(new Event('blur'))")           # the prompt takes focus: the hold is lost
    touch('touchEnd'); m.wait_for_timeout(2600)
    pr = m.evaluate("[!!document.querySelector('.sheet-wrap'), window.__steadyVoice.state(), document.getElementById('ask-rec-note').textContent, document.getElementById('ask-fab').classList.contains('recording'), window.__permAsked]")
    rec('permission prompt mid-hold: no hands-free recording, no sheet, "hold again" note', not pr[0] and pr[1] is None and 'hold' in pr[2].lower() and not pr[3] and pr[4] == 1, str(pr))

    # 6. desktop: mouse hold
    L, l = mk({'width': 1366, 'height': 820}, False); onboard(l, 'Karthik laptop')
    open_signin(l); l.fill('[data-testid=si-email]', EMAIL); l.click('[data-testid=si-continue]'); l.wait_for_selector('[data-testid=si-password]')
    l.fill('[data-testid=si-password]', PW); l.click('[data-testid=si-login]'); l.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    l.wait_for_selector('.sheet-wrap', state='detached', timeout=5000); l.evaluate("location.hash='#/today'"); l.wait_for_selector('#qa'); l.wait_for_timeout(2600)
    dfx, dfy = center(box(l, '#ask-fab'))
    l.mouse.move(dfx, dfy); l.mouse.down(); l.wait_for_timeout(1700)
    ds = l.evaluate("[document.getElementById('ask-fab').classList.contains('recording'), !!document.querySelector('.sheet-wrap'), document.getElementById('ask-rec-note').textContent]")
    nb, fb = box(l, '#ask-rec-note'), box(l, '#ask-fab')
    rec('desktop: mouse hold records in the button, no sheet, note above', ds[0] and not ds[1] and ds[2] == 'Release to send' and nb['y'] + nb['height'] <= fb['y'] and not overlap(nb, fb), str(ds))
    shot(l, 'hold-d1366-recording')
    l.mouse.up(); l.wait_for_timeout(150)
    rec('desktop: release opens the sheet (thinking → review)', vstate(l) in ('thinking', 'review'), str(vstate(l)))
    try: l.wait_for_selector('#vx[data-state=review]', timeout=15000)
    except Exception: pass
    rec('desktop: drafts after release', l.locator('#vx[data-state=review] .dcard[data-type]').count() >= 1, str(vstate(l)))
    l.wait_for_timeout(500)
    rec('desktop: the sheet stays (no stray click)', l.locator('[data-testid=voice-sheet]').count() == 1)
    rec('no console errors', not errs, '; '.join(errs[:4]))
    b.close()
fails = [r for r in res if not r[1]]
print(f'\n{len(res) - len(fails)}/{len(res)} passed')
sys.exit(1 if fails else 0)
