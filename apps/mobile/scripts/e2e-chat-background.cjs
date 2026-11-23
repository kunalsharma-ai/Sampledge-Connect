const { chromium, devices } = require('playwright');
const fs = require('fs');
const pathMod = require('path');
// Own chat background picture end to end (kept on the device, nothing uploaded): Sam picks a
// photo for all chats, edits it (opacity, brightness, warmth, a filter, crop), sees it behind a
// conversation, sets a different one for one conversation, and removes it.
// Usage: pnpm web:export, then node scripts/e2e-chat-background.cjs <screenshot-dir> with the API
// seeded by e2e-seed.mjs.
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
  const convs = await api('GET', '/v1/conversations', undefined, sam);
  const list = Array.isArray(convs) ? convs : (convs.items ?? convs.conversations);
  const conv = list.find((c) => c.kind === 'channel') ?? list[0];

  const b = await chromium.launch({
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults',
    ],
  });
  const DIST = pathMod.join(__dirname, '..', 'dist-web');
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
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
  const apiPaths = [];
  p.on('request', (r) => r.url().startsWith(API) && apiPaths.push(new URL(r.url()).pathname));
  p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
  await p.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const inputs = p.locator('input');
  await inputs.nth(0).fill(APP);
  await inputs.nth(1).fill('northwind');
  await inputs.nth(2).fill('sam@northwind.test');
  await inputs.nth(3).fill(pw);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForTimeout(5000);
  const shot = async (n) => {
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  const body = () => p.innerText('body');
  const open = async () => {
    await p.goto(`${APP}/settings/chat-theme`);
    await p.waitForTimeout(3000);
  };

  // A colorful test photo, drawn by the browser.
  const photo = pathMod.join(out, 'test-photo.jpg');
  {
    const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    await pg.setContent(`<body style="margin:0;width:1600px;height:1000px;background:
      linear-gradient(180deg,#f6a85c 0%,#e0607e 45%,#3b2f6b 100%)">
      <div style="position:absolute;left:180px;top:230px;width:260px;height:260px;border-radius:50%;background:#ffd166"></div>
      <div style="position:absolute;left:0;right:0;bottom:0;height:380px;background:#1d1a3a;
        clip-path:polygon(0 60%,10% 40%,18% 55%,30% 20%,42% 50%,55% 10%,68% 45%,80% 25%,92% 50%,100% 35%,100% 100%,0 100%)"></div>
    </body>`);
    await pg.screenshot({ path: photo, type: 'jpeg', quality: 85 });
    await pg.close();
  }
  const usePhoto = async () => {
    const [chooser] = await Promise.all([
      p.waitForEvent('filechooser'),
      p.getByRole('button', { name: /Choose a photo|Replace photo/ }).click(),
    ]);
    await chooser.setFiles(photo);
    await p.waitForTimeout(2500);
  };
  const count = (sel) => p.locator(sel).count();
  const checked = (role, name) =>
    p.getByRole(role, { name, exact: true }).first().getAttribute('aria-checked');
  const valueText = (name) =>
    p.locator(`[aria-label="${name}"]`).first().getAttribute('aria-valuetext');

  // 1. Pick a photo for all chats from Chat theme.
  await p.goto(`${APP}/settings/chat-theme`);
  await p.waitForTimeout(3000);
  await p.getByRole('button', { name: 'Use your own picture' }).click();
  await p.waitForTimeout(1500);
  await shot('01-empty');
  await usePhoto();
  check('preview shows the photo', (await count('[data-testid="chat-background-photo"]')) === 1);
  await shot('02-picked');

  // 2. Edit: opacity, brightness, warmth (sliders by keyboard-free taps), a filter, crop.
  const slide = async (name, frac) => {
    const el = p
      .getByRole('adjustable', { name })
      .or(p.locator(`[aria-label="${name}"]`))
      .first();
    await el.scrollIntoViewIfNeeded();
    const bx = await el.boundingBox();
    await p.mouse.click(bx.x + bx.width * frac, bx.y + bx.height / 2);
    await p.waitForTimeout(200);
  };
  await slide('Opacity', 0.75);
  await slide('Brightness', 0.65);
  await slide('Warmth', 0.8);
  await slide('Dim for readability', 0.4);
  await shot('03-adjust');
  await p.getByRole('radio', { name: 'Filters', exact: true }).click();
  await p.waitForTimeout(800);
  await p.getByRole('radio', { name: 'Vivid filter' }).click();
  await p.waitForTimeout(800);
  await shot('04-filters');
  await p.getByRole('radio', { name: 'Crop & rotate' }).click();
  await p.waitForTimeout(500);
  await p.getByRole('radio', { name: '2×', exact: true }).click();
  const pv = await p.locator('[data-testid="chat-background-preview"]').boundingBox();
  await p.mouse.click(pv.x + pv.width * 0.2, pv.y + pv.height * 0.35);
  await p.waitForTimeout(800);
  await shot('05-crop');
  await p.getByRole('button', { name: 'Rotate right' }).click();
  await p.waitForTimeout(2000);
  // Kept on the device: reload and the edits are still there.
  await p.reload();
  await p.waitForTimeout(3500);
  check('photo kept after reload', (await count('[data-testid="chat-background-photo"]')) === 1);
  check('opacity kept', (await valueText('Opacity')) !== '100%');
  await p.getByRole('radio', { name: 'Filters', exact: true }).click();
  await p.waitForTimeout(500);
  check('filter kept', (await checked('radio', 'Vivid filter')) === 'true');
  await p.getByRole('radio', { name: 'Crop & rotate' }).click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Rotate left' }).click();
  await p.waitForTimeout(2000);

  // 3. Behind a conversation; bubbles keep their colors.
  await p.goto(`${APP}/conversation/${conv.conversationId}`);
  await p.waitForTimeout(3500);
  check('conversation shows the photo', (await count('[data-testid="chat-backdrop-photo"]')) === 1);
  await shot('06-conversation');

  // 4. A different picture for this conversation only (from Details), then remove it.
  await p.goto(
    `${APP}/chat-background?conversationId=${conv.conversationId}&title=${encodeURIComponent(conv.name ?? 'Chat')}`,
  );
  await p.waitForTimeout(2500);
  await usePhoto();
  await p.getByRole('radio', { name: 'Filters', exact: true }).click();
  await p.getByRole('radio', { name: 'Mono filter' }).click();
  await p.waitForTimeout(800);
  await p.goto(`${APP}/conversation/${conv.conversationId}`);
  await p.waitForTimeout(3500);
  await shot('07-conversation-own');
  check('nothing uploaded', !/chat-background|chat\.image/.test(apiPaths.join(' ')));

  // Remove both pictures: the conversation goes back to the chat theme.
  for (const url of [
    `${APP}/chat-background`,
    `${APP}/chat-background?conversationId=${conv.conversationId}`,
  ]) {
    await p.goto(url);
    await p.waitForTimeout(2500);
    await p.getByRole('button', { name: 'Remove', exact: true }).click();
    await p.waitForTimeout(1000);
  }
  await p.goto(`${APP}/conversation/${conv.conversationId}`);
  await p.waitForTimeout(3500);
  check('removed', (await count('[data-testid="chat-backdrop-photo"]')) === 0);

  await b.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
