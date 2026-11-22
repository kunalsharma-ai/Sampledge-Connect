import type { IntegrationValues } from '@sampledge/contracts';

/**
 * Text messages through the provider set up in Integrations → Text messages (SMS):
 * Twilio, Vonage, or your own HTTPS gateway. Credentials come from the database, never env.
 */
const TIMEOUT_MS = 15_000;

export class SmsError extends Error {}

function need(v: IntegrationValues, key: string, label: string): string {
  const x = v[key];
  if (x === null || x === undefined || String(x).trim() === '')
    throw new SmsError(`${label} is required for this provider`);
  return String(x).trim();
}

async function call(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res;
}

async function failure(res: Response, who: string): Promise<SmsError> {
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string; error_text?: string; error?: string };
    detail = body.message ?? body.error_text ?? body.error ?? '';
  } catch {
    /* not JSON */
  }
  return new SmsError(`${who} answered HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
}

/** Sends one text. Throws SmsError with a readable reason when the provider refuses. */
export async function sendSms(v: IntegrationValues, to: string, text: string): Promise<void> {
  const provider = String(v.provider ?? 'twilio');
  if (provider === 'twilio') {
    const sid = need(v, 'accountId', 'Account SID');
    const token = need(v, 'secret', 'Auth token');
    const from = need(v, 'from', 'Sender');
    const form = new URLSearchParams({ To: to, Body: text });
    form.set(from.startsWith('MG') ? 'MessagingServiceSid' : 'From', from);
    const res = await call(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
      },
    );
    if (!res.ok) throw await failure(res, 'Twilio');
    return;
  }
  if (provider === 'vonage') {
    const res = await call('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: need(v, 'accountId', 'API key'),
        api_secret: need(v, 'secret', 'API secret'),
        from: need(v, 'from', 'Sender'),
        to: to.replace(/^\+/, ''),
        text,
      }),
    });
    if (!res.ok) throw await failure(res, 'Vonage');
    const body = (await res.json()) as { messages?: { status: string; 'error-text'?: string }[] };
    const m = body.messages?.[0];
    if (!m || m.status !== '0')
      throw new SmsError(`Vonage refused it: ${m?.['error-text'] ?? 'unknown error'}`);
    return;
  }
  if (provider === 'webhook') {
    const res = await call(need(v, 'webhookUrl', 'Gateway URL'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${need(v, 'secret', 'Gateway token')}`,
      },
      body: JSON.stringify({ to, from: v.from ? String(v.from) : null, text }),
    });
    if (!res.ok) throw await failure(res, 'Your gateway');
    return;
  }
  throw new SmsError(`Unknown SMS provider "${provider}"`);
}

/** Test connection: checks the credentials without sending a text. */
export async function testSms(v: IntegrationValues): Promise<{ ok: true; message: string }> {
  const provider = String(v.provider ?? 'twilio');
  if (provider === 'twilio') {
    const sid = need(v, 'accountId', 'Account SID');
    const token = need(v, 'secret', 'Auth token');
    need(v, 'from', 'Sender');
    const res = await call(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
      { headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` } },
    );
    if (!res.ok) throw await failure(res, 'Twilio');
    const a = (await res.json()) as { friendly_name?: string; status?: string };
    if (a.status && a.status !== 'active') throw new SmsError(`The Twilio account is ${a.status}`);
    return { ok: true, message: `Twilio accepted the credentials (${a.friendly_name ?? sid})` };
  }
  if (provider === 'vonage') {
    const q = new URLSearchParams({
      api_key: need(v, 'accountId', 'API key'),
      api_secret: need(v, 'secret', 'API secret'),
    });
    need(v, 'from', 'Sender');
    const res = await call(`https://rest.nexmo.com/account/get-balance?${q}`, {});
    if (!res.ok) throw await failure(res, 'Vonage');
    const b = (await res.json()) as { value?: number };
    return {
      ok: true,
      message: `Vonage accepted the credentials${typeof b.value === 'number' ? ` (balance ${b.value.toFixed(2)})` : ''}`,
    };
  }
  if (provider === 'webhook') {
    const url = need(v, 'webhookUrl', 'Gateway URL');
    if (!url.startsWith('https://') && !url.startsWith('http://localhost'))
      throw new SmsError('The gateway URL must use https://');
    const res = await call(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${need(v, 'secret', 'Gateway token')}`,
      },
      body: JSON.stringify({ test: true }),
    });
    if (!res.ok) throw await failure(res, 'Your gateway');
    return { ok: true, message: `Your gateway answered HTTP ${res.status}` };
  }
  throw new SmsError(`Unknown SMS provider "${provider}"`);
}
