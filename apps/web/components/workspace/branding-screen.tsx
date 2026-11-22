'use client';
import * as React from 'react';
import { ImageUp, Palette, Trash2 } from 'lucide-react';
import {
  DEFAULT_APP_NAME,
  LOGO_MAX_BYTES,
  type BrandingInput,
  type BrandingView,
} from '@sampledge/contracts';
import { createBrandTheme } from '@sampledge/design-tokens';
import { Badge, Button, Field, Input, StateView, cn, useToast } from '@sampledge/ui';
import { ApiFailure, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOrgBranding } from '@/lib/org-branding';
import { LogoMark } from '../brand';
import { FeatureHelp } from '../feature-help';

type Draft = Required<{ [K in keyof BrandingInput]: NonNullable<BrandingInput[K]> | null }>;
const toDraft = (b: BrandingView): Draft => ({
  appName: b.appName,
  logo: b.logo,
  primary: b.primary,
  secondary: b.secondary,
  mode: b.mode,
  useBrandTheme: b.useBrandTheme,
  enforceTheme: b.enforceTheme,
  loginMessage: b.loginMessage,
  supportEmail: b.supportEmail,
  supportUrl: b.supportUrl,
  hidePoweredBy: b.hidePoweredBy,
});
const blank = (v: string | null) => (v && v.trim() ? v.trim() : null);

function Toggle({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={cn('flex items-start gap-3', disabled && 'opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors',
          checked ? 'bg-accent' : 'bg-surface-sunken ring-1 ring-border',
        )}
      >
        <span
          className={cn(
            'block size-5 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
      <span>
        <span className="block text-label text-text">{label}</span>
        <span className="block text-meta text-text-subtle">{help}</span>
      </span>
    </label>
  );
}

/** Administration → Branding (white-label). Saved with the organization in the database. */
export function BrandingScreen() {
  const { getAccessToken } = useAuth();
  const { replace } = useOrgBranding();
  const { toast } = useToast();
  const [view, setView] = React.useState<BrandingView | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        const v = await apiRequest<BrandingView>('GET', '/v1/branding', {
          token: await getAccessToken(),
        });
        setView(v);
        setDraft(toDraft(v));
      } catch (e) {
        setError(e instanceof ApiFailure ? e.error.message : (e as Error).message);
      }
    })();
  }, [getAccessToken]);

  if (!view || !draft)
    return (
      <main className="flex flex-1 items-center justify-center pb-16 md:pb-0">
        {error ? (
          <StateView state="error" description={error} />
        ) : (
          <StateView state="loading" title="Loading branding" />
        )}
      </main>
    );

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const ro = !view.canManage;
  const theme = createBrandTheme({
    primary: draft.primary!,
    secondary: draft.secondary!,
    mode: draft.mode!,
  });
  const c = theme.colors;
  const name = blank(draft.appName) ?? DEFAULT_APP_NAME;
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(view));

  async function pickLogo(file: File) {
    setError(null);
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type))
      return setError('Use a PNG, JPEG, WebP or SVG image.');
    if (file.size > LOGO_MAX_BYTES) return setError('The logo must be 256 KB or smaller.');
    const url = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    set('logo', url);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const v = await apiRequest<BrandingView>('PUT', '/v1/branding', {
        token: await getAccessToken(),
        body: {
          ...draft,
          appName: blank(draft!.appName),
          loginMessage: blank(draft!.loginMessage),
          supportEmail: blank(draft!.supportEmail),
          supportUrl: blank(draft!.supportUrl),
        },
      });
      setView(v);
      setDraft(toDraft(v));
      replace(v);
      toast({
        title: 'Branding saved',
        description: 'Everyone sees it the next time their app loads.',
        tone: 'success',
      });
    } catch (e) {
      setError(e instanceof ApiFailure ? e.error.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" data-testid="branding-screen">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <Palette className="size-5 text-accent" aria-hidden />
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-display text-h3 text-text">Branding</h1>
          <FeatureHelp id="branding" />
        </div>
        <p className="hidden text-meta text-text-subtle md:block">
          Your name, logo and colors across the app, the sign-in page and emails.
        </p>
        {ro ? <Badge className="ml-auto">Only the owner can change this</Badge> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_420px]">
          <fieldset disabled={ro} className="grid content-start gap-5">
            <section className="grid gap-4 rounded-xl border border-border bg-surface p-5">
              <h2 className="text-label text-text">Name and logo</h2>
              <Field
                label="App name"
                htmlFor="b-name"
                hint={`Replaces “${DEFAULT_APP_NAME}” in the browser tab, emails and authenticator apps. Leave empty to keep it.`}
              >
                <Input
                  id="b-name"
                  value={draft.appName ?? ''}
                  placeholder={DEFAULT_APP_NAME}
                  maxLength={40}
                  onChange={(e) => set('appName', e.target.value)}
                />
              </Field>
              <div>
                <p className="mb-1.5 text-label text-text">Logo</p>
                <div className="flex items-center gap-3">
                  <span className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-sunken">
                    {draft.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={draft.logo}
                        alt="Logo preview"
                        className="size-full object-contain"
                      />
                    ) : (
                      <LogoMark className="size-10" />
                    )}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    aria-label="Logo file"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void pickLogo(f);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImageUp /> Upload
                  </Button>
                  {draft.logo ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => set('logo', null)}
                    >
                      <Trash2 /> Remove
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1.5 text-meta text-text-subtle">
                  Square PNG, SVG, JPEG or WebP, up to 256 KB.
                </p>
              </div>
            </section>

            <section className="grid gap-4 rounded-xl border border-border bg-surface p-5">
              <h2 className="text-label text-text">Colors</h2>
              <div className="flex flex-wrap items-end gap-4">
                {(['primary', 'secondary'] as const).map((k) => (
                  <Field
                    key={k}
                    label={k === 'primary' ? 'Primary' : 'Secondary'}
                    htmlFor={`b-${k}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        id={`b-${k}`}
                        type="color"
                        value={draft[k]!}
                        onChange={(e) => set(k, e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded-md border border-border bg-transparent"
                      />
                      <Input
                        aria-label={`${k} hex`}
                        value={draft[k]!}
                        onChange={(e) => set(k, e.target.value)}
                        className="w-28 font-mono uppercase"
                        maxLength={7}
                      />
                    </div>
                  </Field>
                ))}
                <div
                  className="flex gap-1 rounded-md border border-border p-1"
                  role="group"
                  aria-label="Base"
                >
                  {(['dark', 'light'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={draft.mode === m}
                      onClick={() => set('mode', m)}
                      className={cn(
                        'h-8 rounded-sm px-3 text-label capitalize',
                        draft.mode === m
                          ? 'bg-surface-raised text-text shadow-sm'
                          : 'text-text-muted',
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-meta text-text-subtle">
                Text and button contrast are corrected automatically to meet WCAG AA.
              </p>
              <Toggle
                label="Start everyone on this theme"
                help="Members switch to it once; they can still pick another theme in Settings."
                checked={!!draft.useBrandTheme}
                onChange={(v) => set('useBrandTheme', v)}
              />
              <Toggle
                label="Always use this theme"
                help="Members can’t choose another theme."
                checked={!!draft.enforceTheme}
                onChange={(v) => set('enforceTheme', v)}
              />
            </section>

            <section className="grid gap-4 rounded-xl border border-border bg-surface p-5">
              <h2 className="text-label text-text">Sign-in page and support</h2>
              <Field
                label="Message on the sign-in page"
                htmlFor="b-msg"
                hint="Shown once someone types your workspace name."
              >
                <Input
                  id="b-msg"
                  value={draft.loginMessage ?? ''}
                  maxLength={280}
                  placeholder="Use your company email. Trouble? Call IT on 1234."
                  onChange={(e) => set('loginMessage', e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Support email" htmlFor="b-mail">
                  <Input
                    id="b-mail"
                    type="email"
                    value={draft.supportEmail ?? ''}
                    placeholder="it@company.com"
                    onChange={(e) => set('supportEmail', e.target.value)}
                  />
                </Field>
                <Field label="Support page" htmlFor="b-url">
                  <Input
                    id="b-url"
                    type="url"
                    value={draft.supportUrl ?? ''}
                    placeholder="https://help.company.com"
                    onChange={(e) => set('supportUrl', e.target.value)}
                  />
                </Field>
              </div>
              <Toggle
                label={`Hide “${DEFAULT_APP_NAME}”`}
                help="Removes the product name from emails and the sign-in page."
                checked={!!draft.hidePoweredBy}
                onChange={(v) => set('hidePoweredBy', v)}
              />
            </section>
            {error ? (
              <p role="alert" className="text-label font-normal text-danger">
                {error}
              </p>
            ) : null}
            {!ro ? (
              <div className="flex gap-2">
                <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
                  Save branding
                </Button>
                <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(toDraft(view))}>
                  Discard changes
                </Button>
              </div>
            ) : null}
          </fieldset>

          <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Preview">
            <p className="mb-2 text-meta text-text-subtle">Preview</p>
            <div
              className="overflow-hidden rounded-xl border border-border shadow-md"
              style={{ background: c.bg }}
              data-testid="branding-preview"
            >
              <div
                className="flex items-center gap-2.5 border-b px-4 py-3"
                style={{ borderColor: c.border, background: c.surface }}
              >
                {draft.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.logo} alt="" className="size-8 rounded-md object-contain" />
                ) : (
                  <span
                    className="size-8 rounded-md"
                    style={{ background: `linear-gradient(135deg, ${c.accent}, ${c.accent2})` }}
                  />
                )}
                <span className="font-display text-[15px] font-bold" style={{ color: c.text }}>
                  {name}
                </span>
              </div>
              <div className="grid gap-3 p-5">
                <p className="font-display text-[20px] font-bold" style={{ color: c.text }}>
                  Welcome back
                </p>
                <p className="text-meta" style={{ color: c.textMuted }}>
                  Sign in to {view.organizationName}.
                </p>
                {blank(draft.loginMessage) ? (
                  <p
                    className="rounded-md px-3 py-2 text-meta"
                    style={{ background: c.surfaceRaised, color: c.text }}
                  >
                    {draft.loginMessage}
                  </p>
                ) : null}
                <span
                  className="h-9 rounded-md border"
                  style={{ borderColor: c.border, background: c.surfaceSunken }}
                />
                <span
                  className="flex h-10 items-center justify-center rounded-lg text-label"
                  style={{ background: c.accent, color: c.accentFg }}
                >
                  Sign in
                </span>
                <div
                  className="mt-2 flex items-center gap-2 rounded-lg p-3"
                  style={{ background: c.surface }}
                >
                  <span className="size-7 rounded-full" style={{ background: c.accent2 }} />
                  <span className="flex-1 text-meta" style={{ color: c.text }}>
                    Ravi: the client approved the Q4 plan
                  </span>
                  <span
                    className="rounded-full px-2 text-[11px] font-semibold"
                    style={{ background: c.accent, color: c.accentFg }}
                  >
                    2
                  </span>
                </div>
                {!draft.hidePoweredBy && blank(draft.appName) ? (
                  <p className="text-center text-[11px]" style={{ color: c.textSubtle }}>
                    with {DEFAULT_APP_NAME}
                  </p>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
