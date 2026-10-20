# Web screenshots that match android ScreenshotTest.kt (same seed data), for side-by-side parity checks.
#   python3 tests/qa/parity_shots.py [base_url] [out_dir]
import sys, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8790/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/workspace/work/parity/web-after'
os.makedirs(OUT, exist_ok=True)
AUD = open(os.path.join(os.path.dirname(__file__), 'audit.js')).read()

SEED = r"""async () => {
  const s = await import('./js/data/store.js');
  const pad = n => String(n).padStart(2, '0'), key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = b => { const d = new Date(today); d.setDate(d.getDate() - b); return d; };
  const at = (d, h) => { const x = new Date(d); x.setHours(h, 15, 0, 0); return x.getTime(); };
  const ws = new Date(today); ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
  const wk = i => { const d = new Date(ws); d.setDate(d.getDate() + 7 * i); return key(d); };
  await s.save('goals', { id: 'g-placement', title: 'Crack campus placements', why: 'First job by March', milestones: [['Resume final', true], ['Aptitude mocks x5', true], ['Mock interviews', false], ['Apply 20 companies', false]].map(([t, d], i) => ({ id: 'm' + i, title: t, week: wk(i - 2), done: d })), actions: [] });
  await s.save('goals', { id: 'g-dsa', title: '300 DSA problems', milestones: [['Arrays', true], ['Trees', false], ['Graphs', false]].map(([t, d], i) => ({ id: 'd' + i, title: t, week: wk(i - 1), done: d })), actions: [] });
  let n = 0; const tasks = [];
  for (let back = 0; back <= 60; back++) {
    const d = day(back), k = (back * 7 + 3) % 5;
    for (let i = 0; i < (back % 6 === 5 ? 0 : k); i++) tasks.push({ id: 't' + n++, title: ['Solve 3 DSA problems', 'Gym', 'Aptitude mock', 'Read 20 pages', 'Apply to 2 jobs'][i], status: 'done', priority: 2, dueDate: key(d), doneAt: at(d, 9 + i * 3), goalId: i === 0 ? 'g-dsa' : null, updatedAt: Date.now() });
  }
  await s.putRaw('tasks', tasks);
  for (const [t, tm, p] of [['Call amma', '19:30', 3], ['Calance GD prep', '11:00', 3], ['Laundry', null, 1]])
    await s.save('tasks', { id: 'o' + n++, title: t, status: 'open', priority: p, dueDate: key(today), dueTime: tm, reminder: !!tm });
  await s.save('tasks', { id: 'o' + n++, title: 'Morning run', status: 'done', priority: 2, dueDate: key(today), dueTime: '07:30', doneAt: at(today, 7) });
  const money = [[240, 'Food', 0], [1200, 'Travel', 1], [180, 'Food', 2], [499, 'Shopping', 4], [90, 'Food', 5], [15000, 'Allowance', 6]];
  for (const [i, [v, c, b]] of money.entries()) await s.save('money', { id: 'mo' + i, amount: v, category: c, note: c.toLowerCase(), date: key(day(b)), kind: c === 'Allowance' ? 'income' : 'expense' });
  await s.putRaw('thoughts', [
    { id: 'th1', kind: 'note', mood: 4, createdAt: at(today, 10), updatedAt: Date.now(), tags: ['dsa'], text: "1. The Input Constraint Trick (The Golden Rule)\n\nCode execution environments usually allow around \\(10^{8}\\) operations per second.\n\nInput Size\tExpected Time Complexity\tCommon Algorithms\n\\(N \\le 10\\)\t\\(O(N!)\\) or \\(O(2^N \\cdot N)\\)\tPermutations, backtracking\n\\(N \\le 20\\)\t\\(O(2^N)\\)\tBitmask DP\n\\(N \\le 500\\)\t\\(O(N^3)\\)\tFloyd-Warshall\n\\(N \\le 10^5\\)\t\\(O(N \\log N)\\)\tSorting, heaps, two pointers\n\n2. Identify the Data Structure and its limits #dsa" },
    { id: 'th2', kind: 'idea', mood: 5, createdAt: at(day(1), 22), updatedAt: Date.now(), tags: ['startup'], text: 'Steady could chart anything I ask about my week #startup' },
  ]);
}"""

def onboard_to_guide(pg):
    pg.fill('[data-testid=ob-name]', 'Karthik'); pg.click('form[data-ob=name] button[type=submit]'); pg.wait_for_selector('[data-testid=ob-goal-0]')
    pg.click('form[data-ob=goals] button[type=submit]'); pg.wait_for_selector('[data-testid=ob-wake]')
    pg.click('form[data-ob=rhythm] button[type=submit]'); pg.wait_for_selector('[data-ob-skip]'); pg.click('[data-ob-skip]')
    pg.wait_for_selector('[data-testid=ob-finish]'); pg.click('[data-testid=ob-finish]'); pg.wait_for_selector('[data-testid=guide]')

report, errs = {}, []
with sync_playwright() as p:
    b = p.chromium.launch()
    for scheme in ['light', 'dark']:
        c = b.new_context(viewport={'width': 411, 'height': 891}, device_scale_factor=2, color_scheme=scheme, has_touch=True, timezone_id='Asia/Kolkata', service_workers='block')
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector('.onboarding')
        onboard_to_guide(pg); pg.wait_for_timeout(700)
        report[f'{scheme}-guide'] = pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{scheme}-0-guide.png')
        pg.click('[data-testid=guide-skip]'); pg.wait_for_selector('.guide', state='detached')
        pg.evaluate(SEED); pg.wait_for_timeout(800)
        pg.evaluate("location.hash='#/today'"); pg.wait_for_timeout(900)
        report[f'{scheme}-today'] = pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{scheme}-1-today.png')
        pg.evaluate("location.hash='#/thoughts'"); pg.wait_for_timeout(900)
        report[f'{scheme}-thoughts'] = pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{scheme}-2-thoughts.png')
        pg.locator('.thought').first.click(); pg.wait_for_selector('[data-testid=th-read]'); pg.wait_for_timeout(700)
        report[f'{scheme}-read'] = pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{scheme}-3-thought-read.png')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
        pg.evaluate("location.hash='#/insights'"); pg.wait_for_timeout(1100)
        report[f'{scheme}-insights'] = pg.evaluate(AUD); pg.screenshot(path=f'{OUT}/{scheme}-4-insights.png')
        pg.locator('[data-testid=heatmap]').scroll_into_view_if_needed(); pg.evaluate('window.scrollBy(0, 260)'); pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/{scheme}-5-insights-scrolled.png')
        pg.evaluate('window.scrollTo(0, 99999)'); pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/{scheme}-6-insights-bottom.png')
        c.close()
    b.close()
for k, v in report.items():
    if v: print(k, v)
print('errors', errs)
