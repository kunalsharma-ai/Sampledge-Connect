const { chromium, devices } = require('playwright');
const out = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
  const shot = async (n) => {
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/${n}.png` });
    console.log('shot', n);
  };
  await p.goto('http://localhost:8099/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await shot('01-sign-in');
  await p.getByText('Explore the offline demo').click();
  await p.waitForTimeout(2500);
  await shot('02-home');
  await p
    .getByRole('tab', { name: /Messages/ })
    .click()
    .catch(() => p.getByText('Messages').last().click());
  await shot('03-messages');
  await p.getByText('# fieldwork-ops').last().click();
  await p.waitForTimeout(1200);
  await shot('04-conversation');
  const box = p.locator('textarea').last();
  await box.fill('Boost sample approved. Queue it for this afternoon please.');
  await shot('05-composer');
  await p.getByRole('button', { name: 'Send message' }).click();
  await shot('06-queued-offline');
  await p.goto('http://localhost:8099/more');
  await p.waitForTimeout(1500);
  await shot('07-more');
  await p.goto('http://localhost:8099/settings/appearance');
  await p.waitForTimeout(1200);
  await shot('08-themes');
  await p.getByRole('radio', { name: 'Arctic Professional' }).click();
  await shot('09-arctic-theme');
  await p.getByRole('radio', { name: 'Royal Graphite' }).click();
  await p.goto('http://localhost:8099/messages');
  await p.waitForTimeout(1500);
  await shot('10-graphite-messages');
  await p.goto('http://localhost:8099/planned/files');
  await p.waitForTimeout(1200);
  await shot('11-planned-module');
  await p.goto('http://localhost:8099/settings/storage');
  await p.waitForTimeout(1200);
  await shot('12-offline-storage');
  await b.close();
})();
