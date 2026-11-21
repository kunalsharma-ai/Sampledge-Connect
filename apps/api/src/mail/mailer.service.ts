import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

export interface OutgoingMail {
  to: { name: string; email: string };
  subject: string;
  text: string;
  html: string;
  /** A calendar invite: sent as a text/calendar alternative part plus an invite.ics attachment. */
  calendar?: { method: 'REQUEST' | 'CANCEL'; content: string };
}

/**
 * Outgoing email through the organization's own SMTP server. Nothing is sent (and nothing
 * fails) when SMTP isn't configured: callers check `enabled` and say so in the UI.
 */
@Injectable()
export class MailerService implements OnApplicationShutdown {
  private readonly log = new Logger(MailerService.name);
  private transport: Transporter | null = null;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  get enabled(): boolean {
    return !!(this.cfg.SMTP_HOST && this.cfg.SMTP_FROM);
  }

  /** The From address, for ORGANIZER lines in calendar invites. */
  get fromAddress(): { name: string; email: string } | null {
    const from = this.cfg.SMTP_FROM;
    if (!from) return null;
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
    return m ? { name: m[1]!.trim(), email: m[2]!.trim() } : { name: '', email: from.trim() };
  }

  private get transporter(): Transporter {
    this.transport ??= nodemailer.createTransport({
      host: this.cfg.SMTP_HOST,
      port: this.cfg.SMTP_PORT,
      secure: this.cfg.SMTP_SECURE,
      requireTLS: this.cfg.SMTP_REQUIRE_TLS,
      ...(this.cfg.SMTP_USER
        ? { auth: { user: this.cfg.SMTP_USER, pass: this.cfg.SMTP_PASSWORD } }
        : {}),
      pool: true,
      maxConnections: 3,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return this.transport;
  }

  /** Sends one message. Throws with a short, log-safe reason when the server refuses it. */
  async send(mail: OutgoingMail): Promise<void> {
    if (!this.enabled) throw new Error('Email is not configured on this server');
    try {
      await this.transporter.sendMail({
        from: this.cfg.SMTP_FROM,
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

  onApplicationShutdown() {
    this.transport?.close();
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
