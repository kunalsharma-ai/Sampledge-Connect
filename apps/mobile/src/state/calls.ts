import type {
  Call,
  CallJoin,
  CallMedia,
  CallRingingEvent,
  CallsConfig,
} from '@sampledge/contracts';
import { Emitter } from '../lib/emitter';
import type { RealtimeClient } from '../sync/realtime';
import { TransportError, type ApiTransport } from '../sync/transport';

/** The call you are in on this device, with what the media layer needs to connect. */
export interface CurrentCall {
  call: Call;
  join: CallJoin;
  /** Media you chose when starting or answering. */
  media: CallMedia;
}

export interface CallsState {
  /** Null until loaded (or when there is no server). */
  config: CallsConfig | null;
  /** Live calls by conversation id. */
  live: Record<string, Call>;
  /** A call ringing for you right now. */
  incoming: CallRingingEvent | null;
  current: CurrentCall | null;
  /** Why the last call action failed, for the UI to show once. */
  error: string | null;
}

/**
 * Call signalling for this device: which calls are live, ringing, and the one you are in.
 * Media itself goes straight to the self-hosted SFU; this class only talks to the API.
 * Calls need a connection, so nothing here is queued offline.
 */
export class CallController {
  readonly events = new Emitter<{ change: CallsState }>();
  private _state: CallsState = {
    config: null,
    live: {},
    incoming: null,
    current: null,
    error: null,
  };
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: (() => void)[] = [];

  constructor(
    private readonly api: ApiTransport,
    private readonly selfId: string,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): CallsState {
    return this._state;
  }

  attach(realtime: RealtimeClient): void {
    this.unsubs.push(
      realtime.events.on('callRinging', (e) => this.ring(e)),
      realtime.events.on('callUpdated', (c) => this.applyCall(c)),
    );
  }

  stop(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.clearRing();
  }

  /** Reloads config and live calls (after connecting or returning to the app). */
  async refresh(): Promise<void> {
    try {
      const [config, calls] = await Promise.all([this.api.callsConfig(), this.api.activeCalls()]);
      const live: Record<string, Call> = {};
      for (const c of calls) if (c.status === 'live') live[c.conversationId] = c;
      this.patch({ config, live });
      // A ringing call that ended while we were away stops ringing.
      const inc = this._state.incoming;
      if (inc && !live[inc.conversationId]) this.clearRing();
    } catch {
      // Calls stay hidden until the server answers.
    }
  }

  /** Starts a call in a conversation, or joins the one already live there. */
  async start(conversationId: string, media: CallMedia): Promise<CurrentCall | null> {
    return this.enter(() => this.api.startCall(conversationId, media), media);
  }

  async join(callId: string, media: CallMedia): Promise<CurrentCall | null> {
    return this.enter(() => this.api.joinCall(callId), media);
  }

  /** Answers the ringing call. */
  async accept(media?: CallMedia): Promise<CurrentCall | null> {
    const inc = this._state.incoming;
    if (!inc) return null;
    this.clearRing();
    return this.join(inc.call.callId, media ?? inc.media);
  }

  async decline(): Promise<void> {
    const inc = this._state.incoming;
    if (!inc) return;
    this.clearRing();
    await this.act(inc.call.callId, 'decline');
  }

  /** Leaves the call you are in (it keeps going for the others). */
  async leave(): Promise<void> {
    const cur = this._state.current;
    if (!cur) return;
    this.patch({ current: null });
    await this.act(cur.call.callId, 'leave');
  }

  /** Ends the call for everyone (the caller, or a conversation owner or moderator). */
  async endForAll(): Promise<void> {
    const cur = this._state.current;
    if (!cur) return;
    this.patch({ current: null });
    await this.act(cur.call.callId, 'end');
  }

  /**
   * Jitsi calls: "still in the call", every JITSI_PRESENCE_EVERY_SECONDS while the call screen
   * is open. The Jitsi server doesn't report who is in a room, so a phone that stops sending
   * this is marked as having left.
   */
  async presence(): Promise<void> {
    const cur = this._state.current;
    if (!cur || cur.join.engine !== 'jitsi') return;
    try {
      this.applyCall(await this.api.callAction(cur.call.callId, 'presence'));
    } catch {
      // Offline for a moment: the next one catches up.
    }
  }

  /** A fresh token when the old one expired mid-call (the SFU asks again on reconnect). */
  async rejoin(): Promise<CallJoin | null> {
    const cur = this._state.current;
    if (!cur) return null;
    const r = await this.enter(() => this.api.joinCall(cur.call.callId), cur.media);
    return r?.join ?? null;
  }

  /** A push for a ringing call was opened: ring here if it is still ringing for you. */
  async openFromPush(callId: string): Promise<void> {
    try {
      const call = await this.api.getCall(callId);
      const me = call.participants.find((p) => p.userId === this.selfId);
      if (call.status === 'live' && me?.state === 'ringing')
        this.ring({
          call,
          callerId: call.startedBy,
          conversationId: call.conversationId,
          media: call.media,
          expiresAt: new Date(this.now() + 30_000).toISOString(),
        });
      else this.applyCall(call);
    } catch {
      // The call is gone or not ours: nothing to show.
    }
  }

  /**
   * Starts or stops recording the call you are in (anyone joined may). Everyone in the call
   * sees the Recording indicator from the call record; the file arrives in the chat later.
   */
  async setRecording(on: boolean): Promise<boolean> {
    const cur = this._state.current;
    if (!cur) return false;
    try {
      const id = cur.call.callId;
      this.applyCall(await (on ? this.api.startCallRecording(id) : this.api.stopCallRecording(id)));
      return true;
    } catch (err) {
      // The server says exactly why recording is not allowed (turned off, not set up, not joined).
      this.patch({
        error:
          err instanceof TransportError && err.code === 'FORBIDDEN' ? err.message : describe(err),
      });
      return false;
    }
  }

  /** Turns a clip of my own speech in the current call into text (empty when nothing heard). */
  async transcribeCaption(clip: Blob): Promise<string> {
    const cur = this._state.current;
    if (!cur) return '';
    return (await this.api.transcribeCaption(cur.call.callId, clip)).text.trim();
  }

  /** Admits or denies a guest waiting in the lobby of the call you are in. */
  async decideGuest(guestId: string, decision: 'admit' | 'deny'): Promise<boolean> {
    const cur = this._state.current;
    if (!cur) return false;
    try {
      this.applyCall(await this.api.lobbyDecision(cur.call.callId, guestId, decision));
      return true;
    } catch (err) {
      // Someone else answered first: the next call:updated shows the outcome.
      if (err instanceof TransportError && err.code === 'CONFLICT') {
        void this.api.getCall(cur.call.callId).then(
          (c) => this.applyCall(c),
          () => undefined,
        );
        return false;
      }
      this.patch({ error: err instanceof TransportError ? err.message : describe(err) });
      return false;
    }
  }

  dismissError(): void {
    this.patch({ error: null });
  }

  /** Applies a call record from the server (socket event or response). */
  applyCall(call: Call): void {
    const live = { ...this._state.live };
    if (call.status === 'live') live[call.conversationId] = call;
    else delete live[call.conversationId];
    const cur = this._state.current;
    const current =
      cur && cur.call.callId === call.callId
        ? call.status === 'live'
          ? { ...cur, call }
          : null
        : cur;
    this.patch({ live, current });
    const inc = this._state.incoming;
    if (inc && inc.call.callId === call.callId) {
      const me = call.participants.find((p) => p.userId === this.selfId);
      // Answered on another device, declined, missed, or the call ended: stop ringing here.
      if (call.status !== 'live' || me?.state !== 'ringing') this.clearRing();
    }
  }

  private ring(e: CallRingingEvent): void {
    if (this._state.current?.call.callId === e.call.callId) return;
    const ms = new Date(e.expiresAt).getTime() - this.now();
    if (ms <= 0) return;
    this.clearRing();
    this.patch({
      incoming: e,
      live: { ...this._state.live, [e.conversationId]: e.call },
    });
    this.ringTimer = setTimeout(() => this.clearRing(), ms);
  }

  private clearRing(): void {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
    if (this._state.incoming) this.patch({ incoming: null });
  }

  private async enter(
    req: () => Promise<{ call: Call; join: CallJoin }>,
    media: CallMedia,
  ): Promise<CurrentCall | null> {
    try {
      const { call, join } = await req();
      const current: CurrentCall = { call, join, media };
      this.patch({
        current,
        live: { ...this._state.live, [call.conversationId]: call },
        error: null,
      });
      return current;
    } catch (err) {
      this.patch({ error: describe(err) });
      return null;
    }
  }

  private async act(callId: string, action: 'leave' | 'decline' | 'end'): Promise<void> {
    try {
      this.applyCall(await this.api.callAction(callId, action));
    } catch {
      // Best effort: the server's sweeper also notices when someone drops out of the room.
    }
  }

  private patch(p: Partial<CallsState>): void {
    this._state = { ...this._state, ...p };
    this.events.emit('change', this._state);
  }
}

function describe(err: unknown): string {
  if (err instanceof TransportError) {
    if (err.kind === 'network') return 'You are offline. Calls need a connection.';
    if (err.code === 'CONFLICT') return 'That call has already ended.';
    if (err.code === 'FORBIDDEN') return 'You cannot join calls in this conversation.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'The call could not start.';
}
