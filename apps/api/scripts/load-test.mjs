#!/usr/bin/env node
/**
 * Load test for a running SampConnect API (staging, never production data).
 *
 *   node apps/api/scripts/load-test.mjs --url https://api.staging.example --users 20 \
 *     --connections 200 --seconds 60 --rate 5
 *
 * It creates a throwaway organization, adds --users members, opens --connections
 * Socket.IO connections spread across them (like several devices each), and sends
 * --rate messages per second into #general for --seconds. It reports:
 *   - send ack latency (client sends -> server confirms it is stored)
 *   - fan-out latency (client sends -> every other connection receives it)
 *   - HTTP latency for history and sync while the load runs
 * The API must allow the throwaway organization's sign-ins (rate limits apply per account).
 * See docs/launch-readiness.md for targets and how to read the results.
 */
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';
import { uuidv7 } from '@sampledge/contracts';

const { values: o } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4000' },
    users: { type: 'string', default: '10' },
    connections: { type: 'string', default: '50' },
    seconds: { type: 'string', default: '30' },
    rate: { type: 'string', default: '5' },
  },
});
const URL_ = o.url.replace(/\/$/, '');
const USERS = Number(o.users);
const CONNS = Number(o.connections);
const SECONDS = Number(o.seconds);
const RATE = Number(o.rate);

const device = (name) => ({ deviceId: uuidv7(), name, platform: 'web' });
async function call(method, path, { token, body } = {}) {
  const t0 = performance.now();
  const res = await fetch(URL_ + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return { body: text ? JSON.parse(text) : undefined, ms };
}

const pct = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const fmt = (xs) =>
  `n=${xs.length} p50=${pct(xs, 0.5).toFixed(1)}ms p95=${pct(xs, 0.95).toFixed(1)}ms p99=${pct(xs, 0.99).toFixed(1)}ms`;

const slug = `load-${Date.now().toString(36)}`;
console.log(`Creating throwaway organization ${slug} on ${URL_}`);
const owner = (
  await call('POST', '/v1/auth/register', {
    body: {
      organizationName: `Load test ${slug}`,
      tenantSlug: slug,
      ownerName: 'Load Owner',
      ownerEmail: `owner@${slug}.test`,
      password: 'load test password 2026',
      device: device('load-owner'),
    },
  })
).body;

const tokens = [owner.accessToken];
for (let i = 1; i < USERS; i++) {
  const email = `user${i}@${slug}.test`;
  await call('POST', '/v1/users', {
    token: owner.accessToken,
    body: {
      email,
      displayName: `Load User ${i}`,
      role: 'member',
      temporaryPassword: 'load password 123',
    },
  });
  const s = await call('POST', '/v1/auth/login', {
    body: { tenantSlug: slug, email, password: 'load password 123', device: device(`load-${i}`) },
  });
  tokens.push(s.body.accessToken);
}
const general = (await call('GET', '/v1/conversations', { token: owner.accessToken })).body.find(
  (c) => c.name === 'general',
);
if (!general) throw new Error('#general not found');
console.log(`${USERS} members ready. Opening ${CONNS} connections…`);

const sentAt = new Map();
const fanout = [];
const acks = [];
let errors = 0;
const sockets = await Promise.all(
  Array.from(
    { length: CONNS },
    (_, i) =>
      new Promise((resolve, reject) => {
        const s = io(URL_, {
          auth: { token: tokens[i % tokens.length] },
          transports: ['websocket'],
          reconnection: false,
          forceNew: true,
        });
        s.on('message:new', (m) => {
          const t = sentAt.get(m.clientMessageId);
          if (t && t.socket !== s) fanout.push(performance.now() - t.at);
        });
        s.once('connect', () => resolve(s));
        s.once('connect_error', reject);
      }),
  ),
);
console.log(`Connected. Sending ${RATE}/s for ${SECONDS}s…`);

const http = { history: [], sync: [] };
const end = Date.now() + SECONDS * 1000;
let n = 0;
const sender = setInterval(() => {
  if (Date.now() > end) return;
  const s = sockets[n++ % sockets.length];
  const clientMessageId = uuidv7();
  const at = performance.now();
  sentAt.set(clientMessageId, { at, socket: s });
  s.timeout(10_000).emit(
    'message:send',
    {
      conversationId: general.conversationId,
      clientMessageId,
      content: { text: `load ${n}`, mentions: [] },
    },
    (err, res) => {
      if (err || !res?.ok) errors++;
      else acks.push(performance.now() - at);
    },
  );
}, 1000 / RATE);
const prober = setInterval(async () => {
  if (Date.now() > end) return;
  const tok = tokens[0];
  try {
    http.history.push(
      (
        await call('GET', `/v1/conversations/${general.conversationId}/messages?limit=50`, {
          token: tok,
        })
      ).ms,
    );
    http.sync.push((await call('POST', '/v1/sync', { token: tok, body: { cursors: [] } })).ms);
  } catch {
    errors++;
  }
}, 500);

await new Promise((r) => setTimeout(r, SECONDS * 1000 + 3000));
clearInterval(sender);
clearInterval(prober);
for (const s of sockets) s.close();

console.log('\nResults');
console.log(`  send ack      ${fmt(acks)}`);
console.log(`  fan-out       ${fmt(fanout)}  (expected ${acks.length * (CONNS - 1)} deliveries)`);
console.log(`  GET history   ${fmt(http.history)}`);
console.log(`  POST sync     ${fmt(http.sync)}`);
console.log(`  errors        ${errors}`);
console.log(`\nThe organization ${slug} stays in the database; remove it when you are done.`);
process.exit(errors ? 1 : 0);
