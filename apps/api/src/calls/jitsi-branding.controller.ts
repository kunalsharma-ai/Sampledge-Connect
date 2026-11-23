import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { CALL_BACKGROUND_PRESETS, DEFAULT_APP_NAME } from '@sampledge/contracts';
import { BrandingService } from '../branding/branding.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { TenantDb } from '../database/tenant-db.js';

/** Mixes a #RRGGBB colour with black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) =>
    Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

/**
 * Jitsi Meet's "dynamic branding" source (BRANDING_DATA_URL in docker-compose). The Jitsi page
 * calls it from the browser with `?conferenceFqn=<tenantId>/<room>` and restyles itself with
 * the organization's logo, colours and SampConnect's backgrounds. Public on purpose: it only
 * holds what the sign-in page already shows (name, logo, colours), so it carries CORS `*`.
 */
@Controller('v1/calls/jitsi')
export class JitsiBrandingController {
  constructor(
    private readonly db: TenantDb,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get('branding')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=60')
  async branding(@Query('conferenceFqn') fqn?: string) {
    const tenantId = (fqn ?? '').split('/')[0] ?? '';
    const t = /^[0-9a-f]{24}$/.test(tenantId)
      ? await this.db.tenants.findOne(
          { _id: tenantId, status: 'active' },
          { projection: { branding: 1, name: 1 } },
        )
      : null;
    const b = BrandingService.resolve(t);
    const web = this.cfg.PUBLIC_WEB_URL?.replace(/\/+$/, '');
    const dark = '#080F1F';
    return {
      // Empty means Jitsi keeps the SampConnect logo baked into the server (deploy/jitsi).
      logoImageUrl: b.logo ?? '',
      logoClickUrl: '',
      backgroundColor: dark,
      premeetingBackground: `linear-gradient(135deg, ${shade(b.primary, -0.55)} 0%, ${dark} 70%)`,
      inviteDomain: '',
      labels: { appName: b.appName ?? DEFAULT_APP_NAME, organization: t?.name ?? '' },
      customTheme: {
        palette: {
          action01: b.primary,
          action01Hover: shade(b.primary, 0.12),
          action01Active: shade(b.primary, -0.15),
          link01: shade(b.primary, 0.35),
          link01Hover: shade(b.primary, 0.5),
          uiBackground: dark,
          ui01: '#0F1A30',
          ui02: '#16233D',
          ui03: '#1E2E4D',
          ui04: '#2A3D62',
          ui05: '#3A4F78',
          focus01: b.secondary,
        },
      },
      // The same 24 photo backgrounds as SampConnect's own call screen (served by the web app
      // with CORS, so Jitsi can draw them).
      virtualBackgrounds: web
        ? CALL_BACKGROUND_PRESETS.map((p) => `${web}/backgrounds/${p.id}.jpg`)
        : [],
    };
  }
}
