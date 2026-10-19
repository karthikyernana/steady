"""v1.3 x new styles: Today, Money, voice sheet with draft cards and the You view at 390 (light/dark) for each style,
plus the layout audit. Usage: python3 tests/qa/style_v13_shots.py http://localhost:8790/ [styles]"""
import sys, os, json
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..')
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
AUD = open(os.path.join(HERE, 'audit.js')).read()
OUT = os.path.normpath(os.path.join(ROOT, 'qa-shots', 'styles-v13')); os.makedirs(OUT, exist_ok=True)
STYLES = sys.argv[2].split(',') if len(sys.argv) > 2 else ['liquid', 'paper', 'grid', 'papercut', 'midnight']
report = {}
CHK = '''() => { const out = [], bar = document.querySelector('.tabbar'), mic = document.getElementById('mic-fab'), you = document.querySelector('[data-testid=you-btn]');
  const vis = el => el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
  if (!vis(bar)) out.push('no tab bar'); else { const n = bar.querySelectorAll('.tab').length; if (n !== 5) out.push('tabs ' + n);
    for (const t of bar.querySelectorAll('.tab')) { const r = t.getBoundingClientRect(); if (r.width < 44) out.push('narrow tab ' + r.width); } }
  if (!vis(mic)) out.push('no mic'); else if (vis(bar)) { const m = mic.getBoundingClientRect(), b = bar.getBoundingClientRect(); if (m.bottom > b.top - 4) out.push('mic over bar'); }
  if (!vis(you)) out.push('no K button');
  return out; }'''
with sync_playwright() as p:
    b = p.chromium.launch()
    for scheme in ['light', 'dark']:
        c = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme=scheme, reduced_motion='reduce', has_touch=True, timezone_id='Asia/Kolkata', service_workers='block')
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector('.onboarding'); onboard(pg)
        pg.evaluate("import('./js/data/demo.js').then(m=>m.seed(30))"); pg.wait_for_timeout(700)
        for s in STYLES:
            pg.evaluate(f"localStorage.setItem('steady-style','{s}'); document.documentElement.dataset.style='{s}'"); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(250)
            for r in ['today', 'money']:
                pg.evaluate(f"location.hash='#/{r}'"); pg.wait_for_timeout(700); pg.evaluate('window.scrollTo(0,0)')
                k = f'{s}-{scheme}-{r}'; report[k] = pg.evaluate(AUD) + pg.evaluate(CHK); pg.screenshot(path=f'{OUT}/{s}_{r}_{scheme}.png')
            pg.locator('#mic-fab').click(); pg.wait_for_selector('#vx-text')
            pg.fill('#vx-text', 'spent 250 on lunch at swiggy and remind me to call amma tomorrow at 6pm'); pg.click('[data-testid=vx-understand]'); pg.wait_for_selector('.dcard'); pg.wait_for_timeout(600)
            report[f'{s}-{scheme}-voice'] = pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{s}_voice_{scheme}.png')
            pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
            if pg.locator('.sheet-wrap').count(): pg.evaluate("location.hash='#/today'"); pg.goto(BASE + '#/today'); pg.wait_for_selector('#qa')
            pg.locator('[data-testid=you-btn]:visible').first.click(); pg.wait_for_timeout(700)
            report[f'{s}-{scheme}-you'] = pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{s}_you_{scheme}.png', full_page=True)
        c.close()
    b.close()
json.dump(report, open(f'{OUT}/audit.json', 'w'), indent=1)
for k, v in report.items():
    if v: print(k, v)
print('screens', len(report), 'with issues', sum(1 for v in report.values() if v)); print('errors', errs)
