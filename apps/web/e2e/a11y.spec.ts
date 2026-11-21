/**
 * WCAG 2.2 AA checks with axe-core on the main screens, in the dark and light themes
 * and at phone size. Serious and critical issues fail the run.
 */
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const API = process.env.API_URL ?? 'http://localhost:4000';
const THEMES = ['midnight-executive', 'arctic-professional'] as const;

let org: { slug: string; email: string; password: string };

test.beforeAll(async () => {
  const slug = `a11y-${Date.now().toString(36)}`;
  org = { slug, email: `owner@${slug}.test`, password: 'accessibility check 2026' };
  const res = await fetch(`${API}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationName: 'Accessibility Check',
      tenantSlug: slug,
      ownerName: 'Ada Owner',
      ownerEmail: org.email,
      password: org.password,
      device: { deviceId: randomUUID(), name: 'a11y', platform: 'web' },
    }),
  });
  expect(res.status, await res.text()).toBe(201);
});

async function audit(page: Page, label: string) {
  await page.waitForTimeout(600); // let entrance animations settle
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const summary = blocking.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`)
        .join('\n'),
  );
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

async function useTheme(page: Page, theme: string) {
  await page.addInitScript((t) => {
    try {
      if (!sessionStorage.getItem('a11y-theme')) {
        localStorage.setItem('sampledge.theme', t);
        sessionStorage.setItem('a11y-theme', '1');
      }
    } catch {}
  }, theme);
}

async function signIn(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.fill('input[name=workspace]', org.slug);
  await page.fill('input[name=email]', org.email);
  await page.fill('input[name=password]', org.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/app', { timeout: 30_000 });
  await page.waitForTimeout(1200);
}

async function openModule(page: Page, name: RegExp) {
  const rail = page.getByRole('navigation', { name: 'Modules' }).getByRole('button', { name });
  if (await rail.first().isVisible()) {
    await rail.first().click();
  } else {
    // Phone layout: modules other than the four main tabs live behind "More".
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const sheet = page.getByRole('navigation', { name: 'More modules' });
    await audit(page, 'more sheet');
    await sheet.getByRole('button', { name }).first().click();
  }
  await page.waitForTimeout(800);
}

for (const theme of THEMES) {
  test.describe(theme, () => {
    test.beforeEach(({ page }) => useTheme(page, theme));

    test('public pages', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('heading', { level: 1 }).waitFor();
      await audit(page, 'home');
      await page.goto('/login');
      await audit(page, 'login');
      await page.goto('/register');
      await audit(page, 'register');
    });

    test('workspace screens', async ({ page }) => {
      await signIn(page);
      await audit(page, 'home');
      for (const m of [
        /^Messages/,
        /^Universal Search/,
        /^Files/,
        /^Administration/,
        /^Integrations/,
        /^Billing/,
        /^Branding/,
        /^Notifications/,
        /^Tasks/,
        /^Projects/,
        /^Meetings/,
        /^Recordings/,
        /^AI Assistant/,
        /^Saved/,
        /^Teams/,
      ]) {
        await openModule(page, m);
        await audit(page, String(m));
      }
    });
  });
}
