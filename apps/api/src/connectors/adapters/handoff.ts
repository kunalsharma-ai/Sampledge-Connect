import { CONNECTOR_CATALOG, type ConnectorProvider } from '@sampledge/contracts';
import type { ConnectorAdapter } from './types.js';

/**
 * Handoff channels (Signal, iMessage) have no supported business API. Nothing is automated:
 * replies become a deep link that opens the chat in the client's own app, and agents log
 * inbound messages by hand. The inbox still keeps the full record, SLA and assignment.
 */
function handoff(provider: Extract<ConnectorProvider, 'signal' | 'imessage'>): ConnectorAdapter {
  return {
    provider,
    descriptor: CONNECTOR_CATALOG[provider],
    testCredentials: (): Record<string, string> =>
      provider === 'signal' ? { businessNumber: '+15550100' } : { senderId: '+15550100' },
    async send(text, ctx) {
      const handle = (ctx.clientHandle ?? ctx.externalThreadId).trim();
      const phone = handle.replace(/[^\d+]/g, '');
      if (provider === 'signal')
        return { kind: 'handoff', url: `https://signal.me/#p/${encodeURIComponent(phone)}` };
      // sms: opens Messages (iMessage when available) with the reply prefilled.
      const target = handle.includes('@') ? handle : phone;
      return {
        kind: 'handoff',
        url: `sms:${encodeURIComponent(target)}&body=${encodeURIComponent(text)}`,
      };
    },
    async testConnection() {
      return 'Handoff channel: nothing to connect. Replies open in the client’s app.';
    },
    sandboxResponse: () => ({}),
  };
}

export const signalAdapter = handoff('signal');
export const imessageAdapter = handoff('imessage');
