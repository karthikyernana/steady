import { salvage } from '../../server/chat.js';
import assert from 'node:assert'; import test from 'node:test';
test('groq tool_use_failed salvage', () => { const r1 = salvage('{"name":"json","arguments":{"text":"You spent ₹829.","cards":[]}}'); assert.equal(r1.tool_calls[0].function.name, 'reply');
const r2 = salvage('{"name":"query_money","arguments":{"range":"last7"}}'); assert.equal(r2.tool_calls[0].function.name, 'query_money');
assert.equal(salvage('garbage'), null); assert.equal(salvage('{"name":"json","arguments":{"foo":1}}'), null);
});
