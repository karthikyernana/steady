// Chat agent, browser side: plain API calls (chats are not part of record sync). The server runs the read-only tools
// and resolves every card from real data; this module only moves JSON and remembers the last chat for offline viewing.
import { api, cloudReady, serverConfig } from './sync.js';
import { local, setLocal } from './store.js';

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch { return 'Asia/Kolkata'; } };

// Why chat cannot run right now (null when it can). Synchronous, so every render reflects sign-in / connection changes;
// whether the server has a model comes from the cached /api/config (refreshed in the background).
let cfgAsked = false;
export function chatBlocker() {
  if (!cloudReady()) return 'signin';
  if (!navigator.onLine) return 'offline';
  if (!cfgAsked) { cfgAsked = true; serverConfig(true).catch(() => {}); }
  const c = local('serverConfig');
  return c?.chat && !c.chat.on ? 'off' : null;
}
export const sendChat = (chatId, message) => api('POST', 'agent/chat', { chatId: chatId || null, message, tz: tz() });
export const listChats = () => api('GET', 'agent/chats');
export const getChat = id => api('GET', `agent/chats/${encodeURIComponent(id)}?tz=${encodeURIComponent(tz())}`);
export const deleteChat = id => api('DELETE', `agent/chats/${encodeURIComponent(id)}`);
// Needs PATCH agent/chats/:id on the server; until then a 404/405 keeps the new name on this device (views/chat.js).
export const renameChat = (id, title) => api('PATCH', `agent/chats/${encodeURIComponent(id)}`, { title });

// The last chat seen on this device (with its resolved cards, as they were), shown read-only when offline.
export const lastChat = () => local('chatLast', null);
export const rememberChat = chat => setLocal('chatLast', chat ? { ...chat, savedAt: Date.now() } : null);
