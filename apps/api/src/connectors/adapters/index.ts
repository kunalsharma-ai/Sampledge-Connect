import type { ConnectorProvider } from '@sampledge/contracts';
import type { ConnectorAdapter } from './types.js';
import { telegramAdapter } from './telegram.js';
import { slackAdapter } from './slack.js';
import { teamsAdapter } from './teams.js';
import { googleChatAdapter } from './google-chat.js';
import { discordAdapter } from './discord.js';
import { lineAdapter } from './line.js';
import { mattermostAdapter } from './mattermost.js';
import { nextcloudTalkAdapter } from './nextcloud-talk.js';
import { wechatAdapter } from './wechat.js';
import { qqAdapter } from './qq.js';
import { imessageAdapter, signalAdapter } from './handoff.js';

/** The plugin registry. Adding a provider = one adapter file + one catalog entry. */
export const ADAPTERS: Record<ConnectorProvider, ConnectorAdapter> = {
  telegram: telegramAdapter,
  slack: slackAdapter,
  teams: teamsAdapter,
  google_chat: googleChatAdapter,
  discord: discordAdapter,
  line: lineAdapter,
  mattermost: mattermostAdapter,
  nextcloud_talk: nextcloudTalkAdapter,
  wechat: wechatAdapter,
  qq: qqAdapter,
  signal: signalAdapter,
  imessage: imessageAdapter,
};

export * from './types.js';
