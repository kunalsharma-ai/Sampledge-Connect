// Seeds the Client Inbox on a local API (after e2e-seed.mjs): test-mode channels and client
// conversations, so the mobile inbox has something real to show.
const API = process.env.API ?? 'http://localhost:4000';
const uuid = () => crypto.randomUUID();
async function call(method, path, body, token) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : undefined;
}
const login = async (email) =>
  (
    await call('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email,
      password: 'correct-horse-battery-1',
      device: { deviceId: uuid(), name: 'inbox-seed', platform: 'web' },
    })
  ).accessToken;

const T = await login('priya@northwind.test');
const usersRes = await call('GET', '/v1/users', undefined, T);
const users = Array.isArray(usersRes) ? usersRes : (usersRes.items ?? []);
const idOf = (email) => users.find((u) => u.email === email)?.userId;

const channel = async (provider, name) =>
  call('POST', '/v1/connectors', { provider, name, environment: 'test' }, T);
const telegram = await channel('telegram', 'Client support (Telegram)');
const teams = await channel('teams', 'Partner desk (Teams)');
const slack = await channel('slack', 'Agency Slack Connect');
await channel('signal', 'Signal handoff');

const say = (c, fromName, fromHandle, text, extra = {}) =>
  call(
    'POST',
    `/v1/connectors/${c.connectorId}/simulate-inbound`,
    { fromName, fromHandle, text, ...extra },
    T,
  );

await say(
  telegram,
  'Hannah Becker',
  'hannah_b',
  'Hi! Could you share the topline for the Q4 brand tracker before Friday?',
);
await say(
  teams,
  'Daniel Moreau',
  'daniel.moreau@acme.example',
  'The incidence in the DE sample looks low. Can we add 200 completes?',
);
await say(
  slack,
  'Aiko Tanaka',
  'aiko',
  'Quick one: is the wave 4 questionnaire final? Our legal team wants to review.',
);
await say(
  telegram,
  'Omar Haddad',
  'omarh',
  'We are seeing duplicate respondents in the panel export, urgent please.',
);
await say(
  teams,
  'Grace Liu',
  'grace.liu@contoso.example',
  'Thanks for the deck! One question on slide 12.',
);

const list = await call('GET', '/v1/inbox/conversations?status=active', undefined, T);
const byName = (n) => list.items.find((c) => c.client.name === n);
const sam = idOf('sam@northwind.test');
const marco = idOf('marco@northwind.test');
const patch = (c, body) => call('PATCH', `/v1/inbox/conversations/${c.conversationId}`, body, T);
await patch(byName('Hannah Becker'), {
  assigneeId: sam,
  priority: 'high',
  tags: ['tracker', 'q4'],
});
await patch(byName('Omar Haddad'), { assigneeId: sam, priority: 'urgent', tags: ['panel'] });
await patch(byName('Daniel Moreau'), { assigneeId: marco, priority: 'normal' });
await patch(byName('Grace Liu'), { status: 'pending' });
const h = byName('Hannah Becker');
await call(
  'POST',
  `/v1/inbox/conversations/${h.conversationId}/replies`,
  { clientMessageId: uuid(), text: 'Hi Hannah, yes. I will send it by Thursday noon.' },
  T,
);
await call(
  'POST',
  `/v1/inbox/conversations/${h.conversationId}/notes`,
  {
    clientNoteId: uuid(),
    text: 'Topline is with QA, check with Lena before sending.',
    mentions: [],
  },
  T,
);
await say(
  telegram,
  'Hannah Becker',
  'hannah_b',
  'Perfect, thank you! Can it include the awareness chart by market?',
);
await call(
  'POST',
  '/v1/inbox/templates',
  {
    name: 'Thanks, on it',
    shortcut: 'thanks',
    body: 'Thanks {{client.firstName}}, I am on it and will update you shortly. {{agent.name}}',
  },
  T,
);
await call(
  'POST',
  '/v1/inbox/templates',
  {
    name: 'Topline timing',
    shortcut: 'topline',
    body: 'Hi {{client.firstName}}, the topline for {{client.company}} will be ready within 24 hours.',
  },
  T,
);
console.log(JSON.stringify({ conversations: list.items.length, sam, marco }));
