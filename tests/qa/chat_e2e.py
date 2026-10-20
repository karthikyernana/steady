# Chat (agent layer, phase 1), end to end in real Chromium against the local stack with the AI mock as Groq:
#   node tests/mocks/ai-mock.mjs 8791 &
#   DATABASE_URL=… PORT=8790 GROQ_API_KEY=mock GROQ_BASE_URL=http://127.0.0.1:8791/openai/v1 \
#     SARVAM_API_KEY=mock SARVAM_BASE_URL=http://127.0.0.1:8791 GEMINI_API_KEY=mock GEMINI_BASE_URL=http://127.0.0.1:8791 node scripts/dev-server.mjs &
#   SHOTS=/path/for/pngs python3 tests/qa/chat_e2e.py http://localhost:8790/
# Phone (390 px): the floating Ask button (TAP opens Chat, HOLD is still the voice agent: record → transcribe → drafts),
# still 5 tabs and no chat button in the top bar, Chat risen from the bottom with every control in the thumb zone
# (History · New · Close above the composer, the mic inside it), signed-out message, sign up, seeded data, questions that
# produce all 11 card kinds with figures computed from the seeded rows, history as a bottom sheet (new / reopen / delete),
# the composer mic dictating (fake microphone + mock STT; nothing saved), offline message, closing by Close / swipe-down /
# Back / Esc, the thread bottom-anchored (few messages sit on the composer) with auto-follow + a "Latest" pill, switching
# chats while an answer is pending (slow mock), calm error text (no raw provider text), a "show me as a graph" follow-up.
# Laptop (1366 px): Chat is a panel docked bottom-right (opened by Ask or the side rail), history inside it, resizable.
import os, sys, time, json, urllib.request
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
WAV = os.path.normpath(os.path.join(HERE, '..', 'fixtures', 'voice-te-mixed.wav'))
SHOTS = os.environ.get('SHOTS')
MOCK = os.environ.get('MOCK', 'http://127.0.0.1:8791')
def mock(state):
    urllib.request.build_opener(urllib.request.ProxyHandler({})).open(urllib.request.Request(MOCK + '/__mock/state', data=json.dumps(state).encode(), method='POST', headers={'content-type': 'application/json'}), timeout=3).read()
KINDS = ['stat', 'line', 'bar', 'donut', 'heatmap', 'progresslist', 'tasklist', 'timeline', 'table', 'note', 'callout']

SEED = """async () => {
  const day = n => { const d = new Date(Date.now() + 5.5 * 36e5 + n * 864e5); return d.toISOString().slice(0, 10); };
  const wd = (new Date(Date.now() + 5.5 * 36e5).getUTCDay() + 6) % 7;       // days since Monday (IST)
  const now = Date.now(), recs = [];
  const add = (coll, data) => recs.push({ coll, id: data.id, updatedAt: now, schemaVersion: 2, data: { ...data, updatedAt: now, createdAt: data.createdAt || now } });
  const spends = [[0, 250, 'Food', 'Lunch', 'Swiggy'], [0, 80, 'Transport', 'Auto', 'Rapido'], [-1, 499, 'Shopping', 'T-shirt', 'AJIO'], [-2, 120, 'Food', 'Chai and snacks', null],
    [-3, 1200, 'Bills', 'Jio recharge', 'Jio'], [-5, 340, 'Groceries', 'Milk, eggs', 'Blinkit'], [-8, 150, 'Food', 'Dinner', null], [-12, 60, 'Transport', 'Bus', null]];
  spends.forEach(([d, amount, category, note, payee], i) => add('money', { id: 'qm' + i, kind: 'expense', amount, category, note, payee, date: day(d), source: 'manual' }));
  add('money', { id: 'qmi', kind: 'income', amount: 5000, category: 'Stipend', note: 'October stipend', date: day(-6) });
  add('goals', { id: 'qg1', title: 'Land my first paying client', why: 'Freedom', target: day(60), order: 0,
    milestones: [{ id: 'a', title: 'Portfolio live', week: day(-14), done: true }, { id: 'b', title: '10 cold DMs', week: day(-7), done: true }, { id: 'c', title: 'First call', week: day(0), done: false }, { id: 'd', title: 'Proposal', week: day(7), done: false }], actions: [] });
  add('goals', { id: 'qg2', title: 'DSA 150', why: 'Placements', target: day(40), order: 1,
    milestones: [{ id: 'e', title: 'Arrays', week: day(-7), done: true }, { id: 'f', title: 'Graphs', week: day(0), done: false }, { id: 'g', title: 'DP', week: day(7), done: false }], actions: [] });
  for (let i = 0; i < 24; i++) { const d = -Math.floor(i * 1.6); add('tasks', { id: 'qd' + i, title: ['DSA: 2 problems', 'Gym', 'Post on LinkedIn', 'Cold DM x3'][i % 4], status: 'done', priority: 2,
    dueDate: day(d), doneAt: Date.parse(day(d) + 'T' + String(8 + (i % 5) * 2).padStart(2, '0') + ':15:00+05:30'), goalId: i % 4 === 0 ? 'qg2' : i % 4 === 3 ? 'qg1' : null }); }
  add('tasks', { id: 'qo1', title: 'Send proposal to Ravi', status: 'open', priority: 3, dueDate: day(1), dueTime: '11:00', goalId: 'qg1' });
  add('tasks', { id: 'qo2', title: 'Pay hostel fee', status: 'open', priority: 2, dueDate: day(3), dueTime: null });
  add('tasks', { id: 'qo3', title: 'Mock interview', status: 'open', priority: 2, dueDate: day(0), dueTime: '18:30', goalId: 'qg2' });
  add('thoughts', { id: 'qt1', text: 'idea: a weekly money summary every Sunday #steady', tags: ['steady'], mood: 4, kind: 'idea', createdAt: now - 2 * 864e5 });
  add('thoughts', { id: 'qt2', text: 'Small days still count. Did 1 DSA problem and it felt fine.', tags: [], mood: 3, kind: 'journal', createdAt: now - 864e5 });
  add('thoughts', { id: 'qt3', text: 'Pricing idea for the agency: start with a fixed audit #clients', tags: ['clients'], mood: 4, kind: 'idea', createdAt: now - 5 * 864e5 });
  const r = await fetch('/api/sync/push', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-steady': '1' }, body: JSON.stringify({ records: recs }) });
  await window.__steady.syncNow('qa');
  const wk = spends.filter(s => -s[0] <= wd).reduce((t, s) => t + s[1], 0);
  return { status: r.status, weekSpend: wk };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-audio-capture={WAV}'])
    def mk(vp, mobile, scheme='light'):
        c = b.new_context(viewport=vp, has_touch=mobile, is_mobile=mobile, device_scale_factor=2, color_scheme=scheme, timezone_id='Asia/Kolkata', service_workers='block', permissions=['microphone'])
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.goto(BASE); pg.wait_for_selector('.onboarding, .shell'); return c, pg
    def shot(pg, name, full=False):
        if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=f'{SHOTS}/{name}.png', full_page=full)
    def agent_count(pg): return pg.locator('[data-testid=chat-msg-agent]').count()
    def scroll_to(pg, y): pg.evaluate(f"(() => {{ const s = document.querySelector('.chat-scroll'); s.scrollTop = {y}; }})()")
    def gap_to_dock(pg):   # px between the newest message and the top of the dock (bottom-anchored thread)
        return pg.evaluate("(() => { const m = [...document.querySelectorAll('.chat-thread > .cm')].at(-1), d = document.querySelector('[data-testid=chat-dock]'); return Math.round(d.getBoundingClientRect().top - m.getBoundingClientRect().bottom); })()")
    def ask(pg, q):
        n = agent_count(pg)
        pg.fill('#chat-input', q); pg.click('[data-testid=chat-send]')
        pg.wait_for_function(f"document.querySelectorAll('[data-testid=chat-msg-agent]').length > {n}", timeout=15000)
        pg.wait_for_timeout(250)
        return pg.locator('[data-testid=chat-msg-agent]').nth(n)

    A, a = mk({'width': 390, 'height': 844}, True); onboard(a)
    rec('bottom bar stays at exactly 5 tabs', a.locator('.tabbar .tab').count() == 5, str(a.eval_on_selector_all('.tabbar .tab span', 'e => e.map(x => x.textContent)')))
    rec('no chat button in the top bar; K / You stays top right', a.locator('.topbar [data-testid=chat-btn]').count() == 0 and a.locator('.topbar [data-testid=you-btn]').count() == 1)
    btn = a.locator('#ask-fab')
    bb = btn.bounding_box(); vw, vh = 390, 844
    rec('Ask: one floating button, bottom-right in the thumb zone, ≥ 44 px', bb['width'] >= 44 and bb['height'] >= 44 and bb['x'] + bb['width'] > vw - 40 and bb['y'] > vh * 0.7, str(bb))
    rec('Ask is labelled and says both actions', 'Ask' in btn.inner_text() and 'hold' in (btn.get_attribute('aria-label') or '').lower(), btn.get_attribute('aria-label'))
    try: a.wait_for_selector('[data-testid=ask-hint].show', timeout=6000)
    except Exception: pass
    rec('first run: a hint says tap to ask, hold to talk', a.locator('[data-testid=ask-hint]').count() == 1 and 'Hold' in a.inner_text('[data-testid=ask-hint]'))
    btn.click(); a.wait_for_selector('[data-testid=chat-main]'); a.wait_for_timeout(450)
    rec('tap Ask opens Chat', a.evaluate("location.hash") == '#/chat')
    pb = a.locator('[data-testid=chat-panel]').bounding_box()
    rec('Chat is a full-height sheet over the app (covers the bars); Ask steps away', pb['x'] == 0 and pb['y'] == 0 and pb['width'] == 390 and abs(pb['height'] - 844) <= 1 and not a.locator('#ask-fab').is_visible(), str(pb))
    rec('header holds only the title', a.locator('[data-testid=chat-head] button, [data-testid=chat-head] a').count() == 0 and a.locator('[data-testid=chat-title]').count() == 1)
    zone = a.evaluate("(() => ['chat-hist-btn', 'chat-new', 'chat-close', 'chat-mic', 'chat-send', 'chat-composer'].map(t => { const r = document.querySelector(`[data-testid=${t}]`).getBoundingClientRect(); return [t, Math.round(r.top), Math.round(r.bottom), Math.round(r.height)]; }))()")
    rec('History, New, Close, mic and send all sit in the bottom thumb zone', all(t >= vh * 0.75 and b <= vh and h >= 44 for _, t, b, h in zone), str(zone))
    cb = a.locator('[data-testid=chat-composer]').bounding_box(), a.locator('[data-testid=chat-mic]').bounding_box()
    rec('the mic sits inside the composer', cb[0]['x'] <= cb[1]['x'] and cb[1]['x'] + cb[1]['width'] <= cb[0]['x'] + cb[0]['width'] + 1)
    rec('composer row sits at the bottom edge (safe area aware)', vh - (cb[0]['y'] + cb[0]['height']) <= 24, str(vh - (cb[0]['y'] + cb[0]['height'])))
    rec('signed out: a calm "needs your account" message', a.locator('[data-testid=chat-blocked]').count() == 1 and 'sign in' in a.inner_text('[data-testid=chat-blocked]').lower())
    rec('signed out: composer disabled', a.is_disabled('#chat-input'))
    shot(a, 'web-chat-signed-out')
    open_signin(a); a.fill('[data-testid=si-email]', EMAIL); a.click('[data-testid=si-continue]'); a.wait_for_selector('[data-testid=si-new-password]')
    a.fill('[data-testid=si-new-password]', PW); a.fill('[data-testid=si-confirm]', PW); a.click('[data-testid=si-create]'); a.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    seeded = a.evaluate(SEED); rec('seeded data pushed + synced', seeded['status'] == 200, json.dumps(seeded))
    a.wait_for_selector('.sheet-wrap', state='detached', timeout=5000); a.wait_for_timeout(2600)   # sign-in sheet + toast gone
    # HOLD Ask (on Today): the voice agent exactly as before: records while held, release → transcribe → drafts → Accept
    a.evaluate("location.hash='#/today'"); a.wait_for_selector('#qa'); a.wait_for_timeout(500)
    before_rows = a.evaluate("window.__steady.all('money').length + window.__steady.all('tasks').length")
    hb = a.locator('#ask-fab').bounding_box(); a.mouse.move(hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2); a.mouse.down()
    a.wait_for_selector('[data-testid=voice-sheet][data-state=listening]', timeout=5000); a.wait_for_timeout(2200)
    rec('hold Ask: records (voice sheet listening), Chat does not open', a.evaluate("location.hash") != '#/chat' and a.locator('[data-testid=voice-sheet][data-state=listening]').count() == 1)
    rec('hold Ask: the button shows it is holding', 'holding' in (a.get_attribute('#ask-fab', 'class') or ''))
    a.mouse.up()
    try: a.wait_for_selector('.dcard[data-type]', timeout=15000)
    except Exception: pass
    rec('release: transcribed into draft cards (nothing written yet)', a.locator('.dcard[data-type]').count() >= 1 and a.evaluate("window.__steady.all('money').length + window.__steady.all('tasks').length") == before_rows, str(a.locator('.dcard[data-type]').count()))
    rec('after the first hold the hint is gone for good', a.locator('[data-testid=ask-hint]').count() == 0 and a.evaluate("import('./js/data/store.js').then(m => !!m.local('askHeld'))"))
    a.keyboard.press('Escape'); a.wait_for_selector('[data-testid=voice-sheet]', state='detached', timeout=5000); a.wait_for_timeout(300)
    rec('Esc on the drafts closes the sheet only (still on Today, nothing saved)', a.evaluate("location.hash") == '#/today' and a.evaluate("window.__steady.all('money').length + window.__steady.all('tasks').length") == before_rows)
    a.click('#ask-fab'); a.wait_for_selector('.chat-empty', timeout=8000); a.wait_for_timeout(400)
    sugg = a.eval_on_selector_all('[data-act=chat-suggest]', 'e => e.map(x => x.textContent)')
    rec('empty chat offers chart-worthy suggestions', len(sugg) == 4 and 'Spending by category this month' in sugg and any('write about' in x for x in sugg), str(sugg))
    a.click('[data-act=chat-suggest][data-fill]'); a.wait_for_timeout(150)
    rec('"What did I write about…" fills the box for you to finish (sends nothing)', a.input_value('#chat-input') == 'What did I write about ' and agent_count(a) == 0, a.input_value('#chat-input'))
    a.fill('#chat-input', '')
    shot(a, 'web-chat-empty')

    # 1. spend this week → Stat (figure from rows) + Donut; the bogus "Script" card and made-up numbers are gone
    m1 = ask(a, 'How much did I spend this week?')
    gap = gap_to_dock(a)
    rec('bottom-anchored: a short chat sits right above the composer', 0 <= gap <= 40, f'{gap}px')
    um = a.locator('[data-testid=chat-msg-user]').first.bounding_box()
    rec('bottom-anchored: the question is low on the screen, not stuck at the top', um['y'] > 844 * 0.25, str(round(um['y'])))
    val = m1.locator('[data-testid=card-stat] [data-testid=cc-value]').inner_text()
    want = '₹' + f"{seeded['weekSpend']:,}"
    rec('Stat shows the real week total from the rows', val == want, f'{val} vs {want}')
    rec('Donut by category rendered natively (SVG)', m1.locator('[data-testid=card-donut] svg circle.cc-seg').count() >= 1)
    html1 = m1.inner_html()
    rec('model-invented numbers and components never render', '999999' not in html1 and '123456' not in html1 and 'Fake' not in html1 and 'alert' not in html1)
    rec('chat title becomes the question', 'spend this week' in a.inner_text('[data-testid=chat-title]'))
    # "show me that as a graph": the follow-up draws a chart
    g = ask(a, 'show me that as a graph')
    rec('"show me that as a graph" follow-up answers with a chart card', g.locator('[data-testid=card-line], [data-testid=card-bar], [data-testid=card-donut]').count() >= 1, str(g.locator('[data-testid^=card-]').count()))
    shot(a, 'web-chat-phone-spend')
    # 2-6. the other card kinds
    ask(a, 'show my spending trend')
    ask(a, 'a table of my spends this month')
    ask(a, 'how are my goals going, and what tasks are due?')
    ask(a, 'what did I write about idea?')
    ask(a, 'how is my streak?')
    present = [k for k in KINDS if a.locator(f'[data-testid=card-{k}]').count()]
    rec('all 11 card kinds render natively', present == KINDS, f'{len(present)}/11 missing={sorted(set(KINDS) - set(present))}')
    tl = a.inner_text('[data-testid=card-timeline]') if a.locator('[data-testid=card-timeline]').count() else ''
    rec('search_thoughts found the seeded idea', 'weekly money summary' in tl or 'Pricing idea' in tl, tl[:120].replace('\n', ' | '))
    pl = a.inner_text('[data-testid=card-progresslist]')
    rec('ProgressList: milestones from the goals', '2/4' in pl and '1/3' in pl, pl.replace('\n', ' | '))
    ov = a.evaluate("Math.max(document.documentElement.scrollWidth - innerWidth, (s => s.scrollWidth - s.clientWidth)(document.querySelector('.chat-scroll')))")
    rec('no horizontal overflow at 390 px', ov <= 0, str(ov))
    # nothing floats over the dock: the composer spans the width, Ask is hidden while Chat is open
    cbox = a.locator('#chat-form').bounding_box()
    rec('composer spans the width; no floating button over it', cbox['width'] >= 390 - 40 and not a.locator('#ask-fab').is_visible(), f'{cbox["width"]:.0f}')
    end = a.evaluate("(s => s.scrollHeight - s.scrollTop - s.clientHeight)(document.querySelector('.chat-scroll'))")
    rec('auto-scroll: after each answer the newest message is in view', end <= 48, f'{end}px from the end')
    scroll_to(a, 0); a.wait_for_timeout(200); shot(a, 'web-chat-phone-top')
    for i, k in enumerate(['line', 'table', 'progresslist', 'timeline', 'heatmap']):
        a.locator(f'[data-testid=card-{k}]').first.scroll_into_view_if_needed(); a.wait_for_timeout(150); shot(a, f'web-chat-phone-{k}')
    # scrolled up when an answer lands: you stay where you are and a "Latest" pill appears; it takes you down
    scroll_to(a, 0); a.wait_for_timeout(150)
    a.fill('#chat-input', 'slow: how is my streak?'); a.click('[data-testid=chat-send]')
    n0 = agent_count(a); a.wait_for_timeout(300); scroll_to(a, 0)
    a.wait_for_function(f"document.querySelectorAll('[data-testid=chat-msg-agent]').length > {n0}", timeout=15000); a.wait_for_timeout(300)
    top = a.evaluate("document.querySelector('.chat-scroll').scrollTop")
    rec('scrolled up: a new answer does not yank you down; "Latest" shows', top < 60 and a.locator('[data-testid=chat-jump]').is_visible(), f'top={top}')
    a.click('[data-testid=chat-jump]'); a.wait_for_timeout(700)
    end = a.evaluate("(s => s.scrollHeight - s.scrollTop - s.clientHeight)(document.querySelector('.chat-scroll'))")
    rec('"Latest" scrolls to the newest message and hides', end <= 48 and not a.locator('[data-testid=chat-jump]').is_visible(), str(end))

    # mic on Chat dictates into the composer (fake mic → mock STT), nothing is planned or saved
    before = a.evaluate("window.__steady.all('money').length")
    a.click('[data-testid=chat-mic]'); a.wait_for_selector('[data-testid=voice-sheet][data-state=listening]', timeout=5000); a.wait_for_timeout(1500)
    if a.locator('[data-testid=vx-stop]').count(): a.click('[data-testid=vx-stop]')
    a.wait_for_selector('[data-testid=voice-sheet]', state='detached', timeout=15000)
    said = a.input_value('#chat-input')
    rec('composer mic dictates into the text box', 'lunch' in said, said[:80])
    rec('dictation plans and saves nothing', a.evaluate("window.__steady.all('money').length") == before and a.locator('.dcard').count() == 0)
    a.fill('#chat-input', '')

    # history: new chat, reopen (cards re-resolved by the server), delete
    first_id = a.evaluate("window.__steadyChat.state().chat.id")
    a.click('[data-testid=chat-new]'); a.wait_for_selector('.chat-empty')
    ask(a, 'how is my streak?')
    a.click('[data-testid=chat-hist-btn]'); a.wait_for_selector('[data-testid=chat-history] li', timeout=5000); a.wait_for_timeout(400)
    n_hist = a.locator('[data-testid=chat-history] li').count()
    rec('history opens as a bottom sheet', a.locator('.chat-hist-sheet .sheet').is_visible() and a.locator('.chat-hist-sheet [data-testid=chat-history]').count() == 1)
    sb = a.locator('.chat-hist-sheet .sheet').bounding_box()
    rec('history sheet is anchored to the bottom edge', abs(sb['y'] + sb['height'] - 844) <= 2, str(sb))
    rec('history lists both chats', n_hist == 2, str(n_hist))
    shot(a, 'web-chat-phone-history')
    a.click(f'[data-act=chat-open][data-id="{first_id}"]'); a.wait_for_function(f"window.__steadyChat.state().chat?.id === '{first_id}' && !window.__steadyChat.state().opening")
    a.wait_for_timeout(300)
    rec('opening a chat closes the history sheet', a.locator('.chat-hist-sheet').count() == 0 or not a.locator('.chat-hist-sheet .sheet').is_visible())
    rec('reopened chat restores every message', agent_count(a) == 8, str(agent_count(a)))
    end = a.evaluate("(s => s.scrollHeight - s.scrollTop - s.clientHeight)(document.querySelector('.chat-scroll'))")
    rec('reopened chat lands on the newest message', end <= 48, str(end))
    val2 = a.locator('[data-testid=card-stat] [data-testid=cc-value]').first.inner_text()
    rec('reopened Stat recomputed from data (same rows → same figure)', val2 == want, val2)

    # offline: calm message, composer off, last chat still readable
    A.set_offline(True); a.evaluate("dispatchEvent(new Event('offline'))"); a.wait_for_selector('[data-testid=chat-blocked]', timeout=5000)
    rec('offline: a clear calm message', 'offline' in a.inner_text('[data-testid=chat-blocked]').lower() and a.is_disabled('#chat-input'))
    rec('offline: the open chat stays readable', agent_count(a) == 8)
    shot(a, 'web-chat-phone-offline')
    A.set_offline(False); a.evaluate("dispatchEvent(new Event('online'))"); a.wait_for_function("!document.querySelector('[data-testid=chat-blocked]')", timeout=8000)
    rec('back online: chat comes back by itself', not a.is_disabled('#chat-input'))

    # delete
    a.click('[data-testid=chat-hist-btn]'); a.wait_for_selector('[data-testid=chat-history] li')
    a.click(f'[data-act=chat-del][data-id="{first_id}"]'); a.click('.sheet [data-yes]'); a.wait_for_timeout(600)
    rec('delete removes it from history', a.locator(f'[data-act=chat-open][data-id="{first_id}"]').count() == 0)
    a.keyboard.press('Escape'); a.wait_for_selector('.chat-hist-sheet', state='detached', timeout=5000); a.wait_for_timeout(200)
    rec('Esc closes the history sheet, not Chat', a.evaluate("location.hash") == '#/chat')

    # switching chats while an answer is pending: the slow question keeps running in ITS chat, the UI never blocks
    a.click('[data-testid=chat-new]'); a.wait_for_selector('.chat-empty')
    a.fill('#chat-input', 'slow: how are my goals going?'); a.click('[data-testid=chat-send]')
    a.wait_for_selector('[data-testid=chat-wait]'); slow_key = a.evaluate("window.__steadyChat.state().cur")
    rec('pending: New stays available', a.is_enabled('[data-testid=chat-new]'))
    rec('a new chat is titled by its question while it answers', 'slow: how are my goals going?' in a.inner_text('[data-testid=chat-title]'))
    rec('phones: the sheet is modal (the app underneath is inert)', a.evaluate("document.getElementById('app').inert && document.getElementById('chat-panel').getAttribute('aria-modal') === 'true'"))
    a.click('[data-testid=chat-new]'); a.wait_for_selector('.chat-empty', timeout=3000)
    rec('pending: New opens an empty chat at once (no waiting indicator here)', a.locator('[data-testid=chat-wait]').count() == 0 and a.evaluate("window.__steadyChat.state().cur") != slow_key)
    a.click('[data-testid=chat-hist-btn]'); a.wait_for_selector('.chat-hist-sheet [data-testid=chat-history]')
    rec('History shows the pending chat as answering', a.locator('.chat-hist-sheet [data-testid=chat-hist-pending]').count() == 1)
    shot(a, 'web-chat-phone-switch-pending')
    a.keyboard.press('Escape'); a.wait_for_selector('.chat-hist-sheet', state='detached', timeout=5000)
    m_other = ask(a, 'how much did I spend this week?')
    rec('pending: the composer works in another chat at the same time', m_other.locator('[data-testid=card-stat]').count() == 1 and agent_count(a) == 1)
    other_key = a.evaluate("window.__steadyChat.state().cur")
    a.wait_for_function(f"window.__steadyChat.state().convs.find(c => c.key === '{slow_key}' && !c.pending && c.n === 2)", timeout=20000); a.wait_for_timeout(300)
    rec('the slow answer landed in its own chat, not the one on screen', agent_count(a) == 1 and a.locator('[data-testid=card-progresslist]').count() == 0 and a.evaluate("window.__steadyChat.state().cur") == other_key)
    rec('its chat is marked as having a new answer', a.evaluate(f"window.__steadyChat.state().convs.find(c => c.key === '{slow_key}').unread") and 'has-news' in (a.get_attribute('[data-testid=chat-hist-btn]', 'class') or ''))
    a.click('[data-testid=chat-hist-btn]'); a.wait_for_selector('.chat-hist-sheet [data-testid=chat-history]'); a.wait_for_timeout(300)
    a.click('.chat-hist-sheet li.unread .chat-hist-item'); a.wait_for_timeout(900)
    rec('returning to it shows exactly one question and its answer (nothing lost or doubled)', agent_count(a) == 1 and a.locator('[data-testid=chat-msg-user]').count() == 1 and a.locator('[data-testid=card-progresslist]').count() == 1, f'{agent_count(a)} answers')
    a.click('[data-testid=chat-hist-btn]'); a.wait_for_selector('.chat-hist-sheet [data-testid=chat-history]'); a.wait_for_timeout(200)
    a.click(f'.chat-hist-sheet [data-act=chat-open][data-id="{a.evaluate("window.__steadyChat.state().convs.find(c => c.key === %r).id" % other_key)}"]'); a.wait_for_timeout(800)
    rec('switching back restores the other chat as it was', agent_count(a) == 1 and a.locator('[data-testid=card-stat]').count() == 1)

    # errors: raw provider text never shows; a calm line + Try again (debug detail stays in the console)
    def fail_once(route):
        route.fulfill(status=502, content_type='application/json', body=json.dumps({'error': 'I could not reach a model right now. Try again in a minute. [groq 429: Rate limit reached for model openai/gpt-oss-120b in organization org_x on tokens per minute (TPM): Limit 8000]'}))
    a.route('**/api/agent/chat', fail_once)
    a.fill('#chat-input', 'how is my streak?'); a.click('[data-testid=chat-send]'); a.wait_for_selector('[data-testid=chat-error]', timeout=8000)
    et = a.inner_text('[data-testid=chat-error]')
    rec('error: one calm line, no raw provider text', 'Busy right now' in et and '[' not in et and 'groq' not in et.lower() and '429' not in et, et.replace('\n', ' | '))
    rec('error: Try again offered and the question is back in the box', a.locator('[data-testid=chat-retry]').count() == 1 and a.input_value('#chat-input') == 'how is my streak?')
    a.unroute('**/api/agent/chat')
    n0 = agent_count(a); a.click('[data-testid=chat-retry]')
    a.wait_for_function(f"document.querySelectorAll('[data-testid=chat-msg-agent]').length > {n0}", timeout=15000); a.wait_for_timeout(300)
    rec('Try again sends it once and clears the error', a.locator('[data-testid=chat-error]').count() == 0 and a.locator('[data-testid=chat-msg-user]').count() == 2 and a.input_value('#chat-input') == '')

    # rename from History
    a.click('[data-testid=chat-hist-btn]'); a.wait_for_selector('.chat-hist-sheet [data-testid=chat-history]'); a.wait_for_timeout(300)
    a.locator('.chat-hist-sheet [data-act=chat-rename]').first.click(); a.wait_for_selector('[data-testid=chat-rename-input]')
    a.fill('[data-testid=chat-rename-input]', 'Money check'); a.click('[data-testid=chat-rename-save]'); a.wait_for_timeout(500)
    rec('rename: the new name shows in History', 'Money check' in a.inner_text('.chat-hist-sheet [data-testid=chat-history]'))
    a.keyboard.press('Escape'); a.wait_for_selector('.chat-hist-sheet', state='detached', timeout=5000); a.wait_for_timeout(200)

    # closing from the bottom: Close (back to where you were), swipe the header down, Android-style Back, Esc
    a.click('[data-testid=chat-close]'); a.wait_for_selector('#qa', timeout=5000); a.wait_for_timeout(300)
    rec('Close returns to Today with the five tabs and Ask', a.evaluate("location.hash") == '#/today' and a.locator('.tabbar').is_visible() and a.locator('#ask-fab').is_visible())
    a.evaluate("location.hash='#/money'"); a.wait_for_timeout(500); a.click('#ask-fab'); a.wait_for_selector('[data-testid=chat-head]'); a.wait_for_timeout(450)
    hd = a.locator('[data-testid=chat-head]').bounding_box(); x, y = hd['x'] + hd['width'] / 2, hd['y'] + 20
    a.mouse.move(x, y); a.mouse.down()
    for i in range(1, 9): a.mouse.move(x, y + i * 20); a.wait_for_timeout(16)
    a.mouse.up(); a.wait_for_timeout(500)
    rec('swipe the header down closes Chat (back to Money)', a.evaluate("location.hash") == '#/money', a.evaluate("location.hash"))
    a.click('#ask-fab'); a.wait_for_selector('[data-testid=chat-head]'); a.wait_for_timeout(300)
    a.go_back(); a.wait_for_timeout(500)
    rec('Back closes Chat', a.evaluate("location.hash") == '#/money')
    a.click('#ask-fab'); a.wait_for_selector('[data-testid=chat-head]'); a.wait_for_timeout(300)
    a.evaluate("document.activeElement?.blur()"); a.keyboard.press('Escape'); a.wait_for_timeout(500)
    rec('Esc closes Chat', a.evaluate("location.hash") == '#/money')

    # dark theme on the phone
    D, d = mk({'width': 390, 'height': 844}, True, 'dark'); onboard(d)
    open_signin(d); d.fill('[data-testid=si-email]', EMAIL); d.click('[data-testid=si-continue]'); d.wait_for_selector('[data-testid=si-password]')
    d.fill('[data-testid=si-password]', PW); d.click('[data-testid=si-login]'); d.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    d.wait_for_selector('.sheet-wrap', state='detached', timeout=5000); d.evaluate("location.hash='#/today'"); d.wait_for_timeout(400)
    d.click('#ask-fab'); d.wait_for_selector('[data-testid=chat-main]'); d.wait_for_timeout(500)
    ask(d, 'how much did I spend this week?'); ask(d, 'how is my streak?')
    d.locator('[data-testid=card-donut]').first.scroll_into_view_if_needed(); d.evaluate("window.scrollBy(0, -120)"); d.wait_for_timeout(200); shot(d, 'web-chat-phone-dark')

    # laptop
    L, l = mk({'width': 1366, 'height': 820}, False); onboard(l, 'Karthik laptop')
    open_signin(l); l.fill('[data-testid=si-email]', EMAIL); l.click('[data-testid=si-continue]'); l.wait_for_selector('[data-testid=si-password]')
    l.fill('[data-testid=si-password]', PW); l.click('[data-testid=si-login]'); l.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    rec('desktop: Chat in the side rail above You', l.locator('.side [data-testid=chat-btn]').count() == 1)
    fb = l.locator('#ask-fab').bounding_box()
    rec('desktop: Ask bottom-right', fb['x'] + fb['width'] > 1366 - 60 and fb['y'] + fb['height'] > 820 - 60, str(fb))
    l.evaluate("location.hash='#/today'"); l.wait_for_selector('#qa'); l.wait_for_timeout(400)
    l.click('#ask-fab'); l.wait_for_selector('[data-testid=chat-panel]'); l.wait_for_timeout(500)
    pb = l.locator('[data-testid=chat-panel]').bounding_box()
    rec('desktop: Chat is a panel docked bottom-right (420-460 px wide, ≤ 80vh tall), not a page', 420 <= pb['width'] <= 460 and pb['height'] <= 820 * 0.8 + 2 and pb['x'] + pb['width'] >= 1366 - 40 and pb['y'] + pb['height'] >= 820 - 40, str(pb))
    rec('desktop: the page underneath stays (Today), the side rail still works', l.locator('#qa').is_visible() and l.locator('.side').is_visible() and l.evaluate("location.hash") == '#/chat')
    ctl = l.evaluate("(() => { const p = document.querySelector('[data-testid=chat-panel]').getBoundingClientRect(); return ['chat-hist-btn', 'chat-new', 'chat-close', 'chat-composer'].map(t => { const r = document.querySelector(`[data-testid=${t}]`).getBoundingClientRect(); return [t, Math.round(r.top - p.top), Math.round(p.bottom - r.bottom), r.left >= p.left && r.right <= p.right]; }); })()")
    rec('desktop: History / New / Close row and the composer sit at the bottom of the panel', all(inside and below <= 130 for _, _, below, inside in ctl), str(ctl))
    rec('desktop: Ask hidden while the panel is open', not l.locator('#ask-fab').is_visible())
    ask(l, 'how much did I spend this week?')
    gap = gap_to_dock(l)
    rec('desktop: few messages sit just above the composer (bottom-anchored)', 0 <= gap <= 40, f'{gap}px')
    ask(l, 'show my spending trend')
    end = l.evaluate("(s => s.scrollHeight - s.scrollTop - s.clientHeight)(document.querySelector('.chat-scroll'))")
    rec('desktop: newest message in view after each answer', end <= 48, str(end))
    rec('desktop: mic inside the composer; no floating button over it', l.locator('[data-testid=chat-mic]').is_visible() and not l.locator('#ask-fab').is_visible())
    l.click('[data-testid=chat-hist-btn]'); l.wait_for_selector('[data-testid=chat-hist-pane] [data-testid=chat-history] li', timeout=8000)
    hp = l.locator('[data-testid=chat-hist-pane]').bounding_box()
    rec('desktop: History opens inside the panel', hp['x'] >= pb['x'] - 1 and hp['x'] + hp['width'] <= pb['x'] + pb['width'] + 1 and l.locator('.chat-hist-sheet').count() == 0, str(hp))
    shot(l, 'web-chat-desktop-history')
    l.click('[data-testid=chat-hist-btn]'); l.wait_for_timeout(200)
    rec('desktop: History toggles closed', not l.locator('[data-testid=chat-hist-pane]').is_visible())
    l.click('[data-testid=chat-hist-btn]'); l.wait_for_selector('[data-testid=chat-hist-pane]'); l.keyboard.press('Escape'); l.wait_for_timeout(300)
    rec('desktop: Esc closes History first, the panel stays', not l.locator('[data-testid=chat-hist-pane]').is_visible() and l.locator('[data-testid=chat-panel]').is_visible())
    shot(l, 'web-chat-desktop')
    # a side-rail tab keeps the panel open over the new page; the rail Chat item toggles the same panel
    l.click('.side a[data-route=money]'); l.wait_for_timeout(600)
    rec('desktop: switching tabs keeps the panel (and the chat) open', l.locator('[data-testid=chat-panel]').is_visible() and l.evaluate("location.hash") == '#/money' and agent_count(l) == 2)
    l.click('.side [data-testid=chat-btn]'); l.wait_for_timeout(500)
    rec('desktop: side-rail Chat closes the panel', not l.locator('[data-testid=chat-panel]').is_visible() and l.locator('#ask-fab').is_visible())
    l.click('.side [data-testid=chat-btn]'); l.wait_for_timeout(500)
    rec('desktop: side-rail Chat opens the same panel, conversation intact', l.locator('[data-testid=chat-panel]').is_visible() and agent_count(l) == 2)
    # resize from the top-left corner; the size is kept
    g = l.locator('[data-testid=chat-resize]').bounding_box(); w0 = l.locator('[data-testid=chat-panel]').bounding_box()['width']
    l.mouse.move(g['x'] + 8, g['y'] + 8); l.mouse.down(); l.mouse.move(g['x'] - 120, g['y'] - 40, steps=6); l.mouse.up(); l.wait_for_timeout(200)
    w1 = l.locator('[data-testid=chat-panel]').bounding_box()['width']
    rec('desktop: drag the corner to resize the panel', w1 >= w0 + 100, f'{w0:.0f} → {w1:.0f}')
    l.evaluate("document.activeElement?.blur()"); l.keyboard.press('Escape'); l.wait_for_timeout(500)
    rec('desktop: Esc closes the panel', not l.locator('[data-testid=chat-panel]').is_visible())
    l.click('#ask-fab'); l.wait_for_timeout(500)
    w2 = l.locator('[data-testid=chat-panel]').bounding_box()['width']
    rec('desktop: the size is kept', abs(w2 - w1) <= 2, f'{w2:.0f}')
    l.dblclick('[data-testid=chat-resize]'); l.wait_for_timeout(200)
    # deep link #/chat opens the panel over Today
    l.goto('about:blank'); l.goto(BASE + '#/chat'); l.wait_for_selector('[data-testid=chat-panel]', timeout=8000); l.wait_for_timeout(500)
    rec('deep link #/chat opens the panel (over Today)', l.locator('[data-testid=chat-panel]').is_visible() and l.locator('#qa').count() == 1)
    l.click('[data-testid=chat-close]'); l.wait_for_timeout(500)
    rec('closing a deep-linked chat lands on Today', l.evaluate("location.hash") == '#/today' and not l.locator('[data-testid=chat-panel]').is_visible())
    # dark desktop shot
    l.emulate_media(color_scheme='dark'); l.click('#ask-fab'); l.wait_for_timeout(600); shot(l, 'web-chat-desktop-dark')

    rec('no console errors', not errs, '; '.join(errs[:4]))
    b.close()
fails = [r for r in res if not r[1]]
print(f'\n{len(res) - len(fails)}/{len(res)} passed')
sys.exit(1 if fails else 0)
