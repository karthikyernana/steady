"""Steady end-to-end suite (Playwright, Chromium).

Usage: python3 tests/e2e.py [--base URL] [--real-github owner/repo] [--only name,name]
Writes tests/results.json and screenshots to tests/shots/.
"""
import argparse, base64, hashlib, json, os, random, re, string, sys, threading, time, traceback, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8765/steady/')
ap.add_argument('--only', default='')
ap.add_argument('--ntfy-server', default='https://ntfy.envs.net')
args = ap.parse_args()
BASE = args.base
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots'); os.makedirs(SHOTS, exist_ok=True)
AXE = '/tmp/axe/package/axe.min.js'
VIEWPORTS = {'mobile': {'width': 412, 'height': 915}, 'small': {'width': 360, 'height': 740}, 'desktop': {'width': 1440, 'height': 900}}
TZ = 'Asia/Kolkata'

PROXY = None
if os.environ.get('HTTPS_PROXY'):
    u = urllib.parse.urlparse(os.environ['HTTPS_PROXY'])
    PROXY = {'server': f'http://{u.hostname}:{u.port}', 'username': urllib.parse.unquote(u.username or ''), 'password': urllib.parse.unquote(u.password or ''), 'bypass': 'localhost,127.0.0.1'}

RESULTS = []
def record(name, cfg, ok, detail=''):
    RESULTS.append({'test': name, 'config': cfg, 'pass': bool(ok), 'detail': str(detail)[:600]})
    print(('PASS ' if ok else 'FAIL ') + f'[{cfg}] {name} {detail if not ok else ""}'[:400], flush=True)

def want(name): return not args.only or name in args.only.split(',')

# ---------------------------------------------------------------- local API server (scripts/dev-server.mjs + local Postgres)
import subprocess, socket
API_DB = os.environ.get('E2E_DATABASE_URL', 'postgres://steady:steady@localhost:5432/steady_e2e')
API_PORT = 8770
API_BASE = f'http://localhost:{API_PORT}/'
SETUP_CODE = 'e2e-setup-code-0123456789'
PASSPHRASE = 'steady e2e passphrase'
APP_ROOT = os.path.dirname(HERE)

def sql(q, as_owner=True):
    # the tables FORCE row-level security, so even the table owner must name the owner scope to see rows
    pre = "select set_config('app.owner_id', coalesce((select id::text from owners limit 1), ''), false) \\gset\n" if as_owner else ''
    out = subprocess.run(['psql', API_DB, '-tA', '-q'], input=pre + q + ';', capture_output=True, text=True, check=True).stdout.strip()
    return out.split('\n')[-1].strip() if out else ''

NOPROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def start_api():
    sql('drop schema public cascade; create schema public;')
    env = {**os.environ, 'PORT': str(API_PORT), 'DATABASE_URL': API_DB, 'SETUP_CODE': SETUP_CODE, 'OWNER_EMAILS': 'karthikyernana@gmail.com',
           'CRON_SECRET': 'e2e-cron-secret-0123456789', 'MIGRATE_SECRET': 'e2e-migrate-secret-0123456789'}
    subprocess.run(['node', 'scripts/migrate.mjs'], cwd=APP_ROOT, env=env, check=True, capture_output=True)
    proc = subprocess.Popen(['node', 'scripts/dev-server.mjs'], cwd=APP_ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: socket.create_connection(('127.0.0.1', API_PORT), 0.2).close(); break
        except OSError: time.sleep(0.1)
    return proc

# ---------------------------------------------------------------- helpers
def new_ctx(browser, vp='mobile', scheme='light', perms=None, base=None, fixed_time=None):
    c = browser.new_context(viewport=VIEWPORTS[vp], color_scheme=scheme, timezone_id=TZ, locale='en-IN', ignore_https_errors=True,
                            accept_downloads=True, permissions=perms or [], device_scale_factor=1, is_mobile=False, has_touch=vp != 'desktop')
    pg = c.new_page()
    pg._errors = []
    pg.on('pageerror', lambda e: pg._errors.append(f'pageerror: {e}'))
    pg.on('console', lambda m: pg._errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    pg.on('requestfailed', lambda r: pg._errors.append(f'requestfailed: {r.url}') if 'ntfy' not in r.url else None)
    if fixed_time: pg.clock.set_fixed_time(fixed_time)
    pg.goto(base or BASE); pg.wait_for_selector('.onboarding, .shell', timeout=15000)
    return c, pg

def onboard(pg, name='Karthik', goals=('Land my first paying client', 'Gym 4× a week'), notif='skip', shots=None):
    def snap(n):
        if shots: pg.wait_for_timeout(350); pg.screenshot(path=f'{SHOTS}/{shots}-{n}.png')
    snap('onb-0-welcome')
    pg.fill('[data-testid=ob-name]', name); pg.click('form[data-ob=name] button[type=submit]')
    pg.wait_for_selector('[data-testid=ob-goal-0]')
    for i, g in enumerate(goals): pg.fill(f'[data-testid=ob-goal-{i}]', g)
    snap('onb-1-goals')
    pg.click('form[data-ob=goals] button[type=submit]'); pg.wait_for_selector('[data-testid=ob-wake]')
    pg.fill('[data-testid=ob-wake]', '08:00'); pg.fill('[data-testid=ob-sleep]', '01:00')
    snap('onb-2-rhythm')
    pg.click('form[data-ob=rhythm] button[type=submit]'); pg.wait_for_selector('[data-testid=ob-notif]')
    snap('onb-3-notif')
    if notif == 'grant': pg.click('[data-testid=ob-notif]')
    else: pg.click('[data-ob-skip]')
    pg.wait_for_selector('[data-testid=ob-finish]'); snap('onb-4-done')
    pg.click('[data-testid=ob-finish]'); pg.wait_for_selector('[data-testid=guide]'); snap('onb-5-guide')
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(400)
    record('first-run guide: opens after onboarding, keyboard moves pages', 'onboarding', pg.locator('.guide-dots i.on').count() == 1 and pg.locator('.guide-dots i').nth(1).get_attribute('class') == 'on')
    pg.click('[data-testid=guide-skip]'); pg.wait_for_selector('.guide', state='detached'); pg.wait_for_selector('#qa')

def go(pg, route):
    pg.evaluate(f"location.hash = '#/{route}'"); pg.wait_for_selector(f'.v-{route}'); pg.wait_for_timeout(250)

def seed(pg, days=30):
    r = pg.evaluate(f"import('./js/data/demo.js').then(m => m.seed({days}))"); pg.wait_for_timeout(400); return r

def close_sheets(pg):
    for _ in range(3):
        if pg.locator('.sheet-wrap').count() == 0: break
        pg.keyboard.press('Escape'); pg.wait_for_timeout(260)

def count(pg, coll): return pg.evaluate(f"window.__steady.all('{coll}').length")

def ui_audit(pg, label):
    """Layout checks: horizontal overflow, tap targets < 44px, clipped text."""
    return pg.evaluate("""() => {
      const issues = [];
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) issues.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
      const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('.hidden,[hidden],details:not([open]) > :not(summary)'); };
      const sel = 'button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, summary, label.switch';
      for (const el of document.querySelectorAll(sel)) {
        if (!vis(el)) continue;
        if (el.matches('.switch input')) continue;
        if (el.closest('p, li, small, .hint') && el.matches('a, .link') && !el.matches('.btn')) continue; // inline text links (WCAG 2.5.8 exception)
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 || r.left < -1) issues.push(`offscreen: ${el.tagName.toLowerCase()} "${(el.textContent||el.getAttribute('aria-label')||el.placeholder||'').trim().slice(0,30)}"`);
        if (Math.round(r.height) < 44 || Math.round(r.width) < 44) issues.push(`tap target ${Math.round(r.width)}x${Math.round(r.height)}: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent||el.getAttribute('aria-label')||el.placeholder||'').trim().slice(0,30)}"`);
      }
      for (const el of document.querySelectorAll('h1,h2,h3,p,.t-title,.btn,.chip-btn,.tab span,.sync-chip span')) {
        if (!vis(el)) continue;
        const s = getComputedStyle(el);
        if ((s.overflow === 'hidden' || s.overflowX === 'hidden') && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) issues.push(`clipped text: ${el.textContent.trim().slice(0,40)}`);
        const r = el.getBoundingClientRect(); if (r.right > vw + 1) issues.push(`text overflows viewport: ${el.textContent.trim().slice(0,40)}`);
      }
      return [...new Set(issues)];
    }""")

def axe(pg):
    if not pg.evaluate("!!window.axe"): pg.add_script_tag(path=AXE)
    res = pg.evaluate("""() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] } })
      .then(r => r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, targets: v.nodes.slice(0,3).map(n => n.target.join(' ')) })))""")
    return res

AUDITS = []
def shot_and_audit(pg, name, cfg, run_axe=False):
    pg.wait_for_timeout(300)
    path = f'{SHOTS}/{cfg}-{name}.png'
    pg.screenshot(path=path)
    issues = ui_audit(pg, name)
    entry = {'screen': name, 'config': cfg, 'shot': path, 'layout_issues': issues}
    if run_axe: entry['axe'] = axe(pg)
    AUDITS.append(entry)
    return entry

# ---------------------------------------------------------------- tests
def core_flow(browser, vp, scheme):
    cfg = f'{vp}-{scheme}'
    c, pg = new_ctx(browser, vp, scheme, fixed_time='2026-10-16T15:30:00+05:30')
    full = vp == 'mobile' and scheme == 'light'
    try:
        # onboarding
        try:
            onboard(pg, shots=cfg)
            ok = 'Karthik' in pg.inner_text('.page-head') and count(pg, 'goals') == 2
            record('onboarding (name, goals, rhythm, notif skip)', cfg, ok)
        except Exception as e: record('onboarding (name, goals, rhythm, notif skip)', cfg, False, e); raise
        pg.wait_for_timeout(4500)  # let welcome toast clear
        shot_and_audit(pg, 'today-empty', cfg, run_axe=True)

        # quick-add natural input
        pg.fill('#qa', 'linkedin 20 min at 6pm')
        chips = pg.inner_text('#qa-chips')
        shot_and_audit(pg, 'today-quickadd-preview', cfg)
        pg.press('#qa', 'Enter'); pg.wait_for_timeout(300)
        t = pg.evaluate("window.__steady.all('tasks')[0]")
        ok = t and t['title'] == 'Linkedin' and t['dueTime'] == '18:00' and t['durationMin'] == 20 and t['reminder'] is True and '6 PM' in chips and '20 min' in chips
        record('quick-add parses "linkedin 20 min at 6pm"', cfg, ok, json.dumps(t))
        for q in ['call mom tomorrow 7:30pm !', 'DSA 2 problems 45m at 9', 'read 10 pages', 'gym at 7am']:
            pg.fill('#qa', q); pg.press('#qa', 'Enter'); pg.wait_for_timeout(200)
        ts = {x['title']: x for x in pg.evaluate("window.__steady.all('tasks')")}
        ok = ts.get('Call mom', {}).get('priority') == 3 and ts['Call mom']['dueTime'] == '19:30' and ts['Call mom']['dueDate'] == '2026-10-17' \
            and ts.get('DSA 2 problems', {}).get('dueTime') == '21:00' and ts['DSA 2 problems']['dueDate'] == '2026-10-16' and ts.get('Gym', {}).get('dueDate') == '2026-10-17' and ts['DSA 2 problems']['durationMin'] == 45 and 'Read 10 pages' in ts
        record('quick-add: date/priority/ambiguous "at 9" at 15:30 -> 9 PM; passed time rolls to tomorrow', cfg, ok, json.dumps({k: (v.get('dueDate'), v.get('dueTime'), v.get('priority')) for k, v in ts.items()}))

        # complete / skip / undo
        pg.click('.task:has-text("Linkedin") .check'); pg.wait_for_timeout(250)
        done = pg.evaluate("window.__steady.all('tasks').find(t=>t.title==='Linkedin').status")
        shot_and_audit(pg, 'today-toast-done', cfg)
        pg.click('.toast-undo'); pg.wait_for_timeout(250)
        undone = pg.evaluate("window.__steady.all('tasks').find(t=>t.title==='Linkedin').status")
        pg.click('.task:has-text("Linkedin") .check'); pg.wait_for_timeout(200)
        pg.click('.task:has-text("Read 10 pages") [data-act=skip]'); pg.wait_for_timeout(200)
        skipped = pg.evaluate("window.__steady.all('tasks').find(t=>t.title==='Read 10 pages').status")
        record('complete, undo, skip task', cfg, done == 'done' and undone == 'open' and skipped == 'skipped', f'{done},{undone},{skipped}')

        # edit sheet
        pg.click('.task:has-text("DSA 2 problems") .t-main'); pg.wait_for_selector('#tf')
        shot_and_audit(pg, 'sheet-edit-task', cfg, run_axe=full)
        pg.click('[data-seg=prio] button[data-v="3"]'); pg.fill('#tf input[name=durationMin]', '50'); pg.click('#tf button[type=submit]'); pg.wait_for_timeout(300)
        t = pg.evaluate("window.__steady.all('tasks').find(t=>t.title==='DSA 2 problems')")
        record('edit task sheet (priority, minutes)', cfg, t['priority'] == 3 and t['durationMin'] == 50)
        pg.click('[data-act=toggle-done]'); pg.wait_for_timeout(200)
        shot_and_audit(pg, 'today-populated', cfg, run_axe=full)

        # goals
        go(pg, 'goals'); shot_and_audit(pg, 'goals-fresh', cfg)
        pg.click('.goal:has-text("Land my first") [data-act=goal-edit]'); pg.wait_for_selector('#gf')
        pg.fill('#ms-new', 'Portfolio site live'); pg.click('#ms-add')
        pg.fill('#ms-new', '30 cold DMs to founders'); pg.click('#ms-add')
        pg.fill('#ac-new', 'Send 3 cold DMs'); pg.click('#ac-add')
        shot_and_audit(pg, 'sheet-goal-edit', cfg, run_axe=full)
        pg.click('#gf button[type=submit]'); pg.wait_for_timeout(300)
        pg.click('.goal:has-text("Land my first") [data-act=ms-toggle]'); pg.wait_for_timeout(250)
        pg.click('.goal:has-text("Land my first") [data-act=action-today]'); pg.wait_for_timeout(250)
        g = pg.evaluate("window.__steady.all('goals').find(g=>g.title.startsWith('Land'))")
        width = pg.evaluate("document.querySelector('.goal .progress span').style.width")
        linked = pg.evaluate(f"window.__steady.all('tasks').some(t=>t.goalId==='{g['id']}' && t.title==='Send 3 cold DMs')")
        record('goals: milestones, weekly progress, daily action -> today', cfg, len(g['milestones']) == 2 and g['milestones'][0]['done'] and width.startswith('50') and linked, f'{width} linked={linked}')
        shot_and_audit(pg, 'goals-populated', cfg, run_axe=full)

        # thoughts
        go(pg, 'thoughts'); shot_and_audit(pg, 'thoughts-empty', cfg)
        pg.fill('#th-text', 'Idea: n8n template store for D2C brands #idea #startup'); pg.click('.mood.m5'); pg.click('[data-seg=kind] button[data-v=idea]'); pg.click('#tf-cap button[type=submit]'); pg.wait_for_timeout(250)
        pg.fill('#th-text', 'Felt scattered today, too many tabs #reflection'); pg.click('.mood.m2'); pg.click('#tf-cap button[type=submit]'); pg.wait_for_timeout(250)
        th = pg.evaluate("window.__steady.all('thoughts')")
        pg.fill('#th-q', 'scattered'); pg.wait_for_timeout(250)
        n_search = pg.locator(".thought-list .thought").count()
        pg.fill('#th-q', ''); pg.wait_for_timeout(200)
        pg.click('[data-act=th-tag][data-tag=idea]'); pg.wait_for_timeout(200)
        n_tag = pg.locator(".thought-list .thought").count()
        ok = len(th) == 2 and any(t['mood'] == 5 and t['kind'] == 'idea' and 'startup' in t['tags'] for t in th) and n_search == 1 and n_tag == 1
        record('thoughts: capture with tags + mood, search, tag filter', cfg, ok, f'{n_search},{n_tag}')
        pg.click('[data-act=th-tag][data-tag=idea]'); pg.wait_for_timeout(200)
        shot_and_audit(pg, 'thoughts-populated', cfg, run_axe=full)

        # the evening check-in is retired: no card on Today, even late in the evening (21:30 IST)
        pg.clock.set_fixed_time(1792166400)  # epoch seconds: Fri 2026-10-16 21:30 IST
        go(pg, 'goals'); go(pg, 'today')
        record('no evening check-in card (retired)', cfg, pg.locator('[data-testid=checkin-cta]').count() == 0 and pg.locator('[data-act=checkin]').count() == 0)

        # insights empty-ish, then seeded 30 days
        go(pg, 'insights'); shot_and_audit(pg, 'insights-learning', cfg)
        seed(pg, 30); go(pg, 'today'); go(pg, 'insights')
        rem = pg.locator('.remember-list li').count()
        texts = pg.inner_text('.remember-list')
        ok = rem >= 4 and pg.locator('[data-testid=heatmap] rect').count() > 100 and pg.locator('[data-testid=weekday] rect').count() == 7 \
             and pg.locator('[data-testid=hours] rect').count() == 24 and pg.locator('[data-testid^=st-]').count() == 4 and 'between 9' in texts \
             and 'checked in' not in texts and pg.locator('[data-testid=scatter]').count() == 0
        record('insights render with seeded 30-day data (stats, remember, heatmap, weekday, hours)', cfg, ok, texts[:300])
        shot_and_audit(pg, 'insights-populated', cfg, run_axe=full)
        pg.evaluate('window.scrollTo(0, 99999)'); pg.wait_for_timeout(200); shot_and_audit(pg, 'insights-bottom', cfg)
        pg.evaluate('window.scrollTo(0, 0)')

        # adaptive layer: slump -> minimum viable day; carry-over
        go(pg, 'today')
        a = pg.evaluate("({slump: window.__lastAnalysis.slump, cap: window.__lastAnalysis.loadCap, best: window.__lastAnalysis.best.start})")
        mvd = pg.locator('[data-testid=mvd-offer]').count()
        shot_and_audit(pg, 'today-adaptive', cfg)
        if mvd:
            pg.click('[data-act=mvd-on]'); pg.wait_for_timeout(300)
            n_open = pg.locator('[data-testid=open-list] .task').count()
            shot_and_audit(pg, 'today-mvd', cfg)
        else: n_open = -1
        record('adaptive: detects slump, offers minimum viable day (<=3 tasks)', cfg, a['slump'] is not None and mvd == 1 and 1 <= n_open <= 3, json.dumps(a) + f' open={n_open}')
        pg.click('[data-act=mvd-off]'); pg.wait_for_timeout(200)
        if pg.locator('[data-act=mvd-dismiss]').count(): pg.click('[data-act=mvd-dismiss]'); pg.wait_for_timeout(200)
        carry = pg.locator('[data-testid=carry]').count()
        if carry:
            pg.click('[data-act=carry-all]'); pg.wait_for_timeout(300)
        carried = pg.evaluate("window.__steady.all('tasks').filter(t=>t.carried && t.dueDate==='2026-10-16').length")
        record('carry-over prompt brings unfinished tasks into today', cfg, carry == 1 and carried >= 1, f'carry={carry} carried={carried}')
        pg.fill('#qa', 'LinkedIn outreach')
        sug = pg.inner_text('#qa-chips')
        record('reminder time suggestion from completion history', cfg, 'PM' in sug and ('usually' in sug or 'best hours' in sug), sug)
        pg.fill('#qa', '')

        # settings screens
        go(pg, 'you'); shot_and_audit(pg, 'settings-top', cfg, run_axe=full)
        pg.click('[data-testid=ntfy-section] summary'); pg.click('#ntfy-on + .track'); pg.wait_for_timeout(400)
        pg.locator('[data-testid=ntfy-section]').scroll_into_view_if_needed(); shot_and_audit(pg, 'settings-ntfy', cfg)
        topic = pg.input_value('#ntfy-topic')
        record('ntfy: private random topic auto-generated', cfg, bool(re.match(r'^steady-[a-z2-9]{18}$', topic)), topic)
        pg.click('[data-seg=theme] button[data-v=dark]' if scheme == 'light' else '[data-seg=theme] button[data-v=light]'); pg.wait_for_timeout(200)
        flipped = pg.evaluate("document.documentElement.dataset.theme")
        record('theme switch', cfg, flipped == ('dark' if scheme == 'light' else 'light'))
        pg.click('[data-seg=theme] button[data-v=system]'); pg.wait_for_timeout(200)
        pg.locator('#sec-data').scroll_into_view_if_needed(); shot_and_audit(pg, 'settings-bottom', cfg)
        # keyboard: focus ring visible on a button
        pg.keyboard.press('Tab'); pg.keyboard.press('Tab')
        fv = pg.evaluate("(() => { const el = document.activeElement; const s = getComputedStyle(el); return el.tagName + '|' + s.outlineStyle + '|' + s.outlineWidth; })()")
        record('keyboard focus is visible', cfg, '|solid|2px' in fv or 'solid' in fv, fv)
        errs = [e for e in pg._errors if 'ntfy' not in e and '429' not in e]
        record('no console/page errors', cfg, not errs, errs[:5])
    finally:
        c.close()

def test_export_import(browser):
    cfg = 'mobile-light'
    c, pg = new_ctx(browser)
    onboard(pg); seed(pg, 30); go(pg, 'you')
    with pg.expect_download() as d: pg.click('[data-testid=export]')
    path = os.path.join(HERE, 'export-sample.json'); d.value.save_as(path)
    before = {k: count(pg, k) for k in ['tasks', 'goals', 'thoughts', 'checkins']}
    c.close()
    c2, pg2 = new_ctx(browser); onboard(pg2, name='Kay', goals=()); go(pg2, 'you')
    pg2.set_input_files('[data-testid=import]', path); pg2.wait_for_timeout(800)
    after = {k: count(pg2, k) for k in ['tasks', 'goals', 'thoughts', 'checkins']}
    ok = all(after[k] >= before[k] for k in before) and after['goals'] == before['goals']
    record('export JSON then import into a fresh device (merge)', cfg, ok, f'{before} -> {after}')
    pg2.set_input_files('[data-testid=import]', path); pg2.wait_for_timeout(600)
    again = {k: count(pg2, k) for k in before}
    record('re-import is idempotent (no duplicates)', cfg, again == after, f'{again}')
    c2.close()
    os.remove(path)

def test_offline(browser):
    cfg = 'mobile-light'
    c, pg = new_ctx(browser); onboard(pg); seed(pg, 5)
    pg.evaluate("navigator.serviceWorker.ready"); pg.reload(); pg.wait_for_selector('#qa')
    ctrl = pg.evaluate("!!navigator.serviceWorker.controller")
    cached = pg.evaluate("caches.keys().then(k => Promise.all(k.map(n => caches.open(n).then(c => c.keys())))).then(a => a.flat().length)")
    c.set_offline(True)
    pg.reload(); pg.wait_for_selector('#qa', timeout=10000)
    n = pg.locator('.task').count()
    pg.fill('#qa', 'offline task at 8pm'); pg.press('#qa', 'Enter'); pg.wait_for_timeout(300)
    added = pg.evaluate("window.__steady.all('tasks').some(t=>t.title==='Offline task')")
    go(pg, 'insights'); charts = pg.locator('.chart').count()
    fonts = pg.evaluate("document.fonts.check('16px Inter') && document.fonts.check('20px \"Instrument Serif\"')")
    shot_and_audit(pg, 'offline-insights', cfg)
    record('offline: service worker serves app shell after reload, data + charts + fonts work', cfg, ctrl and cached >= 30 and n > 0 and added and charts >= 3 and fonts, f'ctrl={ctrl} cached={cached} tasks={n} added={added} charts={charts} fonts={fonts}')
    c.set_offline(False); c.close()

def test_notifications(browser):
    cfg = 'mobile-light'
    c, pg = new_ctx(browser, perms=['notifications'])
    onboard(pg, notif='grant')
    perm = pg.evaluate("Notification.permission")
    go(pg, 'you'); state = pg.inner_text('[data-testid=perm-state]')
    pg.evaluate("navigator.serviceWorker.ready")
    pg.click('[data-act=notif-test]'); pg.wait_for_timeout(800)
    shown = pg.evaluate("navigator.serviceWorker.ready.then(r => r.getNotifications()).then(n => n.map(x => x.title))")
    record('notification permission flow (granted) + SW showNotification', cfg, perm == 'granted' and 'on' in state.lower() and 'Steady' in shown, f'{perm} / {state} / {shown}')
    c.close()
    c, pg = new_ctx(browser)  # default state: ask sheet appears after first timed task
    onboard(pg)
    pg.fill('#qa', 'standup at 7pm'); pg.press('#qa', 'Enter')
    try: pg.wait_for_selector('.sheet-title:has-text("nudge")', timeout=4000)
    except Exception: pass
    asked = pg.locator('.sheet-title:has-text("nudge")').count()
    shot_and_audit(pg, 'sheet-ask-notifications', cfg)
    record('gentle permission ask appears after first timed task', cfg, asked == 1)
    c.close()

def test_ntfy(browser):
    cfg = 'mobile-light'
    c, pg = new_ctx(browser)
    onboard(pg); go(pg, 'you')
    pg.click('[data-testid=ntfy-section] summary'); pg.click('#ntfy-on + .track'); pg.wait_for_timeout(300)
    # 1) ntfy.sh itself (default server)
    with pg.expect_response(re.compile(r'https://ntfy\.sh/steady-')) as r: pg.click('[data-testid=ntfy-test]')
    st = r.value.status
    body = r.value.text()[:160]
    record('ntfy.sh test publish from browser (CORS ok, real response)', cfg, st in (200, 429), f'status={st} {body}')
    pg.wait_for_timeout(300); shot_and_audit(pg, 'settings-ntfy-error' if st != 200 else 'settings-ntfy-sent', cfg)
    # 2) same API on a public ntfy instance (throwaway topic), including scheduled + cancel
    pg.fill('#ntfy-server', args.ntfy_server); pg.press('#ntfy-server', 'Tab'); pg.wait_for_timeout(400)
    with pg.expect_response(lambda x: x.url.startswith(args.ntfy_server) and x.request.method == 'POST') as r: pg.click('[data-testid=ntfy-test]')
    record(f'ntfy test publish to throwaway topic on {args.ntfy_server} returns 200', cfg, r.value.status == 200, r.value.status)
    go(pg, 'today')
    t2 = pg.evaluate("(() => { const d = new Date(Date.now() + 2*3600e3 + 120e3); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); })()")
    same_day = pg.evaluate("new Date(Date.now()+2*3600e3+120e3).toDateString() === new Date().toDateString()")
    q = f'ntfy probe at {t2}' + ('' if same_day else ' tomorrow')
    with pg.expect_response(lambda x: '/st-' in x.url and x.request.method == 'POST', timeout=15000) as r:
        pg.fill('#qa', q); pg.press('#qa', 'Enter')
    req = r.value.request
    at = int(req.headers.get('at', '0')); resp = r.value.json()
    ok = r.value.status == 200 and abs(at - (time.time() + 7200)) < 600 and resp.get('time') == at and resp.get('sequence_id', '').startswith('st-')
    record('ntfy scheduled reminder: POST /<topic>/st-<id> with At header (server confirms delivery time)', cfg, ok, f"status={r.value.status} at={at} resp={json.dumps(resp)[:200]}")
    with pg.expect_response(lambda x: '/st-' in x.url and x.request.method == 'DELETE', timeout=15000) as r:
        pg.click('.task:has-text("Ntfy probe") .check')
    record('ntfy: completing the task cancels the scheduled reminder (DELETE)', cfg, r.value.status == 200, r.value.status)
    c.close()

def test_sync(browser):
    """Two real browser contexts against the real API (dev server) and a real Postgres: sign-in, offline edits, merge, push queue."""
    cfg = 'sync-api'
    proc = start_api()
    cA = cB = None
    try:
        cA, A = new_ctx(browser, 'desktop', 'light', base=API_BASE)
        cB, B = new_ctx(browser, 'mobile', 'dark', base=API_BASE)
        onboard(A, name='Karthik')
        go(A, 'you'); shot_and_audit(A, 'sync-signed-out', cfg, run_axe=True)
        # first-time setup with the one-time code
        A.click('[data-testid=sign-in]'); A.wait_for_selector('[data-testid=setup-form]')
        A.fill('[data-testid=setup-code]', 'wrong-code-123456789'); A.fill('[data-testid=setup-pass]', PASSPHRASE); A.click('[data-testid=setup-go]')
        A.wait_for_function("document.querySelector('#si-err')?.textContent.length > 0")
        err = A.inner_text('#si-err'); shot_and_audit(A, 'sync-setup-error', cfg)
        record('auth: wrong setup code is refused with a clear message', cfg, 'not right' in err, err)
        A.fill('[data-testid=setup-code]', SETUP_CODE); A.click('[data-testid=setup-go]')
        A.wait_for_selector('[data-testid=sync-status]', timeout=15000); A.wait_for_timeout(600)
        st = A.inner_text('[data-testid=sync-status]')
        record('auth: one-time setup signs the owner in (httpOnly session) and syncs', cfg, 'In sync' in st and 'karthikyernana@gmail.com' in st, st)
        cookies = cA.cookies()
        record('auth: session cookie is httpOnly + SameSite=Lax; nothing secret in JS storage', cfg,
               any(c['name'] == 'steady_session' and c['httpOnly'] and c['sameSite'] == 'Lax' for c in cookies) and 'steady_session' not in A.evaluate("document.cookie"), str([(c['name'], c['httpOnly']) for c in cookies]))
        shot_and_audit(A, 'sync-signed-in', cfg, run_axe=True)
        record('server: records stored, scoped to the owner (RLS hides them without the owner scope)', cfg,
               int(sql("select count(*) from records")) >= 3 and sql("select count(*) from records", as_owner=False) == '0')

        go(A, 'today'); A.fill('#qa', 'Shared task from laptop'); A.press('#qa', 'Enter')
        A.evaluate("import('./js/data/store.js').then(s => s.save('thoughts', {id:'th-shared', text:'Shared thought #sync', tags:['sync'], mood:3, kind:'note'}))")
        A.evaluate("window.__steady.syncNow('test')"); A.wait_for_timeout(400)

        # device B: wrong passphrase, then sign in from onboarding
        B.click('[data-ob-pair]'); B.wait_for_selector('[data-testid=passphrase]')
        B.fill('[data-testid=passphrase]', 'not the passphrase'); B.click('[data-testid=passphrase-go]')
        B.wait_for_function("document.querySelector('#si-err')?.textContent.length > 0")
        shot_and_audit(B, 'sync-wrong-passphrase', cfg)
        record('auth: wrong passphrase is refused', cfg, 'not right' in B.inner_text('#si-err'))
        B.fill('[data-testid=passphrase]', PASSPHRASE); B.click('[data-testid=passphrase-go]')
        B.wait_for_selector('#qa', timeout=20000); B.wait_for_timeout(800)
        b_has = B.evaluate("window.__steady.all('tasks').some(t=>t.title==='Shared task from laptop')")
        record('sync: second device signs in and receives data + profile', cfg, b_has and 'Karthik' in B.inner_text('.page-head'), B.inner_text('.page-head')[:80])
        shot_and_audit(B, 'sync-device-b-today', cfg)

        # both offline, edit, delete, conflict
        cA.set_offline(True); cB.set_offline(True)
        A.fill('#qa', 'Laptop offline task'); A.press('#qa', 'Enter'); A.wait_for_timeout(120)
        A.click('.task:has-text("Shared task from laptop") .check'); A.wait_for_timeout(120)
        B.fill('#qa', 'Phone offline task'); B.press('#qa', 'Enter'); B.wait_for_timeout(120)
        B.evaluate("import('./js/data/store.js').then(s => s.remove('thoughts', 'th-shared'))")
        B.evaluate("import('./js/data/store.js').then(s => { const t = s.all('tasks').find(t=>t.title==='Shared task from laptop'); return s.save('tasks', {...t, title:'Shared task (edited on phone)'}); })")
        B.wait_for_timeout(300)
        go(B, 'you'); shot_and_audit(B, 'sync-offline', cfg)
        offline_txt = B.inner_text('[data-testid=sync-status]') if B.locator('[data-testid=sync-status]').count() else ''
        cA.set_offline(False); cB.set_offline(False)
        ra = A.evaluate("window.__steady.syncNow('test')"); rb = B.evaluate("window.__steady.syncNow('test')"); ra2 = A.evaluate("window.__steady.syncNow('test')")
        def state(p): return p.evaluate("(() => { const s = window.__steady; return { tasks: s.all('tasks').map(t => t.title + ':' + t.status).sort(), thoughts: s.all('thoughts').map(t=>t.id).sort() }; })()")
        sa, sb = state(A), state(B)
        ok = sa == sb and 'Laptop offline task:open' in sa['tasks'] and 'Phone offline task:open' in sa['tasks'] and 'th-shared' not in sa['thoughts'] \
             and any(t.startswith('Shared task (edited on phone)') for t in sa['tasks'])
        record('sync: offline edits on both devices merge (per-record LWW, tombstones)', cfg, ok and ra and rb and ra2, f'A={sa} B={sb}')
        record('sync: offline state is shown and changes wait in a queue', cfg, 'Offline' in offline_txt or 'waiting' in offline_txt, offline_txt)
        record('server: tombstone stored for the deleted thought', cfg, sql("select deleted from records where coll='thoughts' and id='th-shared'") == 't')

        # near-realtime: B adds, A pulls on its next focus/poll
        go(B, 'today'); B.fill('#qa', 'Auto-sync task'); B.press('#qa', 'Enter'); B.wait_for_timeout(3500)
        A.evaluate("window.dispatchEvent(new Event('focus'))"); A.evaluate("window.__steady.syncNow('poll')"); A.wait_for_timeout(300)
        record('sync: debounced auto-push + pull reaches the other device', cfg, A.evaluate("window.__steady.all('tasks').some(t=>t.title==='Auto-sync task')"))

        # reminders queue for Web Push
        t2 = A.evaluate("(() => { const d = new Date(Date.now() + 2*3600e3 + 120e3); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); })()")
        same_day = A.evaluate("new Date(Date.now()+2*3600e3+120e3).toDateString() === new Date().toDateString()")
        go(A, 'today'); A.fill('#qa', f'Push probe at {t2}' + ('' if same_day else ' tomorrow')); A.press('#qa', 'Enter')
        A.evaluate("window.__steady.syncNow('test')"); A.wait_for_timeout(300); A.evaluate("window.__steady.reconcileRemote()"); A.wait_for_timeout(500)
        tid = A.evaluate("window.__steady.all('tasks').find(t=>t.title==='Push probe').id")
        row = sql(f"select title from scheduled_notifications where key='st-{tid}'")
        record('push: a timed task is queued server-side for Web Push (st-<id>)', cfg, row == 'Push probe', row)
        A.click('.task:has-text("Push probe") .check'); A.wait_for_timeout(200)
        A.evaluate("window.__steady.syncNow('test')"); A.wait_for_timeout(300); A.evaluate("window.__steady.reconcileRemote()"); A.wait_for_timeout(500)
        record('push: completing the task removes the queued reminder', cfg, sql(f"select count(*) from scheduled_notifications where key='st-{tid}'") == '0')

        # Hark read-only key from the UI
        go(A, 'you'); A.click('[data-testid=hark-token]'); A.wait_for_selector('[data-testid=hark-token-value]')
        tok = A.input_value('[data-testid=hark-token-value]'); shot_and_audit(A, 'sheet-hark-key', cfg)
        r = NOPROXY.open(urllib.request.Request(API_BASE + 'api/hark/export', headers={'Authorization': f'Bearer {tok}'}))
        doc = json.loads(r.read())
        record('hark: read-only key exports the same data contract', cfg, doc['readOnly'] and any(t.get('title') == 'Auto-sync task' for t in doc['data']['tasks'].values()) and 'th-shared' not in doc['data']['thoughts'])
        close_sheets(A)

        # session revoked server-side -> app says so, keeps local data
        sql("delete from sessions")
        A.evaluate("window.__steady.syncNow('test')"); A.wait_for_timeout(400); go(A, 'you')
        txt = A.inner_text('#sec-sync'); shot_and_audit(A, 'sync-session-ended', cfg)
        record('auth: ended session is detected; local data kept; prompt to sign in', cfg, 'Sign in' in txt and A.evaluate("window.__steady.all('tasks').length") > 3, txt[:120])
        # a stranger can't sign in even with a valid-looking request
        req = urllib.request.Request(API_BASE + 'api/auth/passphrase', data=b'{"passphrase":"guess guess guess"}', headers={'Content-Type': 'application/json', 'X-Steady': '1'}, method='POST')
        try: NOPROXY.open(req); code = 200
        except urllib.error.HTTPError as e: code = e.code
        record('auth: unauthenticated API access is refused', cfg, code in (401, 429))
    finally:
        if cA: cA.close()
        if cB: cB.close()
        proc.terminate()

def test_pwa(browser):
    cfg = 'desktop-light'
    c, pg = new_ctx(browser, 'desktop')
    onboard(pg)
    man = pg.evaluate("fetch('manifest.webmanifest').then(r=>r.json())")
    icons_ok = all(pg.evaluate(f"fetch('{i['src']}').then(r=>r.ok)") for i in man['icons'])
    pg.evaluate("navigator.serviceWorker.ready"); pg.reload(); pg.wait_for_selector('#qa'); pg.wait_for_timeout(500)
    cdp = c.new_cdp_session(pg)
    errs = cdp.send('Page.getInstallabilityErrors')
    mf = cdp.send('Page.getAppManifest')
    has512 = any('512' in i['sizes'] for i in man['icons']); maskable = any(i.get('purpose') == 'maskable' for i in man['icons'])
    ok = not errs.get('installabilityErrors') and man['display'] == 'standalone' and has512 and maskable and icons_ok and not mf.get('errors')
    record('PWA installability (Chrome DevTools Page.getInstallabilityErrors) + manifest + icons', cfg, ok, json.dumps({'errors': errs, 'manifestErrors': mf.get('errors')})[:400])
    shot_and_audit(pg, 'desktop-today-empty', cfg)
    c.close()

def ui_screens_small_desktop(browser):
    """Populated screens at every size/theme for the visual pass."""
    for vp in ['mobile', 'small', 'desktop']:
        for scheme in ['light', 'dark']:
            cfg = f'{vp}-{scheme}'
            c, pg = new_ctx(browser, vp, scheme, fixed_time='2026-10-16T21:30:00+05:30')
            onboard(pg); pg.wait_for_timeout(4200); seed(pg, 30)
            for r in ['today', 'goals', 'thoughts', 'insights', 'you']:
                go(pg, r); shot_and_audit(pg, f'screen-{r}', cfg, run_axe=(r in ('today', 'insights') and vp == 'mobile'))
            go(pg, 'goals'); pg.click('.goal [data-act=goal-edit]'); pg.wait_for_selector('#gf'); shot_and_audit(pg, 'screen-goal-sheet', cfg); close_sheets(pg)
            go(pg, 'today'); pg.click('.task .t-main'); pg.wait_for_selector('#tf'); shot_and_audit(pg, 'screen-task-sheet', cfg); close_sheets(pg)
            mine = [x for x in AUDITS if x['config'] == cfg and x['screen'].startswith('screen-')]
            bad = [x['screen'] for x in mine if x['layout_issues'] or any(v['impact'] in ('serious', 'critical') for v in x.get('axe', []))]
            record('populated screens + sheets render cleanly (layout audit, axe)', cfg, not bad and len(mine) == 7, bad)
            c.close()

# ---------------------------------------------------------------- run
with sync_playwright() as p:
    browser = p.chromium.launch()
    net_browser = p.chromium.launch(proxy=PROXY) if PROXY else browser  # only for tests that hit the real internet from the page
    suites = []
    for vp in ['mobile', 'small', 'desktop']:
        for scheme in ['light', 'dark']:
            if want('core') or want(f'core-{vp}-{scheme}'):
                suites.append((f'core-{vp}-{scheme}', lambda vp=vp, scheme=scheme: core_flow(browser, vp, scheme)))
    if want('screens'): suites.append(('screens', lambda: ui_screens_small_desktop(browser)))
    if want('export'): suites.append(('export', lambda: test_export_import(browser)))
    if want('offline'): suites.append(('offline', lambda: test_offline(browser)))
    if want('notif'):
        # the old headless shell reports Notification.permission as 'denied' even when granted; use full Chromium (new headless)
        nb = p.chromium.launch(channel='chromium')
        suites.append(('notif', lambda: test_notifications(nb)))
    if want('ntfy'): suites.append(('ntfy', lambda: test_ntfy(net_browser)))
    if want('sync'): suites.append(('sync', lambda: test_sync(browser)))
    if want('pwa'): suites.append(('pwa', lambda: test_pwa(browser)))
    for name, fn in suites:
        try: fn()
        except Exception as e:
            record(f'suite {name} crashed', name, False, ''.join(traceback.format_exception_only(type(e), e)).strip()[:500])
    browser.close()

out = os.path.join(HERE, 'results.json')
prev = {}
if args.only and os.path.exists(out):
    prev = json.load(open(out))
json.dump({'results': RESULTS, 'audits': AUDITS, 'ranAt': time.strftime('%Y-%m-%d %H:%M:%S'), 'only': args.only}, open(out if not args.only else out.replace('.json', f'-{args.only.replace(",", "_")}.json'), 'w'), indent=1)
fails = [r for r in RESULTS if not r['pass']]
print(f"\n{len(RESULTS) - len(fails)}/{len(RESULTS)} passed")
issues = [(a['config'], a['screen'], a['layout_issues']) for a in AUDITS if a['layout_issues']]
print(f'screens with layout issues: {len(issues)}')
for i in issues[:40]: print('  ', i)
axev = {}
for a in AUDITS:
    for v in a.get('axe', []): axev.setdefault((v['id'], v['impact'], v['help']), []).append(f"{a['config']}/{a['screen']}: {v['targets'][:2]}")
print(f'axe violation types: {len(axev)}')
for k, v in axev.items(): print('  ', k, v[:3])
