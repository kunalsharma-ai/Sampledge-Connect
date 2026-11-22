'use client';
import * as React from 'react';
import type {
  AiTranscript,
  CallMinutesResponse,
  ChatExportAccess,
  ChatExportRequest,
  DocumentFormat,
  MeetingMinutes,
  MinutesConfig,
  MinutesSettings,
  MinutesTemplate,
  UpdateMinutesRequest,
  UpdateTranscriptRequest,
} from '@sampledge/contracts';
import { ApiFailure, apiRequest } from './api';
import { API_URL } from './config';
import { useAuth } from './auth';
import { useEngine, useTenantChange } from './engine';

/** The browser's time zone, so downloaded documents show local times. */
export const localTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** Saves a response body as a file, named by the server's Content-Disposition. */
async function saveResponse(res: Response, fallback: string) {
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiFailure(res.status, {
      code: (json?.error?.code as never) ?? 'INTERNAL',
      message: json?.error?.message ?? `Download failed (HTTP ${res.status})`,
    });
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]!) : fallback;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}

/**
 * Minutes of meeting and chat export. Reads and downloads need a connection; edits to minutes
 * go through the engine's action queue when offline (`minutes|<id>`), so they reach the
 * server and the person's other devices once back online.
 */
export function useMinutesApi() {
  const { getAccessToken } = useAuth();
  const { engine, state } = useEngine();
  const online = state.connectivity === 'online';
  return React.useMemo(() => {
    const req = async <T>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body });
    const fetchFile = async (method: string, path: string, body?: unknown) => {
      let res: Response;
      try {
        res = await fetch(API_URL + path, {
          method,
          headers: {
            authorization: `Bearer ${await getAccessToken()}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new ApiFailure(0, {
          code: 'UNAVAILABLE',
          message: 'Downloads need a connection. Try again when you’re back online.',
        });
      }
      return res;
    };
    return {
      online,
      config: () => req<MinutesConfig>('GET', '/v1/minutes/config'),
      forCall: (callId: string) => req<CallMinutesResponse>('GET', `/v1/calls/${callId}/minutes`),
      generate: (callId: string, body: { language?: string; regenerate?: boolean }) =>
        req<MeetingMinutes>('POST', `/v1/calls/${callId}/minutes`, body),
      get: (id: string) => req<MeetingMinutes>('GET', `/v1/minutes/${id}`),
      list: (conversationId?: string) =>
        req<{ items: MeetingMinutes[] }>(
          'GET',
          `/v1/minutes${conversationId ? `?conversationId=${conversationId}` : ''}`,
        ),
      /** Saves now when online; offline it is queued and replayed in order. */
      update: async (
        m: Pick<MeetingMinutes, 'minutesId' | 'conversationId' | 'title'>,
        body: UpdateMinutesRequest,
      ): Promise<MeetingMinutes | 'queued'> => {
        if (!online) {
          await engine.queueAction({
            key: `minutes|${m.minutesId}`,
            method: 'PATCH',
            path: `/v1/minutes/${m.minutesId}`,
            body,
            label: `Edit minutes: ${m.title}`,
            conversationId: m.conversationId,
          });
          return 'queued';
        }
        return req<MeetingMinutes>('PATCH', `/v1/minutes/${m.minutesId}`, body);
      },
      share: (id: string) => req<MeetingMinutes>('POST', `/v1/minutes/${id}/share`),
      remove: (id: string) => req<{ deleted: true }>('DELETE', `/v1/minutes/${id}`),
      download: async (
        m: Pick<MeetingMinutes, 'minutesId' | 'title'>,
        format: DocumentFormat,
        template: MinutesTemplate,
        transcript: boolean,
      ) => {
        const q = new URLSearchParams({
          format,
          template,
          tz: localTimeZone(),
          ...(transcript ? { transcript: '1' } : {}),
        });
        const res = await fetchFile('GET', `/v1/minutes/${m.minutesId}/document?${q}`);
        return saveResponse(res, `Minutes - ${m.title}.${format}`);
      },
      exportAccess: (conversationId: string) =>
        req<ChatExportAccess>('GET', `/v1/conversations/${conversationId}/export`),
      exportChat: async (conversationId: string, body: ChatExportRequest, name: string) => {
        const res = await fetchFile('POST', `/v1/conversations/${conversationId}/export`, {
          ...body,
          tz: localTimeZone(),
        });
        return saveResponse(res, `Chat - ${name}.${body.format ?? 'pdf'}`);
      },
      /** Corrects lines of a transcript or one of its translations; queued when offline. */
      correctTranscript: async (
        t: Pick<AiTranscript, 'attachmentId' | 'conversationId'>,
        body: UpdateTranscriptRequest,
      ): Promise<AiTranscript | 'queued'> => {
        const path = `/v1/ai/transcripts/${t.attachmentId}`;
        if (!online) {
          await engine.queueAction({
            key: `transcript|${t.attachmentId}|${body.language ?? 'original'}`,
            method: 'PATCH',
            path,
            body,
            label:
              body.reviewed !== undefined && !body.segments
                ? 'Mark transcript checked'
                : 'Correct transcript',
            conversationId: t.conversationId,
          });
          return 'queued';
        }
        return req<AiTranscript>('PATCH', path, body);
      },
      translateTranscript: (attachmentId: string, language: string) =>
        req<AiTranscript>('POST', `/v1/ai/transcripts/${attachmentId}/translations`, { language }),
      settings: () => req<MinutesSettings>('GET', '/v1/admin/minutes-settings'),
      saveSettings: (s: MinutesSettings) =>
        req<MinutesSettings>('PUT', '/v1/admin/minutes-settings', s),
    };
  }, [getAccessToken, engine, online]);
}
export type MinutesApi = ReturnType<typeof useMinutesApi>;

/** Organization defaults for minutes (template, language, export policy); refreshed live. */
export function useMinutesConfig() {
  const api = useMinutesApi();
  const [config, setConfig] = React.useState<MinutesConfig | null>(null);
  const load = React.useCallback(() => {
    if (!api.online) return;
    void api.config().then(setConfig, () => undefined);
  }, [api]);
  React.useEffect(load, [load]);
  useTenantChange('minutes', load);
  useTenantChange('ai', load);
  return config;
}

export function minutesErrorText(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.error.code === 'RATE_LIMITED')
      return 'Too many downloads at once. Try again in a minute.';
    return e.error.message;
  }
  return 'That didn’t work. Try again.';
}
