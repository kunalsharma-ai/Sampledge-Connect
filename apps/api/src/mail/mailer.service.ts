import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';

export interface OutgoingMail {
  to: { name: string; email: string };
  subject: string;
  text: string;
  html: string;
  /** A calendar invite: sent as a text/calendar alternative part plus an invite.ics attachment. */
  calendar?: { method: 'REQUEST' | 'CANCEL'; content: string };
}

interface SmtpSettings {
  host: string;
  port: number;
  security: 'tls' | 'starttls' | 'none';
  username: string | null;
  password: string | null;
  from: string;
}

/**
 * Outgoing email through the organization's own SMTP server. Settings come from the database
 * (Integrations → Email: the organization's own, else the platform default, else legacy env),
 * and a saved change takes effect on every API node without a restart. Nothing is sent (and
 * nothing fails) when SMTP isn't configured: callers check `enabled` and say so in the UI.
 */
@Injectable()
export class MailerService implements OnApplicationShutdown {
  private readonly log = new Logger(MailerService.name);
  /** Pooled transports by settings fingerprint, so tenants sharing a server share a pool. */
  private readonly transports = new Map<string, Transporter>();
  private readonly stopListening: () => void;

  constructor(private readonly settings: IntegrationSettingsService) {
    // Hot reload: new settings get a new transport; close the old pools.
    this.stopListening = settings.onChange('smtp', () => this.closeAll());
  }

  private async smtp(tenantId: string | null): Promise<SmtpSettings | null> {
    const r = await this.settings.get(tenantId, 'smtp');
    const v = r?.enabled ? r.values : null;
    if (!v?.host || !v.from) return null;
    const security = v.security === 'tls' || v.security === 'none' ? v.security : 'starttls';
    return {
      host: String(v.host),
      port: Number(v.port ?? 587),
      security,
      username: v.username ? String(v.username) : null,
      password: v.password ? String(v.password) : null,
      from: String(v.from),
    };
  }

  async enabled(tenantId: string | null): Promise<boolean> {
    return !!(await this.smtp(tenantId));
  }

  /** The From address, for ORGANIZER lines in calendar invites. */
  async fromAddress(tenantId: string | null): Promise<{ name: string; email: string } | null> {
    const from = (await this.smtp(tenantId))?.from;
    if (!from) return null;
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
    return m ? { name: m[1]!.trim(), email: m[2]!.trim() } : { name: '', email: from.trim() };
  }

  private transporter(s: SmtpSettings): Transporter {
    const key = createHash('sha256').update(JSON.stringify(s)).digest('hex');
    let t = this.transports.get(key);
    if (!t) {
      t = nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.security === 'tls',
        requireTLS: s.security === 'starttls',
        ...(s.username ? { auth: { user: s.username, pass: s.password ?? '' } } : {}),
        pool: true,
        maxConnections: 3,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      });
      this.transports.set(key, t);
    }
    return t;
  }

  /** Sends one message. Throws with a short, log-safe reason when the server refuses it. */
  async send(tenantId: string | null, mail: OutgoingMail): Promise<void> {
    const s = await this.smtp(tenantId);
    if (!s) throw new Error('Email is not configured on this server');
    try {
      await this.transporter(s).sendMail({
        from: s.from,
        to: { name: mail.to.name, address: mail.to.email },
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(mail.calendar
          ? {
              icalEvent: {
                method: mail.calendar.method,
                filename: mail.calendar.method === 'CANCEL' ? 'cancel.ics' : 'invite.ics',
                content: mail.calendar.content,
              },
            }
          : {}),
      });
    } catch (e) {
      const reason = shortReason(e);
      this.log.warn(`email to a guest was not sent: ${reason}`);
      throw new Error(reason);
    }
  }

  private closeAll() {
    for (const t of this.transports.values()) t.close();
    this.transports.clear();
  }

  onApplicationShutdown() {
    this.stopListening();
    this.closeAll();
  }
}

/** Keeps server responses but never credentials or full stack traces. */
function shortReason(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
  if (err.code === 'EAUTH') return 'The mail server rejected the SMTP username or password';
  if (err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKET')
    return "Couldn't reach the mail server";
  if (err.responseCode) return `Mail server said: ${String(err.response ?? '').slice(0, 160)}`;
  return String(err.message ?? 'Sending failed').slice(0, 160);
}
