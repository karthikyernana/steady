# UI pass screenshots: every main screen at 390 px (light + dark) and 1366 px (light + dark).
#   python3 tests/qa/ui_pass_shots.py http://localhost:8790/ before|after
# Writes qa-shots/ui-pass/<tag>_<screen>_<viewport>-<scheme>.png and prints the layout audit per screen.
import os, sys, json
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
TAG = sys.argv[2] if len(sys.argv) > 2 else 'after'
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'qa-shots', 'ui-pass')); os.makedirs(OUT, exist_ok=True)
AUD = open(os.path.join(HERE, 'audit.js')).read()
BUG = 'Hi, it\'s done — 50% & <b>ok</b>, "quoted" #idea · ఈరోజు బాగుంది #ఆలోచన'
VPS = {'390': ({'width': 390, 'height': 844}, 2), '1366': ({'width': 1366, 'height': 768}, 1)}
report = {}

def open_you(pg):
    # after the UI pass the You view lives behind the header avatar; before it was a tab
    if pg.locator('[data-testid=you-btn]:visible').count(): pg.locator('[data-testid=you-btn]:visible').first.click()
    else: pg.evaluate("location.hash='#/you'")
    pg.wait_for_timeout(800)

def open_voice(pg):
    pg.evaluate("document.activeElement?.blur()"); pg.keyboard.press('v'); pg.wait_for_selector('#vx-text')   # V = the voice agent (Ask: tap = Chat, hold = talk)
    pg.fill('#vx-text', 'spent 250 on lunch at swiggy, finished DSA problems and remind me to call amma tomorrow at 6pm')
    pg.click('[data-testid=vx-understand]'); pg.wait_for_selector('.dcard'); pg.wait_for_timeout(600)

with sync_playwright() as p:
    b = p.chromium.launch()
    for vname, (vp, dsf) in VPS.items():
        for scheme in ['light', 'dark']:
            c = b.new_context(viewport=vp, device_scale_factor=dsf, color_scheme=scheme, has_touch=vname == '390', timezone_id='Asia/Kolkata', service_workers='block')
            pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(BASE); pg.wait_for_selector('.onboarding'); onboard(pg)
            pg.evaluate("import('./js/data/demo.js').then(m=>m.seed(30))"); pg.wait_for_timeout(700)
            key = f'{vname}-{scheme}'
            for r in ['today', 'goals', 'money', 'insights']:
                pg.evaluate(f"location.hash='#/{r}'"); pg.wait_for_timeout(800)
                report[f'{key}-{r}'] = pg.evaluate(AUD)
                pg.screenshot(path=f'{OUT}/{TAG}_{r}_{key}.png')
            # thoughts with the bug input saved
            pg.evaluate("location.hash='#/thoughts'"); pg.wait_for_timeout(700)
            pg.fill('#th-text', BUG); pg.click('#tf-cap button[type=submit]'); pg.wait_for_timeout(900)
            report[f'{key}-thoughts'] = pg.evaluate(AUD)
            txt = pg.locator('.thought-text').first.inner_text()
            report[f'{key}-thoughts-render'] = [] if txt == BUG else [f'rendered as: {txt}']
            pg.screenshot(path=f'{OUT}/{TAG}_thoughts_{key}.png')
            pg.evaluate("location.hash='#/today'"); pg.wait_for_timeout(600)
            open_you(pg); report[f'{key}-you'] = pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{TAG}_you_{key}.png')
            if TAG == 'after':
                # layout contract of the UI pass
                chk = pg.evaluate('''() => {
                  const out = [], vis = el => el && el.offsetParent !== null;
                  if (!document.querySelector('.v-you')) out.push('You view did not open from the header');
                  const bar = document.querySelector('.tabbar'), mic = document.getElementById('ask-fab');
                  if (vis(bar)) {
                    const n = bar.querySelectorAll('.tab').length; if (n !== 5) out.push(`tab bar has ${n} tabs`);
                    if (bar.querySelector('[data-route=you]')) out.push('You is still in the tab bar');
                    const br = bar.getBoundingClientRect(), mr = mic.getBoundingClientRect();
                    if (mr.bottom > br.top - 8) out.push(`mic overlaps tab bar (${mr.bottom} > ${br.top - 8})`);
                  }
                  window.scrollTo(0, document.documentElement.scrollHeight);
                  const last = [...document.querySelectorAll('.view-inner > *')].pop().getBoundingClientRect();
                  const mr = mic.getBoundingClientRect();
                  if (last.bottom > mr.top - 4) out.push(`page end hidden under the mic (${Math.round(last.bottom)} > ${Math.round(mr.top)})`);
                  window.scrollTo(0, 0);
                  return out; }''')
                report[f'{key}-layout'] = chk
            pg.evaluate("location.hash='#/today'"); pg.wait_for_timeout(600)
            open_voice(pg); report[f'{key}-voice'] = pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{TAG}_voice_{key}.png')
            c.close()
    b.close()
for k, v in report.items():
    if v: print(k, v)
print('errors', errs)
print('shots in', OUT)
