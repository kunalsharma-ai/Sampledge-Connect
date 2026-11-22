const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Recurring meetings end to end: Sam schedules a weekly series from the phone; Priya's series
// is answered for every upcoming meeting while offline (sent once, in order, on reconnect) and
// one meeting is then declined on its own; Sam edits and cancels his whole series.
// Usage: pnpm web:export, then node scripts/e2e-recurring.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs.
const out = process.argv[2];
const API = process.env.API ?? 'http://localhost:4000';
const APP = 'http://localhost:8099';
const pw = 'correct-horse-battery-1';
const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};
async function api(method, path, body, token) {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : undefined;
}
const login = async (email) =>
  (
    await api('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email,
      password: pw,
      device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
    })
  ).accessToken;

(async () => {
  const sam = await login('sam@northwind.test');
  const priya = await login('priya@northwind.test');
  const users = await api('GET', '/v1/users', undefined, sam);
  const uid = (e) => users.find((u) => u.email === e).userId;
  const range = () => {
    const now = Date.now();
    return `from=${new Date(now - 86_400_000).toISOString()}&to=${new Date(now + 60 * 86_400_000).toISOString()}`;
  };
  const list = (tok) => api('GET', `/v1/meetings?${range()}`, undefined, tok);
  const run = Date.now().toString(36).slice(-4);
  // Leftovers from earlier runs would crowd the screenshots.
  for (const [tok, prefix] of [
    [priya, 'Daily stand-up '],
    [sam, 'Field sync '],
  ])
    for (const m of await list(tok))
      if (
        m.title.startsWith(prefix) &&
        m.organizerId === uid(tok === sam ? 'sam@northwind.test' : 'priya@northwind.test')
      )
        await api('POST', `/v1/meetings/${m.meetingId}/cancel`, { scope: 'series' }, tok).catch(
          () => {},
        );

  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const DIST = pathMod.join(__dirname, '..', 'dist-web');
  const newPhone = async (colorScheme) => {
    const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme });
    await ctx.route('http://localhost:8099/**', (route) => {
      const u = new URL(route.request().url());
      let f = pathMod.join(DIST, decodeURIComponent(u.pathname));
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        const html = f.replace(/\/$/, '') + '.html';
        f = fs.existsSync(html) ? html : pathMod.join(DIST, 'index.html');
      }
      const types = {
        '.js': 'text/javascript',
        '.html': 'text/html',
        '.wasm': 'application/wasm',
        '.css': 'text/css',
        '.ttf': 'font/ttf',
        '.png': 'image/png',
        '.json': 'application/json',
      };
      return route.fulfill({
        path: f,
        headers: {
          'content-type': types[pathMod.extname(f)] ?? 'application/octet-stream',
          'Cross-Origin-Embedder-Policy': 'credentialless',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
      });
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
    await p.goto(`${APP}/`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    const inputs = p.locator('input');
    await inputs.nth(0).fill(API);
    await inputs.nth(1).fill('northwind');
    await inputs.nth(2).fill('sam@northwind.test');
    await inputs.nth(3).fill(pw);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.waitForTimeout(4000);
    return { ctx, p };
  };
  const { ctx, p } = await newPhone('dark');
  const shot = async (n) => {
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };

  // 1. Sam schedules a weekly series: Tuesdays and Thursdays, six meetings.
  const title = `Field sync ${run}`;
  await p.goto(`${APP}/meetings/new`);
  await p.waitForTimeout(2500);
  await p.getByLabel('Meeting title').fill(title);
  await p.getByRole('button', { name: 'Add people' }).click();
  await p.waitForTimeout(800);
  await p.getByRole('checkbox', { name: 'Priya Shah' }).click();
  await p.getByRole('button', { name: 'Done' }).click();
  await p.waitForTimeout(2000);
  const suggested = p.getByRole('radio', { name: /^Suggested / });
  await suggested.first().click();
  const repeat = p.getByRole('radiogroup', { name: 'Repeat' });
  await repeat.getByRole('radio', { name: 'Weekly' }).click();
  const tue = p.getByRole('checkbox', { name: 'Tuesday' });
  const thu = p.getByRole('checkbox', { name: 'Thursday' });
  if (!(await tue.isChecked())) await tue.click();
  if (!(await thu.isChecked())) await thu.click();
  for (const d of ['Monday', 'Wednesday', 'Friday', 'Saturday', 'Sunday']) {
    const box = p.getByRole('checkbox', { name: d });
    if (await box.isChecked()) await box.click();
  }
  await p.getByRole('radio', { name: 'Ends after a number of meetings' }).click();
  for (let i = 0; i < 4; i++) await p.getByRole('button', { name: 'Fewer meetings' }).click();
  const summaryText = await p.innerText('body');
  console.log(
    'summary area:',
    (summaryText.match(/(Weekly|Every|Daily|Monthly)[^\n]*/g) ?? []).join(' / '),
  );
  await p.screenshot({ path: '/tmp/claude-0/dbg-repeat.png' });
  check(
    'summary reads "Weekly on Tue, Thu, 6 times"',
    /Weekly on Tue, Thu, 6 times/.test(summaryText),
  );
  await p.getByText('Weekly on Tue, Thu, 6 times').scrollIntoViewIfNeeded();
  await shot('01-repeat-weekly');
  await p.getByRole('button', { name: 'Send invites' }).click();
  await p.waitForTimeout(3500);
  let mine = (await list(sam)).filter((m) => m.title === title);
  const sid = mine[0]?.series?.seriesId;
  check(
    'server made the series (meetings in the next 60 days share one series)',
    mine.length >= 5 &&
      mine.every((m) => m.series?.seriesId === sid) &&
      mine.every((m) => [2, 4].includes(new Date(m.startsAt).getDay())),
  );
  check('series rule is weekly Tue/Thu, 6 times', mine[0]?.series?.recurrence?.endsAfter === 6);
  check(
    'the new meeting opens with its repeat line',
    /Weekly on Tue, Thu, 6 times/.test(await p.innerText('body')),
  );
  await shot('02-series-detail');

  // 2. Priya invites Sam to a daily stand-up (5 meetings). Sam answers for all, offline.
  const start = new Date(Date.now() + 2 * 86_400_000);
  start.setHours(9, 0, 0, 0);
  const standup = `Daily stand-up ${run}`;
  await api(
    'POST',
    '/v1/meetings',
    {
      title: standup,
      agenda: '',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 15 * 60_000).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      media: 'video',
      remindMinutes: [5],
      attendeeIds: [uid('sam@northwind.test')],
      recurrence: { frequency: 'daily', interval: 1, endsAfter: 5 },
    },
    priya,
  );
  await p.goto(`${APP}/meetings`);
  await p.waitForTimeout(3000);
  const standups = (await list(sam))
    .filter((m) => m.title === standup)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  check('Sam has the five stand-ups', standups.length === 5);
  await shot('03-meetings-list');
  await p.goto(`${APP}/meeting/${standups[1].meetingId}`);
  await p.waitForTimeout(2500);
  await ctx.setOffline(true);
  await p.waitForTimeout(800);
  await p.getByRole('radio', { name: 'Answer for all upcoming' }).click();
  await p.getByRole('radio', { name: 'Going', exact: true }).click();
  await p.waitForTimeout(800);
  check('saved on the phone while offline', /Saved on this phone/.test(await p.innerText('body')));
  await shot('04-answer-all-offline');
  // Then the third one, on its own: declined.
  await p.goto(`${APP}/meeting/${standups[2].meetingId}`);
  await p.waitForTimeout(2000);
  check(
    'the series answer shows on the other meetings at once',
    /Going/.test(await p.innerText('body')),
  );
  await p.getByRole('radio', { name: 'Answer for this meeting' }).click();
  await p.getByRole('radio', { name: 'Not going', exact: true }).click();
  await p.waitForTimeout(800);
  await ctx.setOffline(false);
  await p.waitForTimeout(6000);
  const answers = (await list(priya))
    .filter((m) => m.title === standup)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((m) => m.attendees.find((a) => a.userId === uid('sam@northwind.test')).response);
  console.log('answers', answers.join(','));
  check(
    'on reconnect: all accepted, then the third declined (in the order given)',
    JSON.stringify(answers) ===
      JSON.stringify(['accepted', 'accepted', 'declined', 'accepted', 'accepted']),
  );
  await p.goto(`${APP}/meetings`);
  await p.waitForTimeout(2500);
  check('nothing left waiting to send', !/not sent yet/.test(await p.innerText('body')));
  await shot('05-answers-synced');

  // 3. Sam moves his series to 30 minutes for every upcoming meeting.
  mine = (await list(sam))
    .filter((m) => m.title === title)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  await p.goto(`${APP}/meetings/new?edit=${mine[0].meetingId}`);
  await p.waitForTimeout(2500);
  await p.getByRole('radio', { name: 'This and all upcoming' }).click();
  await p.getByLabel('Meeting title').fill(`${title} (weekly)`);
  await p.waitForTimeout(500);
  await p.getByText('Changes every meeting of the series').scrollIntoViewIfNeeded();
  await shot('06-edit-series');
  await p.getByRole('button', { name: 'Save changes' }).click();
  await p.waitForTimeout(3000);
  const renamed = (await list(sam)).filter((m) => m.series?.seriesId === sid);
  check(
    'series edit renamed every upcoming meeting',
    renamed.length >= 5 && renamed.every((m) => m.title === `${title} (weekly)`),
  );

  // 4. Cancel all upcoming.
  await p.goto(`${APP}/meeting/${mine[0].meetingId}`);
  await p.waitForTimeout(2500);
  p.on('dialog', (d) => void d.accept());
  await p.getByRole('button', { name: 'Cancel all upcoming' }).click();
  await p.waitForTimeout(800);
  const confirm = p.getByRole('button', { name: 'Cancel all upcoming' }).last();
  if ((await p.getByRole('button', { name: 'Cancel all upcoming' }).count()) > 1)
    await confirm.click();
  await p.waitForTimeout(3500);
  const after = (
    await api('GET', `/v1/meetings?${range()}&includeCancelled=true`, undefined, sam)
  ).filter((m) => m.series?.seriesId === sid);
  check(
    'every upcoming meeting of the series is cancelled',
    after.length > 0 && after.every((m) => m.status === 'cancelled'),
  );
  await shot('07-cancelled-series');

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
