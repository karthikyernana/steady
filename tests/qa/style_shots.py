"""Screenshots of every new style: Today + Goals at 390 (light/dark), Today at 1366 light, plus a contact sheet per style,
and runs the layout audit (tap targets, overflow, clipped text) for each style at 360/390/412/1366 in both themes.
Usage: python3 tests/qa/style_shots.py http://localhost:8795/"""
import sys, os, json
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw
HERE = os.path.dirname(__file__); ROOT = os.path.join(HERE, '..', '..')
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
AUD = open(os.path.join(HERE, 'audit.js')).read()
OUT = os.path.join(ROOT, 'qa-shots', 'styles'); os.makedirs(OUT, exist_ok=True)
STYLES = sys.argv[2].split(',') if len(sys.argv) > 2 else ['grid', 'papercut', 'midnight']
report = {}
def set_style(pg, s):
    pg.evaluate(f"localStorage.setItem('steady-style','{s}'); document.documentElement.dataset.style='{s}'"); pg.wait_for_timeout(250)
def go(pg, r): pg.evaluate(f"location.hash='#/{r}'"); pg.wait_for_timeout(650); pg.evaluate("window.scrollTo(0,0)"); pg.wait_for_timeout(150)
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h in [(360, 780), (390, 844), (412, 915), (1366, 768)]:
        for scheme in ['light', 'dark']:
            mob = w < 700
            c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mob else 1, color_scheme=scheme, reduced_motion='reduce',
                              has_touch=mob, timezone_id='Asia/Kolkata', service_workers='block')
            pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(BASE); pg.wait_for_selector('.onboarding'); onboard(pg)
            pg.evaluate("import('./js/data/demo.js').then(m=>m.seed(30))"); pg.wait_for_timeout(700); pg.wait_for_function("!document.querySelector('#toast.show')", timeout=8000)
            for s in STYLES:
                set_style(pg, s); pg.evaluate("document.fonts.ready"); 
                for r in ['today', 'goals', 'thoughts', 'insights', 'you']:
                    go(pg, r); report[f'{s}-{w}-{scheme}-{r}'] = pg.evaluate(AUD)
                    shoot = (w == 390 and r in ('today', 'goals')) or (w == 1366 and scheme == 'light' and r == 'today')
                    if shoot:
                        pg.screenshot(path=f'{OUT}/{s}-{r}-{w}-{scheme}.png')
                        pg.screenshot(path=f'{OUT}/{s}-{r}-{w}-{scheme}-full.png', full_page=True)
                    if w == 390 and r == 'you': pg.screenshot(path=f'{OUT}/{s}-you-{w}-{scheme}-full.png', full_page=True)
                go(pg, 'today'); pg.locator('.task .t-main').first.click(); pg.wait_for_timeout(500)
                report[f'{s}-{w}-{scheme}-sheet'] = pg.evaluate(AUD)
                if w == 390: pg.screenshot(path=f'{OUT}/{s}-editsheet-{w}-{scheme}.png')
                pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
                if pg.locator('.sheet-wrap').count(): pg.goto(BASE + '#/today'); pg.wait_for_selector('#qa')
            c.close()
    b.close()
# contact sheets: 390 Today light | Today dark | Goals light
for s in STYLES:
    ims = [Image.open(f'{OUT}/{s}-{n}.png') for n in ('today-390-light', 'today-390-dark', 'goals-390-light')]
    pad, top = 40, 90; W = sum(i.width for i in ims) + pad * 4; H = max(i.height for i in ims) + top + pad
    sheet = Image.new('RGB', (W, H), (40, 40, 40)); d = ImageDraw.Draw(sheet); x = pad
    for im, lab in zip(ims, ['Today · light', 'Today · dark', 'Goals · light']):
        sheet.paste(im, (x, top)); d.text((x, 30), f'{s}  /  {lab}  (390px)', fill=(235, 235, 235), font_size=34); x += im.width + pad
    sheet.save(f'{OUT}/{s}-sheet.png')
json.dump(report, open(f'{OUT}/audit.json', 'w'), indent=1)
n = 0
for k, v in report.items():
    if v: n += 1; print(k, v)
print('screens audited', len(report), 'with issues', n); print('errors', errs)
