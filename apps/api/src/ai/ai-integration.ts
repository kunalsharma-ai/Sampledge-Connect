import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { AI_MODEL_INTEGRATION_ID, type IntegrationProviderDef } from '@sampledge/contracts';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { ModelEngine } from './model.js';
import {
  AI_SETTINGS_SOURCE,
  settingsFromValues,
  type AiSettingsSource,
  type SwappableSettingsSource,
} from './settings.js';

/** Administration > Integrations > AI: the organization's own model server. */
export const AI_MODEL_PROVIDER: IntegrationProviderDef = {
  id: AI_MODEL_INTEGRATION_ID,
  label: 'AI model server',
  description:
    'Your own OpenAI-compatible model server (Ollama, vLLM, LocalAI, llama.cpp). Without one, the assistant runs in built-in mode: no written answers or translation.',
  category: 'ai',
  scopes: ['tenant', 'platform'],
  testable: true,
  fields: [
    {
      key: 'baseUrl',
      label: 'Server URL',
      type: 'url',
      required: true,
      placeholder: 'http://ollama:11434',
      help: 'OpenAI-compatible endpoint. /v1 is added when missing.',
    },
    {
      key: 'apiKey',
      label: 'API key',
      type: 'secret',
      help: 'Only if your server requires one. Stored encrypted.',
    },
    {
      key: 'chatModel',
      label: 'Chat model',
      type: 'string',
      required: true,
      placeholder: 'llama3.1:8b',
    },
    {
      key: 'embeddingModel',
      label: 'Embedding model',
      type: 'string',
      placeholder: 'nomic-embed-text',
      help: 'Used for search by meaning. Leave empty to keep the built-in search index.',
    },
    {
      key: 'timeoutMs',
      label: 'Timeout (ms)',
      type: 'number',
      default: 30000,
      min: 1000,
      max: 120000,
    },
  ],
};

/** Reads model server settings from the integration-settings store (database, not env). */
class IntegrationStoreSource implements AiSettingsSource {
  constructor(private readonly store: IntegrationSettingsService) {}
  async get(tenantId: string) {
    const r = await this.store.get(tenantId, AI_MODEL_INTEGRATION_ID);
    if (!r?.enabled) return null;
    return settingsFromValues(r.values);
  }
  onChange(fn: (tenantId: string | null) => void) {
    this.store.onChange(AI_MODEL_INTEGRATION_ID, fn);
  }
}

@Injectable()
export class AiIntegration implements OnModuleInit {
  constructor(
    private readonly store: IntegrationSettingsService,
    @Inject(AI_SETTINGS_SOURCE) private readonly source: SwappableSettingsSource,
  ) {}

  onModuleInit() {
    this.store.register(AI_MODEL_PROVIDER, {
      test: async (values) => {
        const s = settingsFromValues(values);
        if (!s) return { ok: false, message: 'Server URL and chat model are required' };
        return new ModelEngine(s).test();
      },
    });
    this.source.use(new IntegrationStoreSource(this.store));
  }
}
