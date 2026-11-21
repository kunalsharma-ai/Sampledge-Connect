'use client';
import { Check } from 'lucide-react';
import { THEMES, getTheme, type ThemeId } from '@sampledge/design-tokens';
import { useTheme } from '../theme.js';
import { cn } from '../cn.js';

const ORDER: ThemeId[] = [
  'midnight-executive',
  'arctic-professional',
  'royal-graphite',
  'emerald-enterprise',
  'custom-brand',
];

/** Visual theme chooser: each swatch previews that theme's real tokens. */
export function ThemePicker({ className }: { className?: string }) {
  const { themeId, setTheme, brand } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5', className)}
    >
      {ORDER.map((id) => {
        const t = id === 'custom-brand' ? getTheme(id, brand ?? undefined) : THEMES[id];
        const c = t.colors;
        const selected = id === themeId;
        return (
          <button
            key={id}
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(id)}
            className={cn(
              'group relative overflow-hidden rounded-lg border text-left transition-[transform,box-shadow,border-color] duration-[var(--sc-duration-base)] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'border-accent shadow-md' : 'border-border',
            )}
          >
            <div
              className="h-20 p-2.5"
              style={{
                background: `linear-gradient(135deg, ${c.bgGradientFrom}, ${c.bg} 60%, ${c.bgGradientTo})`,
              }}
            >
              <div className="flex h-full gap-1.5">
                <div className="w-4 rounded-sm" style={{ background: c.surface }} />
                <div
                  className="flex flex-1 flex-col justify-end gap-1 rounded-sm p-1.5"
                  style={{ background: c.surface }}
                >
                  <div className="h-1.5 w-3/4 rounded-full" style={{ background: c.bubbleOther }} />
                  <div
                    className="ml-auto h-1.5 w-1/2 rounded-full"
                    style={{ background: c.accent }}
                  />
                  <div className="h-1.5 w-1/3 rounded-full" style={{ background: c.accent2 }} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 bg-surface px-3 py-2">
              <span className="truncate text-label text-text">
                {t.id === 'custom-brand' ? 'Custom Brand' : t.name}
              </span>
              {selected ? <Check className="size-4 text-accent" aria-hidden /> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
