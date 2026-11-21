/**
 * Non-color tokens. Exposed as CSS variables (see build-css) and as
 * Tailwind theme values (see tailwind.css).
 */

export const fonts = {
  sans: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  display:
    '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/**
 * Type scale: [font-size, line-height, letter-spacing, weight].
 * Line heights are tighter for display sizes and roomier for reading text.
 */
export const typeScale = {
  'display-lg': ['3rem', '1.08', '-0.03em', '700'],
  display: ['2.25rem', '1.12', '-0.025em', '700'],
  h1: ['1.75rem', '1.2', '-0.02em', '650'],
  h2: ['1.375rem', '1.27', '-0.015em', '650'],
  h3: ['1.125rem', '1.35', '-0.01em', '600'],
  body: ['0.9375rem', '1.55', '-0.003em', '400'],
  message: ['0.9375rem', '1.5', '-0.003em', '400'],
  label: ['0.8125rem', '1.35', '0', '550'],
  meta: ['0.75rem', '1.35', '0.005em', '450'],
  overline: ['0.6875rem', '1.3', '0.08em', '600'],
} as const;

export const radii = {
  xs: '6px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '28px',
  full: '9999px',
} as const;

/**
 * Motion. Common micro-interactions sit in the 150 to 250 ms band.
 * All durations collapse to ~0 under prefers-reduced-motion (see build-css).
 */
export const motion = {
  duration: {
    instant: 90,
    fast: 150,
    base: 200,
    slow: 250,
    page: 320,
  },
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    emphasized: [0.3, 0, 0, 1] as const,
    exit: [0.4, 0, 1, 1] as const,
  },
  spring: {
    /** Panels, drawers. */
    gentle: { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 } as const,
    /** Counters, small pops. */
    snappy: { type: 'spring', stiffness: 600, damping: 32 } as const,
  },
} as const;

export const zIndex = {
  base: 0,
  sticky: 10,
  sidebar: 20,
  drawer: 40,
  overlay: 50,
  modal: 60,
  palette: 70,
  toast: 80,
  tooltip: 90,
} as const;

export const layout = {
  sidebarCollapsed: '72px',
  sidebarExpanded: '264px',
  listPanel: '320px',
  contextPanel: '340px',
  headerHeight: '60px',
} as const;
