# Chat UX screenshots (desktop docked panel, phone with few messages, switching chats while a reply is pending).
#   SHOTS=dir TAG=before|after python3 tests/qa/chat_ux_shots.py http://localhost:8790/
# Needs the AI mock (tests/mocks/ai-mock.mjs) as the chat provider; "slow" mode is used for the pending shot when the mock supports it.
import os, sys, json, urllib.request
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'sync_e2e.py')).read().split('with sync_playwright() as p:')[0])
SHOTS = os.environ.get('SHOTS', '/tmp/ux-shots'); TAG = os.environ.get('TAG', 'after'); MOCK = os.environ.get('MOCK', 'http://127.0.0.1:8791')
os.makedirs(SHOTS, exist_ok=True)
def mock(state):
    try: urllib.request.build_opener(urllib.request.ProxyHandler({})).open(urllib.request.Request(MOCK + '/__mock/state', data=json.dumps(state).encode(), method='POST', headers={'content-type': 'application/json'}), timeout=3).read()
    except Exception as e: print('mock state failed', e)
def shot(pg, name): pg.screenshot(path=f'{SHOTS}/{TAG}-{name}.png'); print('shot', f'{SHOTS}/{TAG}-{name}.png')
def signup(pg):
    open_signin(pg); pg.fill('[data-testid=si-email]', EMAIL); pg.click('[data-testid=si-continue]'); pg.wait_for_selector('[data-testid=si-new-password]')
    pg.fill('[data-testid=si-new-password]', PW); pg.fill('[data-testid=si-confirm]', PW); pg.click('[data-testid=si-create]'); pg.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    pg.wait_for_selector('.sheet-wrap', state='detached', timeout=5000)
def login(pg):
    open_signin(pg); pg.fill('[data-testid=si-email]', EMAIL); pg.click('[data-testid=si-continue]'); pg.wait_for_selector('[data-testid=si-password]')
    pg.fill('[data-testid=si-password]', PW); pg.click('[data-testid=si-login]'); pg.wait_for_selector('[data-testid=sync-status]', timeout=10000)
    pg.wait_for_selector('.sheet-wrap', state='detached', timeout=5000)
def ask(pg, q, wait=True):
    n = pg.locator('[data-testid=chat-msg-agent]').count()
    pg.fill('#chat-input', q); pg.click('[data-testid=chat-send]')
    if wait: pg.wait_for_function(f"document.querySelectorAll('[data-testid=chat-msg-agent]').length > {n}", timeout=20000); pg.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch()
    mock({'chatDelayMs': 0})
    c = b.new_context(viewport={'width': 1366, 'height': 820}, device_scale_factor=1, timezone_id='Asia/Kolkata', service_workers='block')
    d = c.new_page(); d.goto(BASE); d.wait_for_selector('.onboarding, .shell'); onboard(d); signup(d)
    d.evaluate("location.hash='#/today'"); d.wait_for_timeout(400)
    d.click('#ask-fab'); d.wait_for_selector('#chat-input'); d.wait_for_timeout(500)
    ask(d, 'how is my streak?'); d.wait_for_timeout(300)
    shot(d, 'desktop-1366-chat')
    m = b.new_context(viewport={'width': 412, 'height': 892}, is_mobile=True, has_touch=True, device_scale_factor=2, timezone_id='Asia/Kolkata', service_workers='block')
    ph = m.new_page(); ph.goto(BASE); ph.wait_for_selector('.onboarding, .shell'); onboard(ph); login(ph)
    ph.evaluate("location.hash='#/today'"); ph.wait_for_timeout(400)
    ph.click('#ask-fab'); ph.wait_for_selector('#chat-input'); ph.wait_for_timeout(500)
    ask(ph, 'What did I write about idea?')
    shot(ph, 'phone-412-few-messages')
    # switching while pending: slow reply, then New
    mock({'chatDelayMs': 6000})
    ask(ph, 'How am I doing on my goals?', wait=False); ph.wait_for_timeout(600)
    try:
        ph.click('[data-testid=chat-new]', timeout=1500); ph.wait_for_timeout(500)
        ph.click('[data-testid=chat-hist-btn]', timeout=1500); ph.wait_for_timeout(700)
    except Exception as e: print('switch blocked:', str(e).splitlines()[0])
    shot(ph, 'phone-412-switch-while-pending')
    mock({'chatDelayMs': 0})
    b.close()
