/**
 * Invite, update and cancellation emails for external guests. Plain, table-based HTML that
 * renders in every mail client, plus a text version. All user text is escaped.
 */
export type GuestEmailKind = 'invite' | 'updated' | 'cancelled' | 'cancelled-for-you';

export interface GuestEmailInput {
  title: string;
  agenda: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  organizerName: string;
  organizationName: string;
  /** The organization's app name; null hides the product credit (white-label). */
  poweredBy: string | null;
  guestName: string;
  url: string;
  /** Recurring meetings: "Weekly on Tuesday" (the times are the next meeting's). */
  recurrence?: string | null;
  /** The email is about one meeting of a series, not the whole series. */
  occurrenceOnly?: boolean;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** "Monday 24 November 2026, 10:00 – 10:30 (Europe/London)" in the meeting's time zone. */
export function formatWhen(startsAt: Date, endsAt: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
  const sameDay = day.format(startsAt) === day.format(endsAt);
  const end = sameDay ? time.format(endsAt) : `${day.format(endsAt)}, ${time.format(endsAt)}`;
  return `${day.format(startsAt)}, ${time.format(startsAt)} – ${end} (${timeZone})`;
}

export function guestEmail(kind: GuestEmailKind, i: GuestEmailInput) {
  const when = formatWhen(i.startsAt, i.endsAt, i.timeZone);
  const cancelled = kind === 'cancelled' || kind === 'cancelled-for-you';
  const subject =
    kind === 'invite'
      ? `Invitation: ${i.title}${i.recurrence ? ` (${i.recurrence})` : ''}`
      : kind === 'updated'
        ? `Updated invitation: ${i.title}`
        : `Cancelled: ${i.title}`;
  const one = !!i.recurrence && !!i.occurrenceOnly;
  const what = i.recurrence
    ? one
      ? 'one meeting in this series'
      : 'this meeting series'
    : 'this meeting';
  const lead =
    kind === 'invite'
      ? `${i.organizerName} from ${i.organizationName} invited you to a ${i.recurrence ? 'recurring meeting' : 'meeting'}.`
      : kind === 'updated'
        ? `${i.organizerName} changed ${what}. Your calendar copy updates when you open the attached invite.`
        : kind === 'cancelled'
          ? `${i.organizerName} cancelled ${what}.${one ? ' The other meetings go ahead as planned.' : ''}`
          : `${i.organizerName} removed you from ${what}, so your join link no longer works.`;
  const repeats = i.recurrence ? `Repeats: ${i.recurrence}` : null;
  const whenLabel = i.recurrence && !one && !cancelled ? `Next: ${when}` : when;
  const how =
    'No account or app needed: open the link in Chrome, Edge, Firefox or Safari. You will wait in the lobby until someone in the meeting lets you in.';

  const text = [
    `Hi ${i.guestName},`,
    '',
    lead,
    '',
    i.title,
    whenLabel,
    ...(repeats ? [repeats] : []),
    ...(i.agenda && !cancelled ? ['', i.agenda] : []),
    ...(cancelled ? [] : ['', `Join the meeting: ${i.url}`, '', how]),
    '',
    i.poweredBy
      ? `Sent by ${i.organizationName} with ${i.poweredBy}.`
      : `Sent by ${i.organizationName}.`,
  ].join('\n');

  const button = cancelled
    ? ''
    : `<tr><td style="padding:8px 0 4px"><a href="${esc(i.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">Join meeting</a></td></tr>
       <tr><td style="padding:8px 0 0;color:#6b7280;font-size:13px;line-height:19px">${esc(how)}</td></tr>
       <tr><td style="padding:12px 0 0;color:#6b7280;font-size:12px;word-break:break-all">Or paste this link into your browser: ${esc(i.url)}</td></tr>`;
  const agenda =
    i.agenda && !cancelled
      ? `<tr><td style="padding:12px 0 0;color:#374151;font-size:14px;line-height:21px;white-space:pre-wrap">${esc(i.agenda)}</td></tr>`
      : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="color:#111827;font-size:15px;line-height:22px">Hi ${esc(i.guestName)},</td></tr>
<tr><td style="padding:8px 0 16px;color:#374151;font-size:15px;line-height:22px">${esc(lead)}</td></tr>
<tr><td style="color:#111827;font-size:20px;font-weight:700;line-height:26px${cancelled ? ';text-decoration:line-through' : ''}">${esc(i.title)}</td></tr>
<tr><td style="padding:6px 0 0;color:#374151;font-size:14px;line-height:21px">${esc(whenLabel)}</td></tr>
${repeats ? `<tr><td style="padding:2px 0 0;color:#374151;font-size:14px;line-height:21px">${esc(repeats)}</td></tr>` : ''}
${agenda}
${button}
<tr><td style="padding:24px 0 0;color:#9ca3af;font-size:12px">Sent by ${esc(i.organizationName)}${i.poweredBy ? ` with ${esc(i.poweredBy)}` : ''}.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
