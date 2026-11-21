// Seeds a local API with a workspace, members, conversations and messages for end-to-end checks.
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
  const j = t ? JSON.parse(t) : undefined;
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t}`);
  return j;
}
const device = (name) => ({ deviceId: uuid(), name, platform: 'web' });
const pw = 'correct-horse-battery-1';
const owner = await call('POST', '/v1/auth/register', {
  organizationName: 'Northwind Research',
  tenantSlug: 'northwind',
  ownerName: 'Priya Shah',
  ownerEmail: 'priya@northwind.test',
  password: pw,
  device: device('seed'),
});
const T = owner.accessToken;
const people = {};
for (const [name, email] of [
  ['Marco Silva', 'marco@northwind.test'],
  ['Lena Fischer', 'lena@northwind.test'],
  ['Sam Okafor', 'sam@northwind.test'],
]) {
  const u = await call(
    'POST',
    '/v1/users',
    { email, displayName: name, role: 'member', temporaryPassword: pw },
    T,
  );
  people[email] = u.userId ?? u.user?.userId;
}
const login = async (email) =>
  (
    await call('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email,
      password: pw,
      device: device('seed'),
    })
  ).accessToken;
const marco = await login('marco@northwind.test');
const lena = await login('lena@northwind.test');
const ch = await call(
  'POST',
  '/v1/conversations',
  {
    kind: 'channel_public',
    name: 'fieldwork-ops',
    topic: 'Daily field status across live studies',
    memberIds: Object.values(people),
  },
  T,
);
const dm = await call(
  'POST',
  '/v1/conversations',
  { kind: 'dm', memberIds: [people['sam@northwind.test']] },
  T,
);
const send = (tok, conv, text) =>
  call(
    'POST',
    `/v1/conversations/${conv.conversationId}/messages`,
    {
      conversationId: conv.conversationId,
      clientMessageId: uuid(),
      messageType: 'text',
      content: { text, mentions: [] },
    },
    tok,
  );
await send(marco, ch, 'Morning all. UK panel is at 62% of quota for the retail tracker.');
await send(lena, ch, 'DE is behind on the 35-44 cell. Opening a boost sample this afternoon.');
await send(T, ch, 'Approved. Keep last wave incidence assumptions.');
await send(T, dm, 'Can you review the Q14 routing fix before 3pm?');
console.log(JSON.stringify({ channel: ch.conversationId, dm: dm.conversationId, people }, null, 2));
