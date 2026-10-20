"""Regression probes for web fixes (Playwright). Usage: python3 tests/qa/web_fixes_e2e.py [BASE=http://localhost:8790/]
Budget amounts that are not multiples of 100/50 save; thoughts render readable LaTeX and stay escaped; carry-over pick
survives a task deleted while the sheet is open."""
import os
exec(open(os.path.join(os.path.dirname(__file__), 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
with sync_playwright() as p:
    b = p.chromium.launch(); c, pg = ctx(b, {'width': 412, 'height': 900}); onboard(pg)
    # money: budget 1250 / category 175
    pg.evaluate("location.hash='#/money'"); pg.wait_for_selector('#mq')
    pg.fill('#mq', '250 lunch swiggy'); pg.press('#mq', 'Enter'); pg.wait_for_timeout(400)
    pg.click('[data-act=m-budget]'); pg.wait_for_selector('#bf')
    pg.fill('#bf [name=total]', '1250'); pg.locator('#bf [data-cat]').first.fill('175')
    pg.click('#bf button[type=submit]'); pg.wait_for_timeout(400)
    bd = pg.evaluate("(window.__steady.all('meta').find(m => m.id === 'budgets') || {})")
    rec('budget of 1250 / 175 saves', bd.get('total') == 1250 and 175 in (bd.get('categories') or {}).values(), str(bd))
    # thoughts: readable + escaped
    pg.evaluate("location.hash='#/thoughts'"); pg.wait_for_selector('#th-text')
    for t in ['<img src=x onerror=alert(1)> N \\le 10^5, \\frac{a+b}{2} #dsa', 'Given \\( N \\le 10^{5} \\)']:
        pg.fill('#th-text', t); pg.click('#tf-cap button[type=submit]'); pg.wait_for_timeout(300)
    txt = pg.inner_text('[data-testid=thought-list]')
    rec('thoughts: LaTeX readable (with and without delimiters)', 'N ≤ 10⁵, (a+b)/2' in txt and 'Given N ≤ 10⁵' in txt and '\\le' not in txt, txt.replace('\n', ' | ')[:200])
    rec('thoughts: markup stays text', pg.locator('[data-testid=thought-list] img').count() == 0 and '<img src=x' in txt)
    # carry-over: pick sheet open, one task deleted meanwhile (another device / sync), Done still works
    pg.evaluate("""async () => { const { save } = await import('./js/data/store.js'); const { keyAdd, todayKey } = await import('./js/core/util.js');
      for (const id of ['old1', 'old2']) await save('tasks', { id, title: 'Old ' + id, priority: 2, dueDate: keyAdd(todayKey(), -2), status: 'open' }); }""")
    pg.evaluate("location.hash='#/today'"); pg.wait_for_selector('[data-testid=carry]')
    pg.click('[data-act=carry-pick]'); pg.wait_for_selector('.pick-list')
    pg.evaluate("import('./js/data/store.js').then(m => m.remove('tasks', 'old2'))"); pg.wait_for_timeout(200)
    pg.click('.sheet [data-ok]'); pg.wait_for_timeout(500)
    st = pg.evaluate("({ t: window.__steady.all('tasks').filter(t => t.id.startsWith('old')).map(t => t.id + ':' + t.dueDate), sheet: !!document.querySelector('.pick-list') })")
    rec('carry pick: deleted task skipped, sheet closes, no junk record', st['t'] and len(st['t']) == 1 and not st['sheet'] and not any(not x.get('title') for x in pg.evaluate("window.__steady.all('tasks')")), str(st))
    # goals: a milestone without a week (the voice agent makes these) stays unscheduled through an edit + save
    pg.evaluate("import('./js/data/store.js').then(m => m.save('goals', { id: 'gq', title: 'Ship it', milestones: [{ id: 'm1', title: 'Someday', week: null, done: false }], actions: [] }))")
    pg.evaluate("location.hash='#/goals'"); pg.wait_for_selector('[data-id=gq] [data-act=goal-edit]')
    pg.click('[data-id=gq] [data-act=goal-edit]'); pg.wait_for_selector('#gf'); pg.click('#gf button[type=submit]'); pg.wait_for_timeout(400)
    wk = pg.evaluate("window.__steady.all('goals').find(g => g.id === 'gq').milestones[0].week")
    rec('goal edit keeps an unscheduled milestone unscheduled', wk is None, repr(wk))
    rec('no page errors', not errs, str(errs[:3]))
    print('SUMMARY', sum(1 for r in res if r[1]), '/', len(res))
