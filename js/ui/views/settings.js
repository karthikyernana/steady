import { meta, setMeta, local, setLocal, wipeAll } from '../../data/store.js';
import { esc, randomTopic, ago } from '../../core/util.js';
import { I } from '../icons.js';
import { on, toast, openSheet, segmented, bindSeg, toggle, confirmSheet, requestRender } from '../ui.js';
import { account, serverConfig, syncNow, getStatus, signOut, signInWithGoogle, checkEmail, signUp, logIn, changePassword, deleteAccount, pendingCount, createReadToken, listReadTokens, revokeReadToken } from '../../data/sync.js';
import { permission, requestPermission, showLocal, ntfyPublish, reconcileNtfy, reconcileRemote, ntfyServer, NTFY_DEFAULT, enablePush, disablePush, pushSupported } from '../../platform/notify.js';
import { downloadExport, importJSON } from '../../data/backup.js';

export const APP_VERSION = '1.2.0';
let cfg = local('serverConfig') || null;
serverConfig().then(c => { const changed = JSON.stringify(c) !== JSON.stringify(cfg); cfg = c; if (changed) requestRender(); }).catch(() => {});

function syncSection() {
  const acct = account(); const st = getStatus();
  if (acct) {
    const label = st.state === 'error' ? 'Sync needs attention' : st.state === 'syncing' ? 'Syncing…' : st.state === 'offline' ? 'Offline. Changes are kept here and sync when you are back.' : st.state === 'live' ? 'Live sync is on' : 'In sync';
    const pend = pendingCount();
    return `<div class="sync-status ${st.state}" data-testid="sync-status"><span class="dot"></span><div><strong>${label}</strong>
        <small>${esc(acct.email)} · last synced ${ago(st.lastSyncedAt || local('lastSyncedAt'))}${pend ? ` · ${pend} change${pend === 1 ? '' : 's'} waiting` : ''}</small>${st.error ? `<small class="err">${esc(st.error)}</small>` : ''}</div></div>
      <div class="row gap wrap"><button class="btn primary sm" data-act="sync-now" data-testid="sync-now">${I.sync}<span>Sync now</span></button>
        <button class="btn ghost sm" data-act="acct-password">Change password</button>
        <button class="btn ghost sm" data-act="sign-out" data-testid="sign-out">Sign out</button></div>
      <p class="hint small mt">Your account and data live in Steady's own database (Neon Postgres, Singapore). Changes reach your other signed-in devices within a couple of seconds while Steady is open. <button class="link danger-text" data-act="acct-delete">Delete account</button></p>`;
  }
  if (!cfg || !cfg.db) {
    return `<p class="muted">Cloud sync isn't reachable right now${navigator.onLine ? '' : ' (you are offline)'}. Everything still works on this device, and it will sync once you sign in.</p>`;
  }
  return `<p class="muted">Create a free account with your email to back up your data and keep your phone and laptop in step, live.</p>
    ${st.error ? `<p class="err small" role="alert">${esc(st.error)}</p>` : ''}
    <button class="btn primary sm" data-act="sign-in" data-testid="sign-in">${I.you}<span>Sign in or create account</span></button>`;
}

export function renderSettings() {
  const p = meta('profile'), s = meta('settings');
  const perm = permission();
  const theme = local('theme', 'system');
  const topic = s.ntfyTopic || '';
  const acct = account();
  const pushOn = local('pushOn') && perm === 'granted';

  return `<div class="page-head"><div><div class="eyebrow">You</div><h1 class="display">Settings, <em>kept simple</em>.</h1>
    <p class="sub">Everything lives on this device first. Sync and reminders are yours to switch on.</p></div></div>

  <section class="card set" id="sec-profile"><h2 class="card-title">${I.you}<span>About you</span></h2>
    <form class="form" id="pf">
      <label class="field"><span>Name</span><input name="name" value="${esc(p.name || '')}" autocomplete="given-name"></label>
      <div class="grid2"><label class="field"><span>Usually up by</span><input type="time" name="wake" value="${p.wake || '07:00'}"></label>
      <label class="field"><span>Usually asleep by</span><input type="time" name="sleep" value="${p.sleep || '23:30'}"></label></div>
      <div class="row end"><button class="btn ghost sm" type="submit">Save</button></div></form></section>

  <section class="card set" id="sec-sync" data-testid="sync-section"><h2 class="card-title">${I.sync}<span>Sync across devices</span></h2>${syncSection()}</section>

  <section class="card set" id="sec-notif"><h2 class="card-title">${I.bell}<span>Reminders</span></h2>
    <p class="muted">Steady nudges you at the time you set. ${acct ? 'Because you are signed in, reminders also arrive when the app is closed.' : 'Sign in to get reminders even when the app is closed.'}</p>
    <div class="row between gap wrap"><span class="pill ${perm === 'granted' ? 'ok' : ''}" data-testid="perm-state">${perm === 'granted' ? (pushOn ? 'On, including when closed' : 'On while Steady is open') : perm === 'denied' ? 'Blocked in browser settings' : perm === 'unsupported' ? 'Not supported here' : 'Not enabled yet'}</span>
      <span class="row gap">${perm !== 'granted' && perm !== 'denied' && perm !== 'unsupported' ? '<button class="btn primary sm" data-act="notif-ask">Turn on</button>' : ''}
      ${perm === 'granted' && acct && pushSupported() && !pushOn && cfg?.vapidPublicKey ? '<button class="btn primary sm" data-act="push-on" data-testid="push-on">Also when closed</button>' : ''}
      ${perm === 'granted' ? '<button class="btn ghost sm" data-act="notif-test" data-testid="notif-test">Test</button>' : ''}</span></div>
    <div class="grid2 mt stack-sm">
      <label class="field"><span>Remind me</span><select id="lead">${[[0, 'At the time'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before']].map(([v, l]) => `<option value="${v}" ${+(s.reminderLead ?? 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="field"><span>Evening check-in nudge</span>${toggle('ci-nudge', s.checkinNudge !== false, 'About 90 min before sleep')}</div>
    </div>
    ${toggle('def-rem', s.defaultReminder !== false, 'Tasks with a time get a reminder by default')}
    <details class="steps mt" data-testid="ntfy-section" ${s.ntfyEnabled ? 'open' : ''}><summary>Backup channel: ntfy (optional)</summary>
      <p class="hint small">If you ever want reminders without signing in, Steady can also schedule them on <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a>, a free open-source push app.</p>
      ${toggle('ntfy-on', !!s.ntfyEnabled, 'Also send reminders through ntfy')}
      <div class="ntfy-body ${s.ntfyEnabled ? '' : 'hidden'}">
        <label class="field"><span>Your private topic</span><div class="copy-field"><input id="ntfy-topic" value="${esc(topic)}" readonly><button class="icon-btn" data-act="copy" data-copy="${esc(topic)}" aria-label="Copy topic">${I.copy}</button></div>
          <small class="hint">Treat it like a password. <button class="link" data-act="ntfy-new">Make a new one</button></small></label>
        <ol class="steps-list"><li>Install <strong>ntfy</strong> from the <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Play Store</a>.</li>
          <li>Tap <strong>+</strong>, paste the topic, server <code>${esc(ntfyServer().replace(/^https:\/\//, ''))}</code>.</li></ol>
        <label class="field"><span>Server</span><input id="ntfy-server" value="${esc(s.ntfyServer || NTFY_DEFAULT)}" inputmode="url" spellcheck="false" autocapitalize="off"></label>
        <div class="row gap wrap"><button class="btn ghost sm" data-act="ntfy-test" data-testid="ntfy-test">Send test</button></div>
      </div></details>
  </section>

  <section class="card set"><h2 class="card-title">${theme === 'dark' ? I.moon : I.sun}<span>Appearance</span></h2>
    <div class="field"><span>Theme</span>${segmented('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], theme)}</div>
    <div class="field mt"><span>Style</span>${segmented('style', [['liquid', 'Liquid glass'], ['paper', 'Paper']], document.documentElement.dataset.style || 'liquid')}
      <small class="hint">Paper is flat and opaque, and the lightest on older phones.</small></div></section>

  <section class="card set" id="sec-hark" data-testid="hark-section"><h2 class="card-title">${I.spark}<span>Hark plugin <small class="pill">optional</small></span></h2>
    <p class="muted">Steady works completely on its own. If you want Hark to coach you from your data, give it a read-only key. It can read, never change anything, and you can revoke it any time.</p>
    ${acct ? `<div class="row gap wrap"><button class="btn ghost sm" data-act="hark-token" data-testid="hark-token">${I.plus}<span>Create read-only key</span></button><button class="btn ghost sm" data-act="hark-list">Manage keys</button></div>`
      : '<p class="hint small">Sign in to sync first; Hark reads the same private account.</p>'}
  </section>

  <section class="card set" id="sec-data"><h2 class="card-title">${I.download}<span>Your data</span></h2>
    <p class="muted">Export a full backup any time. Importing merges by record, so it never overwrites newer changes.</p>
    <div class="row gap wrap"><button class="btn ghost sm" data-act="export" data-testid="export">${I.download}<span>Export JSON</span></button>
      <label class="btn ghost sm file-btn">${I.upload}<span>Import JSON</span><input type="file" id="import-file" accept="application/json,.json" data-testid="import"></label>
      ${window.__installPrompt ? `<button class="btn ghost sm" data-act="install">${I.phone}<span>Install app</span></button>` : ''}
      <button class="btn ghost sm danger-text" data-act="wipe">Erase this device</button></div></section>

  <p class="foot muted small">Steady ${APP_VERSION} · local-first · works offline · <a href="https://github.com/karthikyernana/steady" target="_blank" rel="noopener">source</a></p>`;
}

export function mountSettings(root) {
  root.querySelector('#pf')?.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    await setMeta('profile', { name: f.name.value.trim(), wake: f.wake.value, sleep: f.sleep.value });
    reconcileNtfy(); toast('Saved.');
  });
  root.querySelector('#lead')?.addEventListener('change', async e => { await setMeta('settings', { reminderLead: +e.target.value }); reconcileNtfy(); });
  root.querySelector('#ci-nudge')?.addEventListener('change', async e => { await setMeta('settings', { checkinNudge: e.target.checked }); reconcileNtfy(); });
  root.querySelector('#def-rem')?.addEventListener('change', e => setMeta('settings', { defaultReminder: e.target.checked }));
  root.querySelector('#ntfy-on')?.addEventListener('change', async e => {
    const s = meta('settings');
    await setMeta('settings', { ntfyEnabled: e.target.checked, ntfyTopic: s.ntfyTopic || randomTopic() });
    reconcileNtfy();
  });
  root.querySelector('#ntfy-server')?.addEventListener('change', async e => {
    let v = e.target.value.trim().replace(/\/+$/, ''); if (v && !/^https?:\/\//.test(v)) v = 'https://' + v;
    await setMeta('settings', { ntfyServer: v || NTFY_DEFAULT }); await setLocal('ntfySched', {}); reconcileNtfy(); toast('Server saved.');
  });
  bindSeg(root, 'theme', async v => { await setLocal('theme', v); window.__applyTheme(); });
  bindSeg(root, 'style', v => { try { localStorage.setItem('steady-style', v); } catch { /* private mode */ } window.__applyStyle(v); });
  root.querySelector('#import-file')?.addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try { const n = await importJSON(await file.text()); toast(n ? `Imported ${n} records.` : 'Nothing new in that file.'); window.__markDirty?.(); }
    catch (x) { toast(`Import failed: ${x.message}`); }
    e.target.value = '';
  });
}

on('sync-now', async () => { const ok = await syncNow('manual'); toast(ok ? 'In sync.' : (getStatus().error || 'Sync failed. It will retry.')); if (ok) reconcileRemote(); requestRender(); });
on('sign-out', async () => {
  if (!(await confirmSheet('Sign out on this device? Your data stays here; it just stops syncing until you sign in again.', 'Sign out'))) return;
  await disablePush().catch(() => {}); await signOut(); requestRender(); toast('Signed out on this device.');
});
on('sign-in', () => openSignIn());
on('notif-ask', async () => { const p = await requestPermission(); if (p === 'granted' && account()) await enablePush().catch(() => {}); requestRender(); });
on('push-on', async () => { try { await enablePush(); toast('Reminders will arrive even when Steady is closed.'); } catch (x) { toast(`Couldn't enable push: ${x.message}`); } requestRender(); });
on('notif-test', () => showLocal('Steady', 'Reminders work on this device.', 'test'));
on('ntfy-new', async () => { if (await confirmSheet('Make a new topic? You will need to subscribe to it again in the ntfy app.', 'New topic')) { await setMeta('settings', { ntfyTopic: randomTopic() }); await setLocal('ntfySched', {}); reconcileNtfy(); } });
on('ntfy-test', async el => {
  const s = meta('settings'); el.disabled = true;
  try { await ntfyPublish(s.ntfyTopic, { title: 'Steady is connected', body: 'Backup reminders will arrive here.', tags: 'white_check_mark', priority: 3 }); toast('Sent. Check your phone.'); }
  catch (x) { toast(`Could not reach ntfy (${x.message}).`); }
  el.disabled = false;
});
on('copy', async el => { try { await navigator.clipboard.writeText(el.dataset.copy); toast('Copied.'); } catch { toast('Copy failed; select and copy manually.'); } });
on('export', () => { downloadExport(); toast('Backup downloaded.'); });
on('wipe', async () => {
  if (!(await confirmSheet('Erase everything on this device? Your synced account is not touched.', 'Erase', true))) return;
  await wipeAll(); try { localStorage.clear(); } catch { /* ignore */ } location.hash = '#/'; location.reload();
});

on('hark-token', async () => {
  try {
    const { token } = await createReadToken('Hark');
    const url = `${location.origin}/api/hark/export`;
    openSheet({
      title: 'Read-only key for Hark',
      body: `<p class="muted">Copy it now; Steady shows it only once. Give Hark the key and the address below. It can read your data, never change it.</p>
        <label class="field"><span>Key</span><div class="copy-field"><input value="${esc(token)}" readonly data-testid="hark-token-value"><button class="icon-btn" data-act="copy" data-copy="${esc(token)}" aria-label="Copy key">${I.copy}</button></div></label>
        <label class="field"><span>Address</span><div class="copy-field"><input value="${esc(url)}" readonly><button class="icon-btn" data-act="copy" data-copy="${esc(url)}" aria-label="Copy address">${I.copy}</button></div></label>
        <p class="hint small">Hark calls it with <code>Authorization: Bearer &lt;key&gt;</code>.</p>`,
    });
  } catch (x) { toast(x.message); }
});
on('hark-list', async () => {
  try {
    const { tokens } = await listReadTokens();
    openSheet({
      title: 'Read-only keys',
      body: tokens.length ? `<ul class="pick-list">${tokens.map(t => `<li class="pick"><span>${esc(t.label)}<small>Created ${new Date(t.created_at).toLocaleDateString()} · ${t.last_used_at ? `last used ${ago(new Date(t.last_used_at).getTime())}` : 'never used'}</small></span><button class="btn ghost sm danger-text" data-revoke="${esc(t.id)}">Revoke</button></li>`).join('')}</ul>` : '<p class="muted">No active keys.</p>',
      onMount: (b, sheet) => b.addEventListener('click', async e => {
        const id = e.target.closest('[data-revoke]')?.dataset.revoke; if (!id) return;
        await revokeReadToken(id); sheet.close(); toast('Key revoked. Hark can no longer read.');
      }),
    });
  } catch (x) { toast(x.message); }
});

// ---- sign in ----
let gisLoading = null;
function loadGis() {
  return gisLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => { gisLoading = null; rej(new Error('Could not load Google sign-in')); };
    document.head.appendChild(s);
  });
}

// One sheet, three steps: email → (password | new account) → signed in. Nothing is created until you say so.
export async function openSignIn(onDone) {
  const c = await serverConfig(true).catch(() => cfg) || {};
  cfg = c;
  if (!c.db) { toast(navigator.onLine ? "Steady's server isn't reachable right now. Try again in a moment." : "You're offline. Sign in when you're back online."); return; }
  let email = '';
  openSheet({
    title: 'Your Steady account',
    body: `<div id="si-step"></div><p class="err small" id="si-err" role="alert" aria-live="polite"></p>
      ${c.googleClientId ? '<div class="or"><span>or</span></div><div id="gsi-btn" class="gsi-slot" data-testid="google-btn"></div>' : ''}`,
    onMount: (b, sheet) => {
      const step = b.querySelector('#si-step');
      const err = m => { b.querySelector('#si-err').textContent = m || ''; };
      const done = created => { sheet.close(); toast(created ? 'Account created. Live sync is on.' : 'Signed in. Live sync is on.'); enablePush().catch(() => {}); requestRender(); onDone?.(); };
      const busy = (btn, on, label) => { btn.disabled = on; btn.querySelector('span').textContent = label; };
      const showEmail = () => {
        step.innerHTML = `<form class="form" id="si-email" novalidate><p class="muted">Sign in, or create a free account. Your data stays on this device too.</p>
          <label class="field"><span>Email</span><input type="email" name="email" value="${esc(email)}" autocomplete="username email" inputmode="email" autocapitalize="off" spellcheck="false" required data-testid="si-email" autofocus></label>
          <div class="row end"><button class="btn primary" type="submit" data-testid="si-continue"><span>Continue</span></button></div></form>`;
        const f = step.querySelector('form');
        f.addEventListener('submit', async e => {
          e.preventDefault(); err('');
          email = f.email.value.trim().toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { err('Enter a valid email address.'); f.email.focus(); return; }
          const btn = f.querySelector('[type=submit]'); busy(btn, true, 'Checking…');
          try { const r = await checkEmail(email); r.exists ? showPassword() : r.canCreate ? showCreate() : err('Sign-ups are closed on this Steady.'); }
          catch (x) { err(x.message); } finally { if (btn.isConnected) busy(btn, false, 'Continue'); }
        });
        f.email.focus();
      };
      const back = `<button type="button" class="btn ghost sm" data-back>Use another email</button>`;
      const showPassword = () => {
        step.innerHTML = `<form class="form" id="si-login"><p class="muted">Welcome back. Enter the password for <strong>${esc(email)}</strong>.</p>
          <input type="email" name="email" value="${esc(email)}" autocomplete="username" hidden>
          <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required data-testid="si-password"></label>
          <div class="row between">${back}<button class="btn primary" type="submit" data-testid="si-login"><span>Sign in</span></button></div></form>`;
        wire(step.querySelector('form'), async f => { await logIn(email, f.password.value); done(false); }, 'Signing in…', 'Sign in');
      };
      const showCreate = () => {
        step.innerHTML = `<form class="form" id="si-create"><p class="muted">No account for <strong>${esc(email)}</strong> yet. Create one?</p>
          <input type="email" name="email" value="${esc(email)}" autocomplete="username" hidden>
          <label class="field"><span>Choose a password <small class="muted">(8+ characters)</small></span><input type="password" name="password" autocomplete="new-password" minlength="8" required data-testid="si-new-password"></label>
          <label class="field"><span>Repeat password</span><input type="password" name="confirm" autocomplete="new-password" minlength="8" required data-testid="si-confirm"></label>
          <div class="row between">${back}<button class="btn primary" type="submit" data-testid="si-create"><span>Create account</span></button></div></form>`;
        wire(step.querySelector('form'), async f => {
          if (f.password.value.length < 8) throw new Error('Use at least 8 characters for your password.');
          if (f.password.value !== f.confirm.value) throw new Error("The two passwords don't match.");
          await signUp(email, f.password.value, meta('profile').name); done(true);
        }, 'Creating…', 'Create account');
      };
      const wire = (f, fn, during, label) => {
        f.querySelector('[data-back]').onclick = () => { err(''); showEmail(); };
        f.querySelector('input[type=password]').focus();
        f.addEventListener('submit', async e => {
          e.preventDefault(); err('');
          const btn = f.querySelector('[type=submit]'); busy(btn, true, during);
          try { await fn(f); } catch (x) { err(x.message); if (btn.isConnected) busy(btn, false, label); }
        });
      };
      showEmail();
      if (c.googleClientId) loadGis().then(() => {
        const slot = b.querySelector('#gsi-btn'); if (!slot) return;
        window.google.accounts.id.initialize({
          client_id: c.googleClientId, auto_select: false, use_fedcm_for_prompt: true,
          callback: async resp => { err(''); try { await signInWithGoogle(resp.credential); done(false); } catch (x) { err(x.message); } },
        });
        window.google.accounts.id.renderButton(slot, { theme: document.documentElement.dataset.theme === 'dark' ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(320, slot.clientWidth || 320) });
      }).catch(() => {});
    },
  });
}

on('acct-password', () => openSheet({
  title: 'Change password',
  body: `<form class="form" id="cp"><input type="email" value="${esc(account()?.email || '')}" autocomplete="username" hidden>
    <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
    <label class="field"><span>New password <small class="muted">(8+ characters)</small></span><input type="password" name="next" autocomplete="new-password" minlength="8" required></label>
    <p class="err small" id="cp-err" role="alert"></p>
    <div class="row end"><button class="btn primary" type="submit">Save</button></div></form>`,
  onMount: (b, sheet) => b.querySelector('#cp').addEventListener('submit', async e => {
    e.preventDefault();
    try { await changePassword(e.target.current.value, e.target.next.value); sheet.close(); toast('Password changed.'); }
    catch (x) { b.querySelector('#cp-err').textContent = x.message; }
  }),
}));
on('acct-delete', () => openSheet({
  title: 'Delete account',
  body: `<form class="form" id="da"><p class="muted">This permanently deletes your account and everything synced to Steady's server. This device keeps its own copy.</p>
    <input type="email" value="${esc(account()?.email || '')}" autocomplete="username" hidden>
    <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
    <p class="err small" id="da-err" role="alert"></p>
    <div class="row end"><button class="btn danger" type="submit">Delete forever</button></div></form>`,
  onMount: (b, sheet) => b.querySelector('#da').addEventListener('submit', async e => {
    e.preventDefault();
    try { await deleteAccount(e.target.password.value); sheet.close(); toast('Account deleted. Your data is still on this device.'); requestRender(); }
    catch (x) { b.querySelector('#da-err').textContent = x.message; }
  }),
}));
