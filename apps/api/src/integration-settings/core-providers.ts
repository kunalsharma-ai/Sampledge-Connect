import { Injectable, type OnModuleInit } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { LiveKitClient } from '../calls/livekit.js';
import { IntegrationSettingsService } from './integration-settings.service.js';

/**
 * Connection tests and legacy env fallbacks for the core providers declared in
 * contracts (smtp, livekit). Consumers read them with settings.get(tenantId, id).
 */
@Injectable()
export class CoreIntegrationHooks implements OnModuleInit {
  constructor(private readonly settings: IntegrationSettingsService) {}

  onModuleInit() {
    this.settings.attach('smtp', {
      envFallback: (cfg) =>
        cfg.SMTP_HOST && cfg.SMTP_FROM
          ? {
              host: cfg.SMTP_HOST,
              port: cfg.SMTP_PORT,
              security: cfg.SMTP_SECURE ? 'tls' : cfg.SMTP_REQUIRE_TLS ? 'starttls' : 'none',
              username: cfg.SMTP_USER ?? null,
              password: cfg.SMTP_PASSWORD ?? null,
              from: cfg.SMTP_FROM,
            }
          : null,
      test: async (v) => {
        const t = nodemailer.createTransport({
          host: String(v.host),
          port: Number(v.port ?? 587),
          secure: v.security === 'tls',
          requireTLS: v.security === 'starttls',
          ...(v.username
            ? { auth: { user: String(v.username), pass: String(v.password ?? '') } }
            : {}),
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
        });
        try {
          await t.verify();
          return { ok: true, message: `Connected to ${String(v.host)} and authenticated` };
        } finally {
          t.close();
        }
      },
    });

    this.settings.attach('livekit', {
      envFallback: (cfg) =>
        cfg.LIVEKIT_PUBLIC_URL && cfg.LIVEKIT_API_KEY && cfg.LIVEKIT_API_SECRET
          ? {
              publicUrl: cfg.LIVEKIT_PUBLIC_URL,
              apiUrl: cfg.LIVEKIT_API_URL ?? null,
              apiKey: cfg.LIVEKIT_API_KEY,
              apiSecret: cfg.LIVEKIT_API_SECRET,
            }
          : null,
      // An authenticated room-service call: bad keys get 401, a missing room is fine.
      test: async (v) => {
        const publicUrl = String(v.publicUrl);
        const apiUrl = v.apiUrl ? String(v.apiUrl) : publicUrl.replace(/^ws/, 'http');
        const client = new LiveKitClient({
          publicUrl,
          apiUrl,
          apiKey: String(v.apiKey),
          apiSecret: String(v.apiSecret ?? ''),
        });
        await client.listParticipants('connect-connection-test');
        return { ok: true, message: `LiveKit at ${apiUrl} accepted the API key` };
      },
    });
  }
}
