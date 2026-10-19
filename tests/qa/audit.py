import sys, os, json
from playwright.sync_api import sync_playwright
exec(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
AUD=open(__import__('os').path.join(__import__('os').path.dirname(__file__),'audit.js')).read(); OUT=__import__('os').path.join(__import__('os').path.dirname(__file__),'shots'); os.makedirs(OUT, exist_ok=True)
TAG=sys.argv[2] if len(sys.argv)>2 else 'cur'
VPS={'m360':({'width':360,'height':780},2),'m412':({'width':412,'height':915},2),'w1366':({'width':1366,'height':768},1.25),'w1920':({'width':1536,'height':864},1.25)}
report={}
with sync_playwright() as p:
    b=p.chromium.launch()
    for name,(vp,dsf) in VPS.items():
      for scheme in ['light','dark']:
        c=b.new_context(viewport=vp, device_scale_factor=dsf if name.startswith('m') else 1, color_scheme=scheme, has_touch=name.startswith('m'), timezone_id='Asia/Kolkata', service_workers='block')
        pg=c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector('.onboarding')
        iss=pg.evaluate(AUD); report[f'{name}-{scheme}-onb']=iss
        if scheme=='light': pg.screenshot(path=f'{OUT}/{TAG}-{name}-onb.png')
        onboard(pg); pg.evaluate("import('./js/data/demo.js').then(m=>m.seed(30))"); pg.wait_for_timeout(600)
        for r in ['today','goals','money','thoughts','insights','you']:
            pg.evaluate(f"location.hash='#/{r}'"); pg.wait_for_timeout(700)
            report[f'{name}-{scheme}-{r}']=pg.evaluate(AUD)
            pg.screenshot(path=f'{OUT}/{TAG}-{name}-{scheme}-{r}.png', full_page=(scheme=='light'))
        pg.evaluate("location.hash='#/today'"); pg.wait_for_timeout(600)
        pg.locator('.task .t-main').first.click(); pg.wait_for_timeout(700)
        report[f'{name}-{scheme}-sheet']=pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{TAG}-{name}-{scheme}-sheet.png')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
        # voice agent sheet (signed out here, so the typing fallback) with draft cards
        pg.click('#mic-fab'); pg.wait_for_selector('#vx-text')
        pg.fill('#vx-text', 'spent 250 on lunch at swiggy, finished DSA problems and remind me to call amma tomorrow at 6pm'); pg.click('[data-testid=vx-understand]'); pg.wait_for_selector('.dcard'); pg.wait_for_timeout(500)
        report[f'{name}-{scheme}-voice']=pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{TAG}-{name}-{scheme}-voice.png')
        c.close()
    b.close()
for k,v in report.items():
    if v: print(k, v)
print('errors', errs)
