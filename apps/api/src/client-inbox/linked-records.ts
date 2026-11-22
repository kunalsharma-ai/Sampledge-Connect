import type { TenantContext } from '../common/tenant-context.js';

export const LINKED_RECORD_RESOLVER = Symbol('LINKED_RECORD_RESOLVER');

/**
 * Hook for the Sampledge module integrations (SampForce opportunities, Samptrek projects).
 * resolve() returns the record's canonical label and URL, null when the module says it does
 * not exist, or undefined when no module integration is connected (the link is then kept
 * as "unverified"). onLinked() lets the module mirror the link into its own linked_records.
 */
export interface LinkedRecordResolver {
  resolve(
    ctx: TenantContext,
    module: 'sampforce' | 'samptrek',
    recordType: string,
    externalId: string,
  ): Promise<{ label: string; url: string | null } | null | undefined>;
  onLinked?(
    ctx: TenantContext,
    link: {
      conversationId: string;
      module: string;
      recordType: string;
      externalId: string;
      label: string;
    },
  ): Promise<void>;
}

/** Default until the module integrations land: nothing can be verified, links are stored as typed. */
export const unverifiedResolver: LinkedRecordResolver = {
  resolve: async () => undefined,
};
