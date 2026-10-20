# Day navigation on Today (‹ ›, ←/→, swipe, #/today?d=, Back to today) and the "Yesterday · N done" row.
# Usage: python3 tests/qa/history_e2e.py [BASE]   (screenshots in tests/qa/shots-history/, not committed)
import os, sys, datetime
from playwright.sync_api import sync_playwright
exec(open(os.path.join(os.path.dirname(__file__), 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
OUT = os.path.join(os.path.dirname(__file__), 'shots-history'); os.makedirs(OUT, exist_ok=True)
SEED = """async () => {
  const s = await import('./js/data/store.js');
  const { todayKey, keyAdd } = await import('./js/core/util.js');
  const tk = todayKey(), y = keyAdd(tk, -1), y2 = keyAdd(tk, -2), tm = keyAdd(tk, 1);
  const at = (k, h, m = 0) => { const [Y, M, D] = k.split('-').map(Number); return new Date(Y, M - 1, D, h, m).getTime(); };
  const T = o => s.save('tasks', { id: s.uid(), priority: 2, dueTime: null, durationMin: null, reminder: false, status: 'open', doneAt: null, goalId: null, ...o });
  await T({ title: 'Send chat about business to hark', dueDate: y, status: 'done', doneAt: at(y, 21, 40) });
  await T({ title: 'DSA: two pointers set', dueDate: y, status: 'done', doneAt: at(y, 10, 15), durationMin: 45 });
  await T({ title: 'Gym', dueDate: y, dueTime: '07:00', status: 'done', doneAt: at(y, 7, 50) });
  await T({ title: 'Read 20 pages', dueDate: y, status: 'skipped' });
  await T({ title: 'Reply to Capgemini mail', dueDate: tk, carried: true, carriedFrom: y });
  await T({ title: 'Late night commit', dueDate: y, status: 'done', doneAt: at(tk, 0, 25) });
  await T({ title: 'Post on Peerlist', dueDate: tk, dueTime: '18:00' });
  await T({ title: 'Plan the week', dueDate: tk, priority: 3 });
  await T({ title: 'Mock interview', dueDate: tm, dueTime: '11:00' });
  await T({ title: 'Old thing', dueDate: y2, status: 'done', doneAt: at(y2, 12) });
  return { tk, y, tm };
}"""
def shot(pg, name, bottom=False):
    pg.evaluate("document.getElementById('toast')?.classList.remove('show'); document.querySelectorAll('#ask-hint').forEach(e => e.remove())")
    pg.evaluate('window.scrollTo(0, document.body.scrollHeight)' if bottom else 'window.scrollTo(0, 0)'); pg.wait_for_timeout(500)
    pg.screenshot(path=f'{OUT}/{name}.png')
with sync_playwright() as p:
    b = p.chromium.launch()
    for vp, label in [({'width': 412, 'height': 915}, 'm412'), ({'width': 1366, 'height': 768}, 'w1366')]:
        for scheme in ['dark', 'light']:
            mob = vp['width'] < 700
            c = b.new_context(viewport=vp, device_scale_factor=2 if mob else 1, color_scheme=scheme, has_touch=mob, timezone_id='Asia/Kolkata', service_workers='block')
            pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(BASE); pg.wait_for_selector('.onboarding, .shell'); onboard(pg)
            k = pg.evaluate(SEED); pg.wait_for_timeout(600)
            tag = f'{label}-{scheme}'
            pg.wait_for_selector('[data-testid=yesterday-row]')
            yrow = pg.inner_text('[data-testid=yesterday-row]')
            rec(f'{tag} yesterday row', 'Yesterday' in yrow and '3 done' in yrow and '1 skipped' in yrow, yrow.replace('\n', ' '))
            rec(f'{tag} eyebrow has arrows', pg.locator('[data-testid=day-prev]').count() == 1 and pg.locator('[data-testid=day-next]').count() == 1)
            pg.click('[data-act=peek-yesterday]'); pg.wait_for_selector('[data-testid=yesterday-peek]')
            shot(pg, f'{tag}-today'); shot(pg, f'{tag}-today-bottom', bottom=True); pg.evaluate('window.scrollTo(0,0)')
            pg.click('[data-testid=yesterday-go]'); pg.wait_for_selector('[data-testid=day-head]')
            rec(f'{tag} hash', pg.evaluate('location.hash') == f"#/today?d={k['y']}", pg.evaluate('location.hash'))
            body = pg.inner_text('#view')
            rec(f'{tag} yesterday done task', 'Send chat about business to hark' in pg.inner_text('[data-testid=day-done]'))
            rec(f'{tag} summary', pg.inner_text('[data-testid=day-summary]').startswith('3 done · 1 skipped · 2 moved'), pg.inner_text('[data-testid=day-summary]'))
            mv = pg.inner_text('[data-testid=day-moved]')
            rec(f'{tag} moved notes', 'moved to today' in mv and 'done today' in mv, mv.replace('\n', ' | '))
            rec(f'{tag} back pill', pg.locator('[data-testid=back-today]').count() == 1)
            shot(pg, f'{tag}-yesterday')
            # un-check still works on a past day (and undo)
            pg.locator('[data-testid=day-done] .task', has_text='DSA').locator('[data-act=toggle]').click(); pg.wait_for_timeout(700)
            rec(f'{tag} un-check on past day', 'DSA' in pg.inner_text('[data-testid=day-moved]') if pg.locator('[data-testid=day-moved]').count() else False)
            pg.click('.toast-undo'); pg.wait_for_timeout(700)
            rec(f'{tag} undo restores', 'DSA' in pg.inner_text('[data-testid=day-done]'))
            # Back returns to today
            pg.go_back(); pg.wait_for_selector('#qa'); rec(f'{tag} back -> today', pg.evaluate('location.hash') in ('#/today', ''), pg.evaluate('location.hash'))
            if not mob:
                pg.locator('#view').click(position={'x': 5, 'y': 5}); pg.evaluate('document.activeElement.blur()')
                pg.keyboard.press('ArrowLeft'); pg.wait_for_selector('[data-testid=day-head]')
                rec(f'{tag} ← = yesterday', k['y'] in pg.evaluate('location.hash'))
                pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(500); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.wait_for_selector('#qa')
                rec(f'{tag} → back to today', pg.locator('[data-testid=yesterday-row]').count() == 1)
                pg.focus('#qa'); pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(300)
                rec(f'{tag} arrows ignored while typing', pg.locator('#qa').count() == 1)
                pg.evaluate('document.activeElement.blur()'); pg.keyboard.press('ArrowRight'); pg.wait_for_selector('[data-testid=day-head]')
                rec(f'{tag} tomorrow shows planned', 'Mock interview' in pg.inner_text('#view') and '1 planned' in pg.inner_text('[data-testid=day-summary]'))
                shot(pg, f'{tag}-tomorrow')
                pg.click('[data-testid=back-today]'); pg.wait_for_selector('#qa')
            else:
                swipe = """dx => { const el = document.querySelector('.v-today h1') || document.querySelector('.v-today'); const r = el.getBoundingClientRect();
                  const x0 = r.left + r.width / 2, y0 = r.top + 10; const mk = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y0 });
                  el.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(x0)], changedTouches: [mk(x0)], bubbles: true }));
                  for (let i = 1; i <= 6; i++) el.dispatchEvent(new TouchEvent('touchmove', { touches: [mk(x0 + dx * i / 6)], changedTouches: [mk(x0 + dx * i / 6)], bubbles: true }));
                  el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [mk(x0 + dx)], bubbles: true })); }"""
                pg.evaluate(swipe, 140); pg.wait_for_selector('[data-testid=day-head]')
                rec(f'{tag} swipe right = yesterday', k['y'] in pg.evaluate('location.hash'), pg.evaluate('location.hash'))
                pg.evaluate(swipe, -140); pg.wait_for_selector('#qa'); rec(f'{tag} swipe left = today', pg.locator('#qa').count() == 1)
                pg.evaluate(swipe, -140); pg.wait_for_selector('[data-testid=day-head]'); rec(f'{tag} swipe left again = tomorrow', k['tm'] in pg.evaluate('location.hash'))
                shot(pg, f'{tag}-tomorrow')
                pg.click('[data-testid=back-today]'); pg.wait_for_selector('#qa')
            # deep link
            pg.evaluate(f"location.hash='#/today?d={k['y']}'"); pg.wait_for_selector('[data-testid=day-head]')
            pg.goto(BASE + f"#/today?d={k['y']}"); pg.wait_for_selector('[data-testid=day-head]'); rec(f'{tag} deep link', 'Send chat about business' in pg.inner_text('#view'))
            c.close()
    b.close()
bad = [r for r in res if not r[1]]
print(f"{len(res) - len(bad)}/{len(res)} passed; errors: {errs}")
sys.exit(1 if bad or errs else 0)
