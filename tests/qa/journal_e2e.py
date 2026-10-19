# Today as a journal, end to end in Chromium against the local stack + AI mock (see agent_e2e.py header).
# Seeds 14 days of realistic entries/tasks/money, then: entries get understood (areas + facts), Today shows the page and
# the AI-chosen views drawn from real numbers, a new entry is filed live, tasks still work, a second device sees jx synced.
import os, sys, time, random
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
SHOTS = os.environ.get('SHOTS')
SEED = r"""
async () => {
  const st = await import('/js/data/store.js'); const j = await import('/js/data/journal.js');
  const day = 864e5, now = Date.now();
  const lines = [
    [13, 'Solved 3 DSA problems on arrays, felt slow but okay'], [12, 'gym 45 min, then watched 2 episodes of Panchayat'],
    [12, 'Applied to Capgemini and LTIMindtree, resume needs work'], [11, 'Solved 2 DSA problems. Called amma, she is worried about placements'],
    [10, 'Shipped the reminders fix for Steady, proud of it'], [9, 'Tired, slept badly. Scrolled reels for an hour'],
    [8, 'gym 40 min. Solved 4 DSA problems on trees, best day this week'], [7, 'Read 20 pages of Zero to One'],
    [6, 'Mock interview with a friend went badly, stressed'], [5, 'Solved 2 DSA problems, watched cricket match with roommates'],
    [4, 'Built the money tab for Steady and posted on LinkedIn'], [3, 'gym 50 min, felt great after'], [2, 'Solved 3 DSA problems on graphs'],
    [1, 'Capgemini test cleared! Called amma to tell her'], [0, 'Morning: solved 2 DSA problems before class'],
  ];
  for (const [d, text] of lines) { const at = d === 0 ? now - 5 * 60e3 : now - d * day - 3 * 3600e3; await st.save('thoughts', { id: st.uid(), text, tags: [], mood: 3, kind: 'journal', createdAt: at }); }
  const dk = ms => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
  for (let d = 13; d >= 0; d--) { if (d % 2) await st.save('tasks', { id: st.uid(), title: d % 4 === 1 ? 'DSA practice' : 'Post on LinkedIn', priority: 2, status: 'done', doneAt: now - d * day - 3600e3, createdAt: now - d * day - 7200e3, dueDate: dk(now - d * day) }); }
  for (const [d, amt, cat, p] of [[12, 180, 'Food', 'Swiggy'], [9, 450, 'Shopping', 'Amazon'], [6, 120, 'Commute', 'Rapido'], [3, 260, 'Food', 'Zomato'], [0, 90, 'Food', 'Canteen']])
    await st.save('money', { id: st.uid(), kind: 'expense', amount: amt, category: cat, note: '', payee: p, date: dk(now - d * day), source: 'manual', createdAt: now - d * day - 1800e3 });
  let n = 0; for (let i = 0; i < 3; i++) n += await j.tagPending({ force: true });
  return n;
}"""
with sync_playwright() as p:
    b = p.chromium.launch()
    A, a = ctx(b, {'width': 390, 'height': 844}); onboard(a); open_signin(a)
    a.fill('[data-testid=si-email]', EMAIL); a.click('[data-testid=si-continue]'); a.wait_for_selector('[data-testid=si-new-password]')
    a.fill('[data-testid=si-new-password]', PW); a.fill('[data-testid=si-confirm]', PW); a.click('[data-testid=si-create]'); a.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    a.evaluate("location.hash='#/today'"); a.wait_for_timeout(500)
    rec('empty journal: composer + blank page', a.locator('[data-testid=journal-composer]').count() == 1 and 'blank page' in a.inner_text('[data-testid=journal-page]'))
    n = a.evaluate(SEED); rec('seeded entries understood', n >= 15, f'{n} tagged')
    tagged = a.evaluate("(async()=>{const st=await import('/js/data/store.js');return st.all('thoughts').map(t=>[t.text.slice(0,20), t.jx?.areas, (t.jx?.facts||[]).map(f=>f.label+':'+f.value)])})()")
    dsa = [t for t in tagged if 'DSA' in t[0]]
    rec('facts use one stable label (dsa problems)', all(any(f.startswith('dsa problems:') for f in t[2]) for t in dsa), str(dsa[:2]))
    a.evaluate("(async()=>{const j=await import('/js/data/journal.js');await j.refreshReflection({force:true});})()"); a.wait_for_timeout(300)
    a.evaluate("location.hash='#/goals'"); a.wait_for_timeout(300); a.evaluate("location.hash='#/today'"); a.wait_for_timeout(900)
    rec('AI headline in the header', 'Learning showed up most' in a.inner_text('[data-testid=journal-headline]'))
    rec('AI question becomes the composer prompt', 'DSA session' in (a.get_attribute('#j-text', 'placeholder') or ''))
    kinds = a.eval_on_selector_all('.jv', 'els => els.map(e => e.dataset.testid)')
    rec('views chosen by the model are drawn', set(['jv-balance', 'jv-metric', 'jv-mood', 'jv-streak']) <= set(kinds), str(kinds))
    big = a.inner_text('[data-testid=jv-metric] .jv-big') if a.locator('[data-testid=jv-metric]').count() else ''
    rec('metric number is computed, not invented (DSA total in window = 13)', big.startswith('13'), big)
    rec('streak computed', a.inner_text('[data-testid=jv-streak] .jv-big').split()[0].isdigit())
    page_txt = a.inner_text('[data-testid=journal-page]')
    rec("today's page: entry + finished task + money", 'Morning: solved 2 DSA' in page_txt and 'Spent ₹90' in page_txt, page_txt[:200].replace('\n', ' | '))
    if SHOTS: a.screenshot(path=f'{SHOTS}/journal-mobile.png', full_page=True)
    # a new entry: saved, then filed live
    a.fill('#j-text', 'Watched 1 episode of Mirzapur and went for a 30 min walk with Ravi'); a.click('[data-testid=journal-save]')
    a.wait_for_timeout(2500)
    row = a.locator('.jl-row', has_text='Mirzapur')
    rec('new entry appears and gets areas', row.count() == 1 and 'Entertainment' in row.inner_text(), row.inner_text().replace('\n', ' | ') if row.count() else '')
    # tasks still work
    a.fill('#qa', 'call amma 8pm'); a.press('#qa', 'Enter'); a.wait_for_timeout(400)
    rec('tasks: quick add still works', a.locator('[data-testid=open-list] .task', has_text='call amma').count() == 1)
    a.locator('[data-testid=open-list] .task', has_text='call amma').locator('.check').click(); a.wait_for_timeout(1500)
    rec('tasks: completing one adds it to the page', 'finished call amma' in a.inner_text('[data-testid=journal-page]').lower())
    # second device sees the understanding
    B, bp = ctx(b, {'width': 1366, 'height': 900}); onboard(bp, 'Karthik laptop'); open_signin(bp)
    bp.fill('[data-testid=si-email]', EMAIL); bp.click('[data-testid=si-continue]'); bp.wait_for_selector('[data-testid=si-password]')
    bp.fill('[data-testid=si-password]', PW); bp.click('[data-testid=si-login]'); bp.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    bp.evaluate("location.hash='#/today'"); bp.wait_for_timeout(2500)
    rec('laptop: page + chips synced', 'Mirzapur' in bp.inner_text('[data-testid=journal-page]') and bp.locator('[data-testid=journal-page] .ar-chip').count() >= 3)
    if SHOTS: bp.screenshot(path=f'{SHOTS}/journal-desktop.png', full_page=True)
    bp.evaluate("document.documentElement.dataset.theme='dark'"); bp.wait_for_timeout(300)
    if SHOTS: bp.screenshot(path=f'{SHOTS}/journal-desktop-dark.png', full_page=True)
    a.evaluate("location.hash='#/thoughts'"); a.wait_for_timeout(500)
    rec('entries also live in Thoughts (nothing separate)', 'Mirzapur' in a.inner_text('[data-testid=thought-list]'))
    a.evaluate("location.hash='#/you'"); a.wait_for_timeout(700); a.click('[data-act=acct-delete]'); a.wait_for_selector('#da')
    a.fill('#da input[name=password]', PW); a.click('#da button[type=submit]'); a.wait_for_timeout(1500)
    rec('no console errors', not errs, '; '.join(errs[:5]))
    b.close()
print('SUMMARY', sum(1 for r in res if r[1]), '/', len(res))
