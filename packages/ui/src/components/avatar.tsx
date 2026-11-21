import * as React from 'react';
import type { PresenceStatus } from '@sampledge/contracts';
import { cn } from '../cn.js';

const sizes = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-meta',
  md: 'size-10 text-label',
  lg: 'size-14 text-h3',
} as const;

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts.at(-1)![0] ?? '') : '')).toUpperCase();
}

const presenceColor: Record<PresenceStatus, string> = {
  online: 'bg-success',
  away: 'bg-warning',
  dnd: 'bg-danger',
  offline: 'bg-text-subtle',
};

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  presence?: PresenceStatus;
  className?: string;
}

export function Avatar({ name, src, size = 'md', presence, className }: AvatarProps) {
  const hue = hashHue(name);
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'inline-flex items-center justify-center overflow-hidden rounded-full font-semibold text-white',
          sizes[size],
        )}
        style={
          src
            ? undefined
            : {
                backgroundImage: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 40) % 360} 58% 42%))`,
              }
        }
      >
        {src ? (
          <img src={src} alt="" className="size-full object-cover" />
        ) : (
          <span aria-hidden>{initials(name)}</span>
        )}
        <span className="sr-only">{name}</span>
      </span>
      {presence ? (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface',
            presenceColor[presence],
          )}
          role="img"
          aria-label={presence}
        />
      ) : null}
    </span>
  );
}
