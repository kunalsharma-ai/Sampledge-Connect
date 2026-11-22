'use client';
import * as React from 'react';
import { Ban, Building2, ImagePlus, Sparkles, Trash2 } from 'lucide-react';
import {
  CALL_BACKGROUND_PRESETS,
  callBackgroundThumbPath,
  type CallBackgroundChoice,
  type CallBackgroundState,
  type CallBackgroundUpload,
} from '@sampledge/contracts';
import { Button, StateView, cn, useToast } from '@sampledge/ui';
import { ApiFailure, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { logoBackground, shrinkImage } from '@/lib/call-backgrounds';
import { API_URL } from '@/lib/config';
import { useEngineChange } from '@/lib/engine';
import { FeatureHelp } from '../feature-help';

const label = (c: CallBackgroundChoice, uploads: CallBackgroundUpload[] = []) =>
  c.kind === 'none'
    ? 'No effect'
    : c.kind === 'blur'
      ? 'Blur'
      : c.kind === 'logo'
        ? 'Company background'
        : c.kind === 'preset'
          ? (CALL_BACKGROUND_PRESETS.find((p) => p.id === c.presetId)?.name ?? 'Image')
          : c.kind === 'upload'
            ? (uploads.find((u) => u.imageId === c.imageId)?.name ?? 'Company background')
            : 'Own image';

const sameChoice = (a: CallBackgroundChoice, b: CallBackgroundChoice) =>
  a.kind === b.kind &&
  (a.kind !== 'preset' || (b.kind === 'preset' && a.presetId === b.presetId)) &&
  (a.kind !== 'upload' || (b.kind === 'upload' && a.imageId === b.imageId));

/**
 * Administration → Calls: the background everyone starts with, and whether the company
 * background (logo and colors from Branding) is required in calls.
 */
export function CallBackgroundsAdmin() {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [state, setState] = React.useState<CallBackgroundState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{
    defaultChoice: CallBackgroundChoice;
    enforceLogo: boolean;
  } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [logo, setLogo] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);

  useEngineChange(['tenant'], (e) => {
    if (
      e.type === 'reconnected' ||
      (e.type === 'tenant' && (e.area === 'calls' || e.area === 'branding'))
    )
      setVersion((v) => v + 1);
  });

  React.useEffect(() => {
    void (async () => {
      try {
        const s = await apiRequest<CallBackgroundState>('GET', '/v1/me/call-background', {
          token: await getAccessToken(),
        });
        setState(s);
        setDraft({ defaultChoice: s.policy.defaultChoice, enforceLogo: s.policy.enforceLogo });
        setLogo(await logoBackground(s.brand));
      } catch (e) {
        setError(e instanceof ApiFailure ? e.error.message : 'Could not load call settings');
      }
    })();
  }, [getAccessToken, version]);

  const companyUploads = (state?.uploads ?? []).filter((u) => u.owner === 'organization');

  const addImages = async (files: File[]) => {
    setUploading(true);
    try {
      for (const f of files) {
        const image = await shrinkImage(f);
        const res = await fetch(
          `${API_URL}/v1/admin/call-backgrounds/images?name=${encodeURIComponent(f.name)}`,
          {
            method: 'POST',
            headers: {
              'content-type': image.type,
              authorization: `Bearer ${await getAccessToken()}`,
            },
            body: image,
          },
        );
        const json = (await res.json().catch(() => null)) as
          (CallBackgroundState & { error?: { message?: string } }) | null;
        if (!res.ok || !json) throw new Error(json?.error?.message ?? 'Upload failed');
        setState(json);
      }
      toast({
        title: files.length > 1 ? 'Backgrounds added' : 'Background added',
        tone: 'success',
      });
    } catch (e) {
      toast({ title: 'Not added', description: (e as Error).message, tone: 'danger' });
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async (imageId: string) => {
    try {
      const s = await apiRequest<CallBackgroundState>(
        'DELETE',
        `/v1/admin/call-backgrounds/images/${imageId}`,
        { token: await getAccessToken() },
      );
      setState(s);
      setDraft((d) => (d ? { ...d, defaultChoice: s.policy.defaultChoice } : d));
    } catch (e) {
      toast({
        title: 'Not removed',
        description: e instanceof ApiFailure ? e.error.message : 'Try again',
        tone: 'danger',
      });
    }
  };

  if (error) return <StateView state="error" title="Calls" description={error} />;
  if (!state || !draft) return <StateView state="loading" title="Loading call settings" />;

  const dirty =
    draft.enforceLogo !== state.policy.enforceLogo ||
    !sameChoice(draft.defaultChoice, state.policy.defaultChoice);

  const save = async () => {
    setSaving(true);
    try {
      const s = await apiRequest<CallBackgroundState>('PUT', '/v1/admin/call-backgrounds', {
        token: await getAccessToken(),
        body: draft,
      });
      setState(s);
      toast({
        title: 'Call backgrounds saved',
        description: draft.enforceLogo
          ? 'Everyone shows the company background in calls.'
          : `People who haven’t picked a background start with: ${label(draft.defaultChoice, state.uploads)}.`,
        tone: 'success',
      });
    } catch (e) {
      toast({
        title: 'Not saved',
        description: e instanceof ApiFailure ? e.error.message : 'Try again',
        tone: 'danger',
      });
    } finally {
      setSaving(false);
    }
  };

  const tile = (c: CallBackgroundChoice, content: React.ReactNode, testId?: string) => {
    const on = sameChoice(draft.defaultChoice, c);
    return (
      <button
        key={testId ?? c.kind}
        type="button"
        aria-pressed={on}
        aria-label={`Default: ${label(c)}`}
        title={label(c)}
        data-testid={testId}
        disabled={!state.policy.canManage || draft.enforceLogo}
        onClick={() => setDraft({ ...draft, defaultChoice: c })}
        className={cn(
          'relative aspect-video overflow-hidden rounded-lg border bg-surface-raised text-text-muted transition disabled:opacity-50',
          on ? 'border-accent ring-2 ring-accent' : 'border-border hover:border-border-strong',
        )}
      >
        {content}
      </button>
    );
  };
  const iconTile = (icon: React.ReactNode, text: string) => (
    <span className="flex h-full flex-col items-center justify-center gap-1 text-meta">
      {icon}
      {text}
    </span>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]" data-testid="call-backgrounds-admin">
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="font-display text-h3 text-text">Call backgrounds</h2>
            <FeatureHelp id="call-background" />
          </div>
          <p className="mt-1 text-body text-text-muted">
            The background people start with in calls. Anyone can change theirs from the settings
            button in a call, unless you require the company background. Video is processed on each
            person’s device, never on a server.
          </p>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised p-4">
          <span>
            <span className="block text-label text-text">Require the company background</span>
            <span className="block text-meta text-text-subtle">
              Everyone in the organization shows your logo and colors behind them in calls. Guests
              from outside keep their own.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.enforceLogo}
            aria-label="Require the company background"
            disabled={!state.policy.canManage}
            onClick={() => setDraft({ ...draft, enforceLogo: !draft.enforceLogo })}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50',
              draft.enforceLogo
                ? 'border-accent bg-accent'
                : 'border-border-strong bg-surface-raised',
            )}
          >
            <span
              className={cn(
                'inline-block size-4 rounded-full bg-text shadow transition-transform',
                draft.enforceLogo ? 'translate-x-6 bg-accent-fg' : 'translate-x-1',
              )}
            />
          </button>
        </label>
        <div className="space-y-2" data-testid="company-library">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-label text-text">Company backgrounds</p>
              <p className="text-meta text-text-subtle">
                Your own designs or office photos. Everyone in the organization can pick them in
                calls. PNG, JPEG or WebP; large photos are resized to 1920x1080.
              </p>
            </div>
            {state.policy.canManage ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  <ImagePlus className="size-4" /> {uploading ? 'Uploading…' : 'Add backgrounds'}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  data-testid="company-background-file"
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = '';
                    void addImages(files);
                  }}
                />
              </>
            ) : null}
          </div>
          {companyUploads.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
              {companyUploads.map((u) => (
                <div key={u.imageId} className="relative" data-testid="company-upload">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={API_URL + u.url}
                    alt={u.name}
                    title={u.name}
                    className="aspect-video w-full rounded-lg border border-border object-cover"
                  />
                  {state.policy.canManage ? (
                    <button
                      type="button"
                      aria-label={`Remove ${u.name}`}
                      onClick={() => void removeImage(u.imageId)}
                      className="absolute right-1 top-1 rounded bg-black/70 p-1 text-white/80 hover:text-white"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-meta text-text-subtle">
              No company backgrounds yet.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-label text-text">Default background</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
            {tile({ kind: 'none' }, iconTile(<Ban className="size-4" />, 'None'))}
            {tile({ kind: 'blur' }, iconTile(<Sparkles className="size-4" />, 'Blur'))}
            {tile(
              { kind: 'logo' },
              logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="h-full w-full object-cover" />
              ) : (
                iconTile(<Building2 className="size-4" />, 'Company')
              ),
              'default-logo',
            )}
            {companyUploads.map((u) =>
              tile(
                { kind: 'upload', imageId: u.imageId },
                // eslint-disable-next-line @next/next/no-img-element
                <img src={API_URL + u.url} alt="" className="h-full w-full object-cover" />,
                `default-upload-${u.imageId}`,
              ),
            )}
            {CALL_BACKGROUND_PRESETS.map((p) =>
              tile(
                { kind: 'preset', presetId: p.id },
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={callBackgroundThumbPath(p.id)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />,
                `default-${p.id}`,
              ),
            )}
          </div>
        </div>
        {state.policy.canManage ? (
          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ) : (
          <p className="text-meta text-text-subtle">Only owners and admins can change these.</p>
        )}
      </section>
      <aside className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <h3 className="text-label text-text">Company background</h3>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt="Company background preview"
            className="aspect-video w-full rounded-lg border border-border object-cover"
            data-testid="company-background-preview"
          />
        ) : null}
        <p className="text-meta text-text-subtle">
          Made from your logo, colors and organization name in Branding. Change them there and every
          call picks it up.
        </p>
        {!state.brand.logo ? (
          <p className="text-meta text-warning">No logo yet: add one in Branding.</p>
        ) : null}
      </aside>
    </div>
  );
}
