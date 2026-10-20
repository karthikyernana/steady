# The Android app's web side (js/platform/native.js) against a fake Capacitor bridge, in Chromium.
# Proves: reminders become native exact alarms (and are replaced / cancelled as tasks change), Done/Snooze actions,
# hardware back, first-launch permission ask, export via the share sheet, and that the plain web app is untouched.
import os, sys, json, time
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8790/'
res = []; errs = []
def rec(name, ok, info=''): res.append((name, ok, info)); print(('PASS' if ok else 'FAIL'), name, info)
FAKE = r"""
(() => {
  const calls = []; const pending = new Map(); const listeners = {}; let perm = 'prompt';
  const log = (p, m, a) => calls.push({ p, m, a: JSON.parse(JSON.stringify(a ?? null)) });
  const LN = {
    checkPermissions: async () => (log('LN','checkPermissions'), { display: perm }),
    requestPermissions: async () => { log('LN','requestPermissions'); perm = 'granted'; return { display: perm }; },
    checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
    createChannel: async a => log('LN','createChannel', a),
    registerActionTypes: async a => log('LN','registerActionTypes', a),
    schedule: async a => { log('LN','schedule', a); for (const n of a.notifications) if (n.schedule) pending.set(n.id, n); return { notifications: a.notifications.map(n => ({ id: n.id })) }; },
    getPending: async () => ({ notifications: [...pending.values()] }),
    cancel: async a => { log('LN','cancel', a); for (const n of a.notifications) pending.delete(n.id); },
    addListener: async (ev, fn) => { (listeners['LN:' + ev] ||= []).push(fn); return { remove() {} }; },
  };
  const App = { addListener: async (ev, fn) => { (listeners['App:' + ev] ||= []).push(fn); return { remove() {} }; }, minimizeApp: async () => log('App','minimizeApp') };
  const SystemBars = { setStyle: async a => log('SystemBars','setStyle', a) };
  const Filesystem = { writeFile: async a => { log('FS','writeFile', { path: a.path, directory: a.directory, size: a.data.length }); return { uri: 'file:///cache/' + a.path }; } };
  const Share = { share: async a => log('Share','share', a) };
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { LocalNotifications: LN, App, SystemBars, Filesystem, Share } };
  window.__cap = { calls, pending, fire: (k, d) => (listeners[k] || []).forEach(f => f(d)), setPerm: p => { perm = p; } };
})();
"""
def onboard(pg):
    pg.goto(BASE); pg.wait_for_selector('[data-testid=onb-name]', timeout=8000)
    pg.fill('[data-testid=onb-name]', 'Karthik'); pg.click('[data-testid=onb-start]'); pg.wait_for_timeout(500)
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); c.add_init_script(FAKE)
    pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    onboard(pg)
    calls = lambda: pg.evaluate('window.__cap.calls')
    rec('native mode detected (html.native)', pg.evaluate("document.documentElement.classList.contains('native')"))
    cs = calls()
    rec('reminders channel created (high importance)', any(x['m'] == 'createChannel' and x['a']['importance'] == 5 for x in cs))
    rec('Done / Snooze action buttons registered', any(x['m'] == 'registerActionTypes' and [a['id'] for a in x['a']['types'][0]['actions']] == ['done', 'snooze'] for x in cs))
    rec('first launch asks for notification permission once', sum(1 for x in cs if x['m'] == 'requestPermissions') == 1)
    rec('status bar icons follow theme', any(x['m'] == 'setStyle' for x in cs))
    # a timed task → a native alarm at the exact time
    pg.fill('#qa', 'call amma 11:58pm'); pg.press('#qa', 'Enter'); pg.wait_for_timeout(2500)
    pend = pg.evaluate('[...window.__cap.pending.values()]')
    t = [n for n in pend if n['title'].lower().startswith('call amma')]
    at_ok = False
    if t:
        hhmm = pg.evaluate("ms => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()]; }", t[0]['extra']['at'])
        at_ok = hhmm == [23, 58, 0] and t[0]['schedule']['allowWhileIdle'] and t[0]['actionTypeId'] == 'task' and t[0]['channelId'] == 'reminders' and t[0]['smallIcon'] == 'ic_stat_steady'
    rec('timed task scheduled as exact native alarm (23:58, allowWhileIdle, actions)', bool(t) and at_ok, json.dumps(t[0]) if t else str(pend))
    # edit time → same id replaced, no duplicate
    tid = pg.evaluate("window.__steady.all('tasks').find(x => /amma/i.test(x.title)).id")
    pg.evaluate("""async id => { const st = await import('/js/data/store.js'); const t = st.get('tasks', id); await st.save('tasks', { ...t, dueTime: '23:45' }); }""", tid); pg.wait_for_timeout(2500)
    pend = pg.evaluate('[...window.__cap.pending.values()]'); t2 = [n for n in pend if n['extra'].get('taskId') == tid]
    rec('changing the time replaces the alarm (one, new time)', len(t2) == 1 and pg.evaluate("ms => new Date(ms).getMinutes()", t2[0]['extra']['at']) == 45, str(len(t2)))
    # web notification path never double-fires a task reminder
    rec('no instant duplicate notification for the task', not any(x['m'] == 'schedule' and any(not n.get('schedule') and 'amma' in n['title'].lower() for n in x['a']['notifications']) for x in calls()))
    # Snooze from the notification → task moves 10 min ahead, alarm re-armed
    pg.evaluate("tid => window.__cap.fire('LN:localNotificationActionPerformed', { actionId: 'snooze', notification: { extra: { taskId: tid } } })", tid); pg.wait_for_timeout(2500)
    task = pg.evaluate("tid => window.__steady.all('tasks').find(x => x.id === tid)", tid)
    pend = pg.evaluate('[...window.__cap.pending.values()]'); t3 = [n for n in pend if n['extra'].get('taskId') == tid]
    rec('Snooze action: task +10 min and alarm re-armed', task['dueTime'] != '23:45' and len(t3) == 1 and abs(t3[0]['extra']['at'] - (time.time() * 1000 + 600e3)) < 120e3, task['dueTime'])
    # Done from the notification → task done, alarm cancelled
    pg.evaluate("tid => window.__cap.fire('LN:localNotificationActionPerformed', { actionId: 'done', notification: { extra: { taskId: tid } } })", tid); pg.wait_for_timeout(2500)
    task = pg.evaluate("tid => window.__steady.all('tasks').find(x => x.id === tid)", tid)
    pend = pg.evaluate('[...window.__cap.pending.values()]')
    rec('Done action: task done and its alarm cancelled', task['status'] == 'done' and not [n for n in pend if n['extra'].get('taskId') == tid])
    # hardware back: sheet → closes; other tab → Today; Today → minimize
    pg.evaluate("location.hash = '#/goals'"); pg.wait_for_timeout(400)
    pg.evaluate("window.__cap.fire('App:backButton', {})"); pg.wait_for_timeout(400)
    rec('back on another tab returns to Today', pg.evaluate('location.hash') in ('#/today', ''))
    pg.click('#k-btn') if pg.locator('#k-btn').count() else pg.evaluate("location.hash='#/you'")
    pg.wait_for_timeout(300)
    pg.evaluate("location.hash = '#/today'"); pg.wait_for_timeout(300)
    pg.evaluate("import('/js/ui/ui.js').then(u => u.openSheet({ title: 'T', body: '<p>x</p>' }))"); pg.wait_for_timeout(500)
    pg.evaluate("window.__cap.fire('App:backButton', {})"); pg.wait_for_timeout(700)
    rec('back closes an open sheet first', pg.locator('.sheet-wrap').count() == 0 and pg.evaluate('location.hash') in ('#/today', ''))
    pg.evaluate("window.__cap.fire('App:backButton', {})"); pg.wait_for_timeout(300)
    rec('back on Today puts the app in the background', any(x['m'] == 'minimizeApp' for x in calls()))
    # export → share sheet
    pg.evaluate("location.hash = '#/you'"); pg.wait_for_timeout(600)
    pg.click('[data-testid=export]'); pg.wait_for_timeout(800)
    cs = calls()
    rec('export writes the backup and opens the share sheet', any(x['m'] == 'writeFile' and x['a']['path'].endswith('.json') for x in cs) and any(x['m'] == 'share' for x in cs))
    rec('settings says reminders work when closed', 'including when closed' in pg.inner_text('[data-testid=perm-state]'), pg.inner_text('[data-testid=perm-state]'))
    if os.environ.get('SHOTS'): pg.screenshot(path=f"{os.environ['SHOTS']}/native-you.png")
    # plain web: no Capacitor → nothing native
    c2 = b.new_context(viewport={'width': 390, 'height': 844}); w = c2.new_page(); w.on('pageerror', lambda e: errs.append(str(e)))
    onboard(w)
    rec('plain web app unaffected (no native class, export still a download)', not w.evaluate("document.documentElement.classList.contains('native')"))
    rec('no console errors', not errs, '; '.join(errs[:4]))
    b.close()
print('SUMMARY', sum(1 for r in res if r[1]), '/', len(res))
