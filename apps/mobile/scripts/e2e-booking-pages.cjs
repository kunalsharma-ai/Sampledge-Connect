const { chromium, devices } = require('playwright');
// Booking pages end to end: Sam makes one with Marco as co-host, Marco's edits show live, and
// changes made offline reach the server on reconnect.
// Usage: pnpm web:export, then node scripts/e2e-offline-actions.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs. The app's files are served from dist-web by the browser itself, so
// they still load while the network is off (as on a phone); only the server is unreachable.
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
const tokenOf = async (email) =>
  (
    await api('POST', '/v1/auth/login', {
      tenantSlug: 'northwind',
      email,
      password: pw,
      device: { deviceId: crypto.randomUUID(), name: 'e2e', platform: 'web' },
    })
  ).accessToken;

(async () => {
  const samTok = await tokenOf('sam@northwind.test');
  const marcoTok = await tokenOf('marco@northwind.test');
  const priyaTok = await tokenOf('priya@northwind.test');
  const users = await api('GET', '/v1/users', undefined, samTok);
  const sam = users.find((u) => u.email === 'sam@northwind.test');
  const convs = await api('GET', '/v1/conversations', undefined, samTok);
  const ops = (Array.isArray(convs) ? convs : convs.conversations).find(
    (c) => c.name === 'fieldwork-ops',
  );
  const run = Date.now().toString(36).slice(-4);
  const post = async (text, tok) =>
    api(
      'POST',
      `/v1/conversations/${ops.conversationId}/messages`,
      {
        conversationId: ops.conversationId,
        clientMessageId: crypto.randomUUID(),
        messageType: 'text',
        content: { text, mentions: [] },
      },
      tok,
    );
  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
  // The app's own files come from disk, as they do on a phone; only the API goes offline.
  const fs = require('fs');
  const pathMod = require('path');
  const DIST = pathMod.join(__dirname, '..', 'dist-web');
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
  p.on('console', (m) => m.type() === 'error' && console.log('console:', m.text().slice(0, 200)));
  p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
  const shot = async (n) => {
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  await p.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const inputs = p.locator('input');
  await inputs.nth(0).fill(API);
  await inputs.nth(1).fill('northwind');
  await inputs.nth(2).fill('sam@northwind.test');
  await inputs.nth(3).fill(pw);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForTimeout(4000);

  const marco = users.find((u) => u.email === 'marco@northwind.test');
  const slug = `intro-${run}`;
  // Start clean (an earlier run may have stopped half way).
  for (const old of await api('GET', '/v1/booking-pages', undefined, samTok))
    await api('DELETE', `/v1/booking-pages/${old.bookingPageId}`, undefined, samTok);
  for (const path of ['/meetings', '/booking-pages', '/booking-pages/new', '/booking-pages/x']) {
    await p.goto(`${APP}${path}`);
    await p.waitForTimeout(1500);
  }

  // From Meetings into Booking pages, then a new page with Marco as a co-host.
  await p.goto(`${APP}/meetings`);
  await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Booking pages', exact: true }).click();
  await p.waitForTimeout(1500);
  check(
    'empty state explains booking pages',
    /No booking pages yet/.test(await p.innerText('body')),
  );
  await p.getByRole('button', { name: 'New booking page' }).click();
  await p.waitForTimeout(1500);
  await p.getByLabel('Name', { exact: true }).fill(`Intro call with Northwind (${run})`);
  await p.getByLabel('Link', { exact: true }).fill(slug);
  await p
    .getByLabel('Description', { exact: true })
    .fill('Tell us about your study and timelines.');
  await p
    .getByRole('radiogroup', { name: 'Length' })
    .getByRole('radio', { name: '45 min', exact: true })
    .click();
  await p.getByRole('checkbox', { name: /^Marco/ }).click();
  await p.waitForTimeout(400);
  check(
    'the who-attends choice shows with two hosts',
    (await p.getByRole('radio', { name: 'All hosts' }).count()) > 0,
  );
  await p.getByRole('radio', { name: '1 day' }).click();
  await shot('01-new-booking-page');
  await p.getByRole('button', { name: 'Create booking page' }).click();
  await p.waitForTimeout(3000);
  const body1 = await p.innerText('body');
  check(
    'the new page is listed with its public link',
    body1.includes(`/book/${slug}`) && body1.includes('45 min'),
  );
  check('co-host named on the card', /With you and Marco/.test(body1));
  const pages = await api('GET', '/v1/booking-pages', undefined, samTok);
  const page = pages.find((x) => x.slug === slug);
  check(
    'the page reached the server once, with Marco as host',
    pages.filter((x) => x.slug === slug).length === 1 &&
      page.hostIds.includes(marco.userId) &&
      page.durationMinutes === 45 &&
      page.minNoticeMinutes === 1440,
  );
  await shot('02-booking-pages-list');

  // A co-host renames it on the web: Sam's list follows live.
  const renamed = `Intro call: research partners (${run})`;
  await api('PATCH', `/v1/booking-pages/${page.bookingPageId}`, { title: renamed }, marcoTok);
  await p.waitForTimeout(2500);
  check("Marco's change shows live", (await p.innerText('body')).includes(renamed));

  // Offline: pause it and change the length; both reach the server on reconnect.
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  await p.getByRole('switch', { name: `Taking bookings: ${renamed}` }).click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: `Edit ${renamed}` }).click();
  await p.waitForTimeout(1500);
  await p
    .getByRole('radiogroup', { name: 'Length' })
    .getByRole('radio', { name: '30 min', exact: true })
    .click();
  await p
    .getByRole('radiogroup', { name: 'Gap before and after' })
    .getByRole('radio', { name: '10 min', exact: true })
    .click();
  await shot('03-edit-offline');
  await p.getByRole('button', { name: 'Save changes' }).click();
  await p.waitForTimeout(1500);
  const body2 = await p.innerText('body');
  check(
    'offline changes show at once, marked as waiting',
    /Paused/.test(body2) && /Waiting to sync/.test(body2) && body2.includes('30 min'),
  );
  await shot('04-list-offline');
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  const after = (await api('GET', '/v1/booking-pages', undefined, samTok)).find(
    (x) => x.bookingPageId === page.bookingPageId,
  );
  check(
    'the offline edit reached the server',
    after.enabled === false &&
      after.durationMinutes === 30 &&
      after.bufferMinutes === 10 &&
      after.title === renamed,
  );
  check('nothing waits to sync any more', !/Waiting to sync/.test(await p.innerText('body')));
  await shot('05-back-online');
  await p.emulateMedia({ colorScheme: 'light' });
  await p.waitForTimeout(800);
  await shot('06-booking-pages-arctic');

  // Deleted on another device: gone here too.
  await api('DELETE', `/v1/booking-pages/${page.bookingPageId}`, undefined, marcoTok);
  await p.waitForTimeout(2500);
  check('a delete by the co-host shows live', !(await p.innerText('body')).includes(renamed));

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
