import { z } from 'zod';

/** The product name when an organization hasn't set its own. */
export const DEFAULT_APP_NAME = 'SampConnect';

const Hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'a color like #2563EB');

/** Logos are stored with the organization as a data URL so they work offline and in emails. */
export const LOGO_MAX_BYTES = 256 * 1024;
const Logo = z
  .string()
  .max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 64, 'The logo must be 256 KB or smaller')
  .regex(
    /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/,
    'Use a PNG, JPEG, WebP or SVG image',
  );

/**
 * White-label settings for one organization (PUT /v1/branding, owner only). Everything is
 * stored in the database with the organization; nothing comes from env.
 */
export const BrandingInputSchema = z.object({
  /** Replaces "SampConnect" in the app, the browser tab, emails and authenticator apps. */
  appName: z.string().trim().min(2).max(40).nullable().default(null),
  logo: Logo.nullable().default(null),
  primary: Hex.default('#2563EB'),
  secondary: Hex.default('#F59E0B'),
  mode: z.enum(['dark', 'light']).default('dark'),
  /** Members start on the organization theme (they can still pick another). */
  useBrandTheme: z.boolean().default(false),
  /** Members always see the organization theme. */
  enforceTheme: z.boolean().default(false),
  /** Shown on the sign-in page once the workspace is typed. */
  loginMessage: z.string().trim().max(280).nullable().default(null),
  supportEmail: z.string().trim().toLowerCase().email().max(254).nullable().default(null),
  supportUrl: z.string().trim().url().max(500).nullable().default(null),
  /** Drops "with SampConnect" from emails and the sign-in page. */
  hidePoweredBy: z.boolean().default(false),
});
export type BrandingInput = z.input<typeof BrandingInputSchema>;
export type Branding = z.infer<typeof BrandingInputSchema>;

/** GET /v1/branding */
export interface BrandingView extends Branding {
  organizationName: string;
  /** The name to show: appName, or the product name. */
  displayName: string;
  updatedAt: string | null;
  canManage: boolean;
}

/** GET /v1/branding/public/:slug, for the sign-in page. Only what's safe to show anyone. */
export interface PublicBranding {
  organizationName: string;
  displayName: string;
  logo: string | null;
  primary: string;
  secondary: string;
  mode: 'dark' | 'light';
  loginMessage: string | null;
  hidePoweredBy: boolean;
}
