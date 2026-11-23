const { chromium, devices } = require('playwright');
// Profiles end to end: Marco's new photo shows live on Sam's phone; Sam edits the profile, takes
// a photo from the library (cropped to a square), and changes made offline reach the server.
// Usage: pnpm web:export, then node scripts/e2e-offline-actions.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs. The app's files are served from dist-web by the browser itself, so
// they still load while the network is off (as on a phone); only the server is unreachable.
const out = process.argv[2];
const API = process.env.API ?? 'http://localhost:4000/api';
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
  await inputs.nth(0).fill(APP);
  await inputs.nth(1).fill('northwind');
  await inputs.nth(2).fill('sam@northwind.test');
  await inputs.nth(3).fill(pw);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForTimeout(4000);

  const marco = users.find((u) => u.email === 'marco@northwind.test');

  // Two pictures made in the browser: a square one for Marco (sent from "the web"), and a
  // landscape one Sam picks from the library (the app crops it to the centred square).
  const pic = async (w, h, a, b, label, file) => {
    const pg = await b0.newPage({ viewport: { width: w, height: h } });
    // A simple portrait: head and shoulders on a soft background (reads as a photo, not initials).
    const u = Math.min(w, h);
    await pg.setContent(`<body style="margin:0"><div style="position:relative;width:${w}px;height:${h}px;overflow:hidden;background:radial-gradient(circle at 30% 25%, ${a}, ${b})">
      <div style="position:absolute;left:${w / 2 - u * 0.17}px;top:${h / 2 - u * 0.33}px;width:${u * 0.34}px;height:${u * 0.4}px;border-radius:50%;background:#f1c7a3"></div>
      <div style="position:absolute;left:${w / 2 - u * 0.19}px;top:${h / 2 - u * 0.37}px;width:${u * 0.38}px;height:${u * 0.18}px;border-radius:${u * 0.2}px ${u * 0.2}px 40% 40%;background:${label}"></div>
      <div style="position:absolute;left:${w / 2 - u * 0.38}px;top:${h / 2 + u * 0.12}px;width:${u * 0.76}px;height:${u * 0.6}px;border-radius:50% 50% 0 0;background:rgba(15,23,42,.85)"></div>
    </div></body>`);
    await pg.screenshot({ path: file, type: 'jpeg', quality: 85 });
    await pg.close();
    return require('fs').readFileSync(file).toString('base64');
  };
  const b0 = b;
  const marcoPic = await pic(
    512,
    512,
    '#f6c177',
    '#c4467a',
    '#3b2416',
    require('path').join(require('os').tmpdir(), 'marco-src.jpg'),
  );
  const samFile = require('path').join(require('os').tmpdir(), 'sam-library.jpg');
  await pic(1200, 800, '#a7f3d0', '#0e7490', '#111827', samFile);

  // Start from a clean profile.
  await api('DELETE', '/v1/me/avatar', undefined, samTok);
  await api('DELETE', '/v1/me/avatar', undefined, marcoTok);
  await api(
    'PATCH',
    '/v1/me/profile',
    { title: null, department: null, phone: null, bio: null, timeZone: null },
    samTok,
  );
  for (const path of [
    '/more',
    '/settings/profile',
    `/person/${marco.userId}`,
    `/conversation-info/${ops.conversationId}`,
  ]) {
    await p.goto(`${APP}${path}`);
    await p.waitForTimeout(1500);
  }

  // Marco changes his photo and title on the web: Sam's member list follows live.
  await p.goto(`${APP}/conversation-info/${ops.conversationId}`);
  await p.waitForTimeout(2500);
  check('no photos before', (await p.locator('img').count()) === 0);
  await api('PUT', '/v1/me/avatar', { image: `data:image/jpeg;base64,${marcoPic}` }, marcoTok);
  await api(
    'PATCH',
    '/v1/me/profile',
    {
      title: 'Field director',
      department: 'Operations',
      phone: '+44 20 7946 0958',
      timeZone: 'Europe/London',
      bio: 'Runs fieldwork across the UK and DACH. Ask me about recruitment.',
    },
    marcoTok,
  );
  await p.waitForTimeout(3000);
  check("Marco's new photo shows live in the member list", (await p.locator('img').count()) >= 1);
  await shot('01-member-photo-live');
  await p.getByRole('button', { name: /^Profile of Marco/ }).click();
  await p.waitForTimeout(2000);
  const card = await p.innerText('body');
  check(
    "Marco's profile card shows title, department, phone and local time",
    /Field director/.test(card) &&
      /Operations/.test(card) &&
      /\+44 20 7946 0958/.test(card) &&
      /local time/.test(card),
  );
  await shot('02-profile-card');

  // Sam: More → profile → edit details and pick a photo.
  await p.goto(`${APP}/more`);
  await p.waitForTimeout(2000);
  await p.getByRole('button', { name: /Edit profile and photo/ }).click();
  await p.waitForTimeout(2000);
  await p.getByLabel('Job title', { exact: true }).fill('Senior research analyst');
  await p.getByLabel('Department', { exact: true }).fill('Quant research');
  await p.getByLabel('Phone', { exact: true }).fill('+91 98765 43210');
  await p
    .getByLabel('About you', { exact: true })
    .fill('Questionnaire design and panel quality. Hindi, English, Marathi.');
  await p.getByLabel('Time zone', { exact: true }).fill('Asia/Kolkata');
  await p.getByRole('button', { name: 'Save profile' }).click();
  await p.waitForTimeout(2500);
  const meAfter = (await api('GET', '/v1/users', undefined, marcoTok)).find(
    (u) => u.userId === sam.userId,
  );
  check(
    'the profile reached the server',
    meAfter.title === 'Senior research analyst' &&
      meAfter.department === 'Quant research' &&
      meAfter.phone === '+91 98765 43210' &&
      meAfter.timeZone === 'Asia/Kolkata',
  );
  const chooser = p.waitForEvent('filechooser');
  await p.getByRole('button', { name: 'Choose photo' }).click();
  await (await chooser).setFiles(samFile);
  await p.waitForTimeout(4000);
  const withPhoto = (await api('GET', '/v1/users', undefined, marcoTok)).find(
    (u) => u.userId === sam.userId,
  );
  check('the photo was uploaded', !!withPhoto.avatarUrl);
  if (withPhoto.avatarUrl) {
    const img = await fetch(new URL(withPhoto.avatarUrl, API));
    const bytes = Buffer.from(await img.arrayBuffer());
    // JPEG SOF0/SOF2 marker holds height then width.
    let w = 0,
      h = 0;
    for (let i = 2; i < bytes.length - 9; i++)
      if (bytes[i] === 0xff && (bytes[i + 1] === 0xc0 || bytes[i + 1] === 0xc2)) {
        h = bytes.readUInt16BE(i + 5);
        w = bytes.readUInt16BE(i + 7);
        break;
      }
    check(
      `the photo is a 512 px square JPEG under 160 KB (${w}x${h}, ${bytes.length} B)`,
      img.headers.get('content-type') === 'image/jpeg' &&
        w === 512 &&
        h === 512 &&
        bytes.length <= 160 * 1024,
    );
  }
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot('03-my-profile');

  // Offline: change the about text and remove the photo; both reach the server on reconnect.
  await ctx.setOffline(true);
  await p.waitForTimeout(1500);
  await p
    .getByLabel('About you', { exact: true })
    .fill('Questionnaire design and panel quality. Back Monday.');
  await p.getByRole('button', { name: 'Save profile' }).click();
  await p.waitForTimeout(1200);
  check('saved offline with a note', /Saved on this phone/.test(await p.innerText('body')));
  await p.getByRole('button', { name: 'Remove photo' }).click();
  await p.waitForTimeout(400);
  const confirm = p.getByRole('button', { name: 'Remove', exact: true });
  if (await confirm.count()) await confirm.last().click();
  await p.waitForTimeout(1200);
  check(
    'initials show at once offline',
    !(await p.getByRole('button', { name: 'Remove photo' }).count()),
  );
  await shot('04-offline-edit');
  await ctx.setOffline(false);
  await p.waitForTimeout(7000);
  const synced = (await api('GET', '/v1/users', undefined, marcoTok)).find(
    (u) => u.userId === sam.userId,
  );
  check(
    'offline changes reached the server, and nothing else was cleared',
    synced.avatarUrl === null &&
      /Back Monday/.test(synced.bio) &&
      synced.title === 'Senior research analyst' &&
      synced.timeZone === 'Asia/Kolkata',
  );

  // Put a photo back for the remaining shots.
  const chooser2 = p.waitForEvent('filechooser');
  await p.getByRole('button', { name: 'Choose photo' }).click();
  await (await chooser2).setFiles(samFile);
  await p.waitForTimeout(4000);
  await p.goto(`${APP}/more`);
  await p.waitForTimeout(2500);
  check(
    'the More tab shows the new title',
    /Senior research analyst/.test(await p.innerText('body')),
  );
  await shot('05-more-tab');
  await p.emulateMedia({ colorScheme: 'light' });
  await p.goto(`${APP}/person/${marco.userId}`);
  await p.waitForTimeout(2500);
  await shot('06-profile-card-arctic');

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
