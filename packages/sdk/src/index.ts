export { ConnectClient, ConnectError, type ConnectClientOptions } from './client.js';
export { signPayload, verifySignature, type SignatureCheck } from './signature.js';
export {
  MODULE_CATALOG,
  SAMPLEDGE_MODULES,
  SIGNATURE_HEADER,
  type ModuleEventInput,
  type ModuleEventResult,
  type SampledgeModule,
  type WebhookEnvelope,
  type WidgetSession,
} from '@sampledge/contracts';
