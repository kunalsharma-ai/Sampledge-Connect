'use client';
import * as React from 'react';
import {
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Room,
} from 'livekit-client';
import {
  CALL_BACKGROUND_PRESETS,
  callBackgroundImagePath,
  type CallBackgroundChoice,
  type CallBackgroundState,
  type CallBackgroundUpload,
} from '@sampledge/contracts';
import { ApiFailure, apiRequest } from './api';
import { useAuth } from './auth';
import { API_URL } from './config';
import { loadDevicePrefs, saveDevicePrefs } from './call-devices';
import { useEngine, useEngineChange } from './engine';

/**
 * Everything the background picker needs. Members get theirs from the server (saved to their
 * account, same on every device); guests keep theirs in this browser.
 */
export interface BackgroundController {
  effective: CallBackgroundChoice;
  choice: CallBackgroundChoice | null;
  /** The organization requires the company logo background. */
  locked: boolean;
  customImageUrl: string | null;
  /** Uploaded backgrounds: the organization's, then mine (urls are absolute). */
  uploads: CallBackgroundUpload[];
  brand: CallBackgroundState['brand'] | null;
  /** Options this person can pick (guests have no logo or personal upload). */
  allowLogo: boolean;
  allowUpload: boolean;
  choose(c: CallBackgroundChoice): Promise<void>;
  upload?(file: File): Promise<void>;
  removeImage?(imageId: string): Promise<void>;
  error: string | null;
}

const STATE_KEY = 'calls.background';
const PENDING_KEY = 'calls.background.pending';

export function useMemberCallBackground(): BackgroundController {
  const { getAccessToken } = useAuth();
  const { db } = useEngine();
  const [state, setState] = React.useState<CallBackgroundState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);

  const save = React.useCallback(
    (s: CallBackgroundState) => {
      setState(s);
      void db.meta.put({ key: STATE_KEY, value: s });
    },
    [db],
  );

  // Cached copy first (works offline), then the server.
  React.useEffect(() => {
    void db.meta.get(STATE_KEY).then((row) => {
      if (row) setState((s) => s ?? (row.value as CallBackgroundState));
    });
  }, [db]);

  // My choice changed on another device, an admin changed the rules, or branding changed.
  useEngineChange(['meetings', 'tenant'], (e) => {
    if (
      e.type === 'reconnected' ||
      (e.type === 'meetings' && e.area === 'call_background') ||
      (e.type === 'tenant' && (e.area === 'calls' || e.area === 'branding'))
    )
      setVersion((v) => v + 1);
  });

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        // A choice made offline goes up first, then we read back the truth.
        const pending = await db.meta.get(PENDING_KEY);
        if (pending) {
          await apiRequest('PUT', '/v1/me/call-background', { token, body: pending.value });
          await db.meta.delete(PENDING_KEY);
        }
        let s = await apiRequest<CallBackgroundState>('GET', '/v1/me/call-background', { token });
        // Blur used to be saved per device; carry it over to the account once.
        const legacy = loadDevicePrefs();
        if (legacy.blur) {
          saveDevicePrefs({ ...legacy, blur: undefined });
          if (!s.choice)
            s = await apiRequest<CallBackgroundState>('PUT', '/v1/me/call-background', {
              token,
              body: { kind: 'blur' },
            });
        }
        if (!cancelled) save(s);
      } catch {
        /* offline: keep the cached state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, getAccessToken, db, save]);

  const choose = React.useCallback(
    async (c: CallBackgroundChoice) => {
      setError(null);
      // Show it straight away; the server confirms (and other devices follow).
      setState((s) =>
        s ? { ...s, choice: c, effective: s.policy.enforceLogo ? { kind: 'logo' } : c } : s,
      );
      try {
        save(
          await apiRequest<CallBackgroundState>('PUT', '/v1/me/call-background', {
            token: await getAccessToken(),
            body: c,
          }),
        );
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 0) {
          // Offline: remember it and send it when we reconnect.
          await db.meta.put({ key: PENDING_KEY, value: c });
          setState((s) => {
            if (s) void db.meta.put({ key: STATE_KEY, value: s });
            return s;
          });
          return;
        }
        setError(e instanceof Error ? e.message : 'Could not save your background');
        setVersion((v) => v + 1);
      }
    },
    [getAccessToken, save, db],
  );

  const upload = React.useCallback(
    async (file: File) => {
      setError(null);
      try {
        const image = await shrinkImage(file);
        const res = await fetch(
          `${API_URL}/v1/me/call-backgrounds?name=${encodeURIComponent(file.name)}`,
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
        save(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      }
    },
    [getAccessToken, save],
  );

  const removeImage = React.useCallback(
    async (imageId: string) => {
      setError(null);
      try {
        save(
          await apiRequest<CallBackgroundState>('DELETE', `/v1/me/call-backgrounds/${imageId}`, {
            token: await getAccessToken(),
          }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not remove the image');
      }
    },
    [getAccessToken, save],
  );

  return {
    effective: state?.effective ?? { kind: 'none' },
    choice: state?.choice ?? null,
    locked: !!state?.policy.enforceLogo,
    customImageUrl: state?.customImageUrl ? API_URL + state.customImageUrl : null,
    uploads: (state?.uploads ?? []).map((u) => ({ ...u, url: API_URL + u.url })),
    brand: state?.brand ?? null,
    allowLogo: true,
    allowUpload: true,
    choose,
    upload,
    removeImage,
    error,
  };
}

const GUEST_KEY = 'sampledge.guestBackground';

/** Guests (no account): blur or a prebuilt image, remembered in this browser. */
export function useGuestCallBackground(): BackgroundController {
  const [choice, setChoice] = React.useState<CallBackgroundChoice | null>(null);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(GUEST_KEY);
      if (raw) setChoice(JSON.parse(raw) as CallBackgroundChoice);
      // Older versions saved only "blur" with the devices.
      else if (
        (JSON.parse(localStorage.getItem('sampledge.callDevices') ?? '{}') as { blur?: boolean })
          .blur
      )
        setChoice({ kind: 'blur' });
    } catch {
      /* private mode */
    }
  }, []);
  return {
    effective: choice ?? { kind: 'none' },
    choice,
    locked: false,
    customImageUrl: null,
    uploads: [],
    brand: null,
    allowLogo: false,
    allowUpload: false,
    error: null,
    async choose(c) {
      setChoice(c);
      try {
        localStorage.setItem(GUEST_KEY, JSON.stringify(c));
      } catch {
        /* lasts for this call only */
      }
    },
  };
}

// ---------- images ----------

/** Shrinks a photo to at most 1920x1080 JPEG so uploads stay small. */
export async function shrinkImage(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPEG or WebP image');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / bmp.width, 1080 / bmp.height);
  if (scale === 1 && file.size < 1_500_000) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not read that image'))),
      'image/jpeg',
      0.86,
    ),
  );
}

const logoCache = new Map<string, Promise<string>>();

/**
 * Draws the company background: brand colors, the logo in the top corner and as a large soft
 * mark, and the organization name. Made in the browser from the organization's Branding.
 */
export function logoBackground(brand: CallBackgroundState['brand']): Promise<string> {
  const key = `${brand.primary}|${brand.secondary}|${brand.name}|${brand.logo?.length ?? 0}:${brand.logo?.slice(-32) ?? ''}`;
  let p = logoCache.get(key);
  if (!p) {
    p = drawLogoBackground(brand);
    logoCache.set(key, p);
  }
  return p;
}

async function drawLogoBackground(brand: CallBackgroundState['brand']): Promise<string> {
  const W = 1280;
  const H = 720;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, shade(brand.primary, -0.55));
  bg.addColorStop(1, shade(brand.primary, -0.25));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // Soft brand glows and a thin accent band.
  const glow = (x: number, y: number, r: number, color: string, a: number) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, hexA(color, a));
    rg.addColorStop(1, hexA(color, 0));
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  };
  glow(W * 0.85, H * 0.15, 520, brand.primary, 0.45);
  glow(W * 0.1, H * 0.95, 480, brand.secondary, 0.25);
  g.fillStyle = hexA(brand.secondary, 0.85);
  g.fillRect(0, H - 10, W, 10);

  // Fine diagonal lines for texture.
  g.strokeStyle = 'rgba(255,255,255,0.035)';
  g.lineWidth = 2;
  for (let x = -H; x < W; x += 28) {
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + H, 0);
    g.stroke();
  }

  // Logo and name sit upper right but inside the middle of the frame, so they stay visible
  // when a call tile crops the picture to a square or portrait shape.
  const right = W * 0.77;
  const logo = brand.logo ? await loadImage(brand.logo).catch(() => null) : null;
  let y = 44;
  if (logo) {
    const size = fit(logo, 200, 84);
    roundRect(g, right - size.w - 32, y, size.w + 32, size.h + 28, 14, 'rgba(255,255,255,0.94)');
    g.drawImage(logo, right - size.w - 16, y + 14, size.w, size.h);
    y += size.h + 28 + 14;
  }
  if (brand.name) {
    g.font = '600 26px Inter, system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillText(brand.name, right, y);
  }
  return c.toDataURL('image/jpeg', 0.9);
}

function fit(img: HTMLImageElement, maxW: number, maxH: number) {
  const w = img.naturalWidth || 300;
  const h = img.naturalHeight || 150;
  const s = Math.min(maxW / w, maxH / h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('image failed'));
    i.src = src;
  });
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Darkens (negative) or lightens (positive) a #rrggbb color. */
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)
      .toString(16)
      .padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

// ---------- applying to the camera ----------

/** The image to put behind the person, or null for none/blur. */
export async function backgroundImageFor(
  c: CallBackgroundChoice,
  ctl: Pick<BackgroundController, 'customImageUrl' | 'uploads' | 'brand'>,
): Promise<string | null> {
  if (c.kind === 'preset') {
    const known = CALL_BACKGROUND_PRESETS.some((p) => p.id === c.presetId);
    return known ? window.location.origin + callBackgroundImagePath(c.presetId) : null;
  }
  if (c.kind === 'custom') return ctl.customImageUrl;
  if (c.kind === 'upload') return ctl.uploads.find((u) => u.imageId === c.imageId)?.url ?? null;
  if (c.kind === 'logo') return ctl.brand ? logoBackground(ctl.brand) : null;
  return null;
}

const ASSETS = () => ({
  tasksVisionFileSet: `${window.location.origin}/vision`,
  modelAssetPath: `${window.location.origin}/vision/selfie_segmenter.tflite`,
});

function cameraTrack(room: Room): LocalVideoTrack | null {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  return (pub?.track as LocalVideoTrack | undefined) ?? null;
}

/** Puts the chosen background on my camera (or takes it off). Runs on this device only. */
export async function applyBackground(room: Room, c: CallBackgroundChoice, image: string | null) {
  const track = cameraTrack(room);
  if (!track) return;
  const mode = c.kind === 'none' ? 'off' : c.kind === 'blur' ? 'blur' : image ? 'image' : 'off';
  const current = track.getProcessor() as
    | (ReturnType<typeof import('@livekit/track-processors').BackgroundProcessor> & object)
    | undefined;
  if (mode === 'off') {
    if (current) await track.stopProcessor();
    return;
  }
  const options =
    mode === 'blur'
      ? ({ mode: 'background-blur', blurRadius: 14 } as const)
      : ({ mode: 'virtual-background', imagePath: image! } as const);
  if (current && 'switchTo' in current) {
    await current.switchTo(options);
    return;
  }
  const { BackgroundProcessor } = await import('@livekit/track-processors');
  await track.setProcessor(BackgroundProcessor({ ...options, assetPaths: ASSETS() }));
}

/**
 * Keeps my background on the camera for the whole call: when the choice changes (here or on
 * another device) and whenever the camera is turned on again (a new track each time).
 */
export function useApplyBackground(
  room: Room | null,
  ctl: BackgroundController,
  onError: (message: string | null) => void,
) {
  const { effective, customImageUrl, uploads, brand } = ctl;
  const key = JSON.stringify([effective, customImageUrl, uploads, brand]);
  const latest = React.useRef({ effective, customImageUrl, uploads, brand });
  latest.current = { effective, customImageUrl, uploads, brand };
  const errRef = React.useRef(onError);
  errRef.current = onError;

  React.useEffect(() => {
    if (!room) return;
    let alive = true;
    const run = async () => {
      const { effective: c } = latest.current;
      try {
        const image = await backgroundImageFor(c, latest.current);
        if (!alive) return;
        await applyBackground(room, c, image);
        errRef.current(null);
      } catch {
        errRef.current(
          c.kind === 'blur'
            ? 'Background blur could not start on this device.'
            : 'This background could not start on this device.',
        );
      }
    };
    const onPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.Camera) void run();
    };
    room.on(RoomEvent.LocalTrackPublished, onPublished);
    void run();
    return () => {
      alive = false;
      room.off(RoomEvent.LocalTrackPublished, onPublished);
    };
    // key covers every input that changes the picture.
  }, [room, key]);
}
