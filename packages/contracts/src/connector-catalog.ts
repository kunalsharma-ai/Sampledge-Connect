import type { ConnectorDescriptor, ConnectorProvider } from './connectors.js';

const SHARED_RETRY =
  'Queued in MongoDB and sent by the connector worker. Network errors, 5xx and 429 retry with exponential backoff and jitter (honouring Retry-After), up to 8 attempts; then the reply is marked Failed and an agent can retry it.';
const SHARED_ERRORS =
  'Auth errors (401/403) mark the connector Error and stop sending until credentials are fixed. Other 4xx fail that one reply with the provider message. After 5 consecutive failures the circuit opens for 60 s. Internal chat never waits on a provider.';

/**
 * What each connector does, in the provider's own terms. Shown in the admin catalog before
 * anyone connects, so limits are known up front. Only official, documented APIs are used.
 */
export const CONNECTOR_CATALOG: Record<ConnectorProvider, ConnectorDescriptor> = {
  telegram: {
    provider: 'telegram',
    name: 'Telegram',
    mode: 'two_way',
    summary: 'Clients message your Telegram bot; agents reply from the inbox.',
    auth: {
      method: 'Bot token from @BotFather',
      authorization:
        'Create a bot with @BotFather, paste its token. Sampledge sets the webhook with a secret token.',
    },
    credentialFields: [
      {
        key: 'botToken',
        label: 'Bot token',
        secret: true,
        required: true,
        help: 'From @BotFather, e.g. 123456:ABC-DEF…',
        placeholder: '123456789:AA…',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook secret token',
        secret: true,
        required: true,
        help: 'Any 32+ random characters. Passed to setWebhook as secret_token.',
      },
    ],
    inboundEvents: ['message (private chats)', 'edited_message', 'photo / document captions'],
    outboundOperations: ['sendMessage (reply in the same chat)'],
    attachments: {
      inbound: true,
      outbound: false,
      note: 'Inbound file metadata is kept; downloading media and sending files are planned.',
    },
    webhookValidation:
      'X-Telegram-Bot-Api-Secret-Token header compared in constant time with the stored secret.',
    rateLimit: { perSecond: 25, note: 'About 30 messages/s per bot and 1/s per chat.' },
    retry: SHARED_RETRY,
    errorHandling: SHARED_ERRORS,
    identityMapping: 'from.id → client identity; chat.id → conversation; message_id → message.',
    deliveryStates: 'ok:true → Sent. Telegram has no delivery or read receipts for bots.',
    credentialRotation:
      'Revoke the token in @BotFather, paste the new one. The old webhook secret keeps verifying during the grace window.',
    limitations: ['A bot cannot message a client first; the client must start the bot.'],
    docsUrl: 'https://core.telegram.org/bots/api',
  },
  slack: {
    provider: 'slack',
    name: 'Slack',
    mode: 'two_way',
    summary: 'Client DMs and Slack Connect channels with your Slack app.',
    auth: {
      method: 'Slack app: bot token (xoxb) + signing secret',
      authorization:
        'Create a Slack app, add chat:write, im:history and channels:history scopes, install it, then paste the bot token and signing secret.',
    },
    credentialFields: [
      {
        key: 'botToken',
        label: 'Bot user OAuth token',
        secret: true,
        required: true,
        help: 'Starts with xoxb-.',
        placeholder: 'xoxb-…',
      },
      {
        key: 'signingSecret',
        label: 'Signing secret',
        secret: true,
        required: true,
        help: 'Basic Information → App Credentials.',
      },
    ],
    inboundEvents: ['message.im', 'message.channels (Slack Connect)', 'url_verification'],
    outboundOperations: ['chat.postMessage (threaded with thread_ts)'],
    attachments: {
      inbound: true,
      outbound: false,
      note: 'File metadata is kept; uploads are planned.',
    },
    webhookValidation:
      'X-Slack-Signature = v0 HMAC-SHA256 of "v0:timestamp:body" with the signing secret; requests older than 5 minutes are rejected.',
    rateLimit: { perSecond: 1, note: 'chat.postMessage allows about 1 message/s per channel.' },
    retry: SHARED_RETRY + ' Slack redeliveries are de-duplicated by event_id.',
    errorHandling: SHARED_ERRORS,
    identityMapping: 'user → client identity; channel (+ thread_ts) → conversation; ts → message.',
    deliveryStates: 'ok:true → Sent. Slack exposes no read receipts to apps.',
    credentialRotation:
      'Regenerate the signing secret or reinstall the app, then paste new values. The old secret verifies during the grace window.',
    limitations: ['Clients outside your workspace need Slack Connect.'],
    docsUrl: 'https://api.slack.com/apis/events-api',
  },
  teams: {
    provider: 'teams',
    name: 'Microsoft Teams',
    mode: 'two_way',
    summary: 'Chat with clients through an Azure Bot in Teams.',
    auth: {
      method: 'Azure Bot: Microsoft App ID + client secret',
      authorization:
        'Register an Azure Bot, enable the Teams channel, set the messaging endpoint to the webhook URL below, then paste the App ID, secret and tenant.',
    },
    credentialFields: [
      { key: 'appId', label: 'Microsoft App ID', secret: false, required: true, help: 'GUID.' },
      {
        key: 'appPassword',
        label: 'Client secret',
        secret: true,
        required: true,
        help: 'Certificates & secrets in the app registration.',
      },
      {
        key: 'appTenantId',
        label: 'App tenant ID',
        secret: false,
        required: false,
        help: 'Only for single-tenant bots. Leave empty for multi-tenant.',
      },
    ],
    inboundEvents: ['message activity (personal and group chats)'],
    outboundOperations: ['Reply to conversation via the Bot Connector API'],
    attachments: {
      inbound: true,
      outbound: false,
      note: 'Attachment metadata is kept; sending cards and files is planned.',
    },
    webhookValidation:
      'Bearer JWT from the Bot Connector: RS256 signature against the Bot Framework OpenID keys, issuer https://api.botframework.com, audience = App ID.',
    rateLimit: { perSecond: 7, note: 'Roughly 7 messages/s per conversation, 50/s per bot.' },
    retry: SHARED_RETRY,
    errorHandling: SHARED_ERRORS,
    identityMapping:
      'from.aadObjectId (or from.id) → client identity; conversation.id + serviceUrl → conversation.',
    deliveryStates: '201 → Sent. Bots do not receive read receipts.',
    credentialRotation:
      'Add a new client secret in Azure, paste it here, then delete the old one in Azure after the grace window.',
    limitations: ['Clients must be able to reach your bot (federation or a published app).'],
    docsUrl:
      'https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference',
  },
  google_chat: {
    provider: 'google_chat',
    name: 'Google Chat',
    mode: 'two_way',
    summary: 'A Google Chat app that receives DMs and space messages.',
    auth: {
      method: 'Google Cloud service account (JSON key) for the Chat app',
      authorization:
        'Enable the Chat API, configure the app with an HTTP endpoint (the webhook URL below), and paste the project number and service-account JSON key.',
    },
    credentialFields: [
      {
        key: 'projectNumber',
        label: 'Project number',
        secret: false,
        required: true,
        help: 'Used as the token audience.',
      },
      {
        key: 'serviceAccountJson',
        label: 'Service account key (JSON)',
        secret: true,
        required: true,
        help: 'Needs the chat.bot scope.',
      },
    ],
    inboundEvents: ['MESSAGE', 'ADDED_TO_SPACE', 'REMOVED_FROM_SPACE'],
    outboundOperations: ['spaces.messages.create (threaded)'],
    attachments: { inbound: true, outbound: false, note: 'Attachment metadata only for now.' },
    webhookValidation:
      'Bearer JWT signed by chat@system.gserviceaccount.com, checked against Google’s published keys, audience = project number.',
    rateLimit: { perSecond: 1, note: 'About 1 write/s per space, 3000/min per project.' },
    retry: SHARED_RETRY,
    errorHandling: SHARED_ERRORS,
    identityMapping: 'user.name (users/…) → client identity; space.name + thread → conversation.',
    deliveryStates: '200 → Sent. No read receipts for apps.',
    credentialRotation:
      'Create a new service-account key, paste it, then delete the old key in Google Cloud.',
    limitations: ['Google Workspace accounts only; external users need external chat enabled.'],
    docsUrl: 'https://developers.google.com/workspace/chat/api/reference/rest',
  },
  discord: {
    provider: 'discord',
    name: 'Discord',
    mode: 'limited',
    summary: 'Clients use a /support command; agents reply in the channel.',
    auth: {
      method: 'Discord application: bot token + public key',
      authorization:
        'Create an application, add a bot, register a /support command and set the Interactions Endpoint URL to the webhook URL below.',
    },
    credentialFields: [
      { key: 'applicationId', label: 'Application ID', secret: false, required: true, help: '' },
      {
        key: 'publicKey',
        label: 'Public key',
        secret: false,
        required: true,
        help: 'Hex, from General Information.',
      },
      { key: 'botToken', label: 'Bot token', secret: true, required: true, help: 'Bot → Token.' },
    ],
    inboundEvents: ['Interactions: /support slash command', 'PING'],
    outboundOperations: ['Create message in the channel (POST /channels/{id}/messages)'],
    attachments: { inbound: false, outbound: false, note: 'Text only.' },
    webhookValidation:
      'Ed25519 signature (X-Signature-Ed25519 over timestamp + body) with the application public key.',
    rateLimit: { perSecond: 1, note: '5 messages per 5 s per channel; 50 requests/s global.' },
    retry: SHARED_RETRY,
    errorHandling: SHARED_ERRORS,
    identityMapping: 'member.user.id → client identity; channel_id → conversation.',
    deliveryStates: '200 → Sent. No read receipts.',
    credentialRotation: 'Reset the bot token in the developer portal and paste it here.',
    limitations: [
      'Limited: ordinary messages need a Gateway (websocket) worker, which is planned. Today clients reach you through the /support command.',
    ],
    docsUrl: 'https://discord.com/developers/docs/interactions/receiving-and-responding',
  },
  line: {
    provider: 'line',
    name: 'LINE',
    mode: 'two_way',
    summary: 'Your LINE Official Account through the Messaging API.',
    auth: {
      method: 'Messaging API channel: channel secret + long-lived channel access token',
      authorization:
        'In LINE Developers, create a Messaging API channel, set the webhook URL below, and paste the channel secret and access token.',
    },
    credentialFields: [
      { key: 'channelSecret', label: 'Channel secret', secret: true, required: true, help: '' },
      {
        key: 'channelAccessToken',
        label: 'Channel access token',
        secret: true,
        required: true,
        help: 'Long-lived token.',
      },
    ],
    inboundEvents: ['message (text, image, file, sticker)', 'follow', 'unfollow'],
    outboundOperations: ['Push message (POST /v2/bot/message/push)'],
    attachments: { inbound: true, outbound: false, note: 'Inbound media is recorded by id.' },
    webhookValidation: 'X-Line-Signature = base64 HMAC-SHA256 of the body with the channel secret.',
    rateLimit: { perSecond: 100, note: 'Push requests are limited per channel and by plan quota.' },
    retry: SHARED_RETRY + ' Redeliveries are de-duplicated by webhookEventId.',
    errorHandling: SHARED_ERRORS,
    identityMapping: 'source.userId → client identity; userId / groupId → conversation.',
    deliveryStates: '200 → Sent. LINE gives no read receipts to the API.',
    credentialRotation:
      'Issue a new channel access token (or reissue the secret), paste it; the old secret verifies during the grace window.',
    limitations: ['Push messages count toward your LINE plan’s monthly message quota.'],
    docsUrl: 'https://developers.line.biz/en/reference/messaging-api/',
  },
  mattermost: {
    provider: 'mattermost',
    name: 'Mattermost',
    mode: 'two_way',
    summary: 'A Mattermost bot on your own server.',
    auth: {
      method: 'Bot access token + outgoing webhook token',
      authorization:
        'Create a bot account and an outgoing webhook pointing at the webhook URL below, then paste the server URL and both tokens.',
    },
    credentialFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        secret: false,
        required: true,
        help: 'https://chat.example.com',
      },
      { key: 'botToken', label: 'Bot access token', secret: true, required: true, help: '' },
      {
        key: 'webhookToken',
        label: 'Outgoing webhook token',
        secret: true,
        required: true,
        help: 'Shown when the outgoing webhook is created.',
      },
    ],
    inboundEvents: ['Outgoing webhook post (trigger words or channel)'],
    outboundOperations: ['POST /api/v4/posts (threaded with root_id)'],
    attachments: { inbound: false, outbound: false, note: 'Text only for now.' },
    webhookValidation: 'Webhook token in the payload compared in constant time.',
    rateLimit: { perSecond: 10, note: 'Server default is 10 requests/s per token.' },
    retry: SHARED_RETRY,
    errorHandling: SHARED_ERRORS,
    identityMapping: 'user_id → client identity; channel_id → conversation; post_id → message.',
    deliveryStates: '201 → Sent.',
    credentialRotation: 'Regenerate the bot token or webhook token in Mattermost and paste it.',
    limitations: [],
    docsUrl: 'https://developers.mattermost.com/integrate/webhooks/outgoing/',
  },
  nextcloud_talk: {
    provider: 'nextcloud_talk',
    name: 'Nextcloud Talk',
    mode: 'two_way',
    summary: 'A Talk bot in your own Nextcloud.',
    auth: {
      method: 'Talk bot shared secret (Nextcloud 27.1+)',
      authorization:
        'Install the bot with occ talk:bot:install using the webhook URL below and a 40+ character secret, then enable it in the conversations clients use.',
    },
    credentialFields: [
      {
        key: 'serverUrl',
        label: 'Nextcloud URL',
        secret: false,
        required: true,
        help: 'https://cloud.example.com',
      },
      {
        key: 'botSecret',
        label: 'Bot secret',
        secret: true,
        required: true,
        help: 'The secret given to occ talk:bot:install (40–128 chars).',
      },
    ],
    inboundEvents: ['Create (chat message)'],
    outboundOperations: ['POST /ocs/v2.php/apps/spreed/api/v1/bot/{token}/message'],
    attachments: { inbound: false, outbound: false, note: 'Text (markdown) only.' },
    webhookValidation:
      'X-Nextcloud-Talk-Signature = hex HMAC-SHA256 of random + body with the bot secret.',
    rateLimit: {
      perSecond: 5,
      note: 'Depends on your server; bots are throttled by brute-force protection.',
    },
    retry: SHARED_RETRY,
    errorHandling: SHARED_ERRORS,
    identityMapping: 'actor.id → client identity; target.id (room token) → conversation.',
    deliveryStates: '201 → Sent.',
    credentialRotation:
      'Reinstall the bot with a new secret (occ talk:bot:install), paste it; the old one verifies during the grace window.',
    limitations: ['Requires Nextcloud 27.1 or newer with Talk bots enabled.'],
    docsUrl: 'https://nextcloud-talk.readthedocs.io/en/latest/bots/',
  },
  wechat: {
    provider: 'wechat',
    name: 'WeChat',
    mode: 'limited',
    summary: 'A verified WeChat Official Account (Service Account).',
    auth: {
      method: 'Official Account AppID + AppSecret, server token',
      authorization:
        'In the Official Account platform, set the server URL to the webhook URL below with your token (plain-text mode), and paste AppID, AppSecret and token.',
    },
    credentialFields: [
      { key: 'appId', label: 'AppID', secret: false, required: true, help: '' },
      { key: 'appSecret', label: 'AppSecret', secret: true, required: true, help: '' },
      {
        key: 'token',
        label: 'Server token',
        secret: true,
        required: true,
        help: 'The token entered in the server configuration.',
      },
    ],
    inboundEvents: ['text message', 'image message (media id)', 'subscribe event'],
    outboundOperations: ['Customer service message (message/custom/send)'],
    attachments: { inbound: true, outbound: false, note: 'Inbound media ids are recorded.' },
    webhookValidation:
      'signature = SHA1 of the sorted token, timestamp and nonce. Encrypted (safe) mode is planned.',
    rateLimit: { perSecond: 5, note: 'Access-token and per-user limits apply.' },
    retry: SHARED_RETRY + ' WeChat retries are de-duplicated by MsgId.',
    errorHandling: SHARED_ERRORS,
    identityMapping: 'FromUserName (OpenID) → client identity and conversation; MsgId → message.',
    deliveryStates: 'errcode 0 → Sent.',
    credentialRotation: 'Reset the AppSecret in the platform and paste it.',
    limitations: [
      'Limited: you can only reply within 48 hours of the client’s last message.',
      'Needs a verified Service Account; mainland-China rules apply.',
    ],
    docsUrl: 'https://developers.weixin.qq.com/doc/offiaccount/en/Getting_Started/Overview.html',
  },
  qq: {
    provider: 'qq',
    name: 'QQ Bot',
    mode: 'limited',
    summary: 'An official QQ bot from the QQ Open Platform.',
    auth: {
      method: 'Bot AppID + AppSecret (access token issued by bots.qq.com)',
      authorization:
        'Register a bot on q.qq.com, set the webhook callback URL below, and paste the AppID and AppSecret.',
    },
    credentialFields: [
      { key: 'appId', label: 'AppID', secret: false, required: true, help: '' },
      {
        key: 'appSecret',
        label: 'AppSecret',
        secret: true,
        required: true,
        help: 'Also used to sign and verify webhook calls.',
      },
    ],
    inboundEvents: ['C2C_MESSAGE_CREATE (direct)', 'callback URL validation (op 13)'],
    outboundOperations: ['Passive reply to a direct message (v2/users/{openid}/messages)'],
    attachments: { inbound: false, outbound: false, note: 'Text only.' },
    webhookValidation:
      'Ed25519 signature (X-Signature-Ed25519 over timestamp + body) with a key derived from the AppSecret.',
    rateLimit: { perSecond: 5, note: 'Strict per-user quotas on proactive messages.' },
    retry: SHARED_RETRY,
    errorHandling: SHARED_ERRORS,
    identityMapping: 'author.user_openid → client identity and conversation; id → message.',
    deliveryStates: '200 → Sent.',
    credentialRotation: 'Reset the AppSecret on q.qq.com and paste it.',
    limitations: [
      'Limited: replies must reference a recent client message (passive reply window). Proactive messages are heavily restricted.',
    ],
    docsUrl: 'https://bot.q.qq.com/wiki/develop/api-v2/',
  },
  signal: {
    provider: 'signal',
    name: 'Signal',
    mode: 'handoff',
    summary: 'Hand off to the Signal app; the inbox keeps the record.',
    auth: {
      method: 'None (no official business API)',
      authorization: 'Enter the business number your team uses in Signal.',
    },
    credentialFields: [
      {
        key: 'businessNumber',
        label: 'Business number',
        secret: false,
        required: false,
        help: 'Shown to agents; E.164, e.g. +4915112345678.',
      },
    ],
    inboundEvents: ['Logged by an agent'],
    outboundOperations: ['Open chat in Signal (signal.me link); agent sends it there'],
    attachments: { inbound: false, outbound: false, note: 'Send files in Signal.' },
    webhookValidation: 'No webhook.',
    rateLimit: { perSecond: 0, note: 'Not applicable.' },
    retry: 'Not applicable: nothing is sent automatically.',
    errorHandling: 'Not applicable.',
    identityMapping: 'Client phone number → client identity.',
    deliveryStates: 'Replies are marked Handoff until the agent sends them in Signal.',
    credentialRotation: 'Not applicable.',
    limitations: [
      'Handoff only: Signal has no supported business or bot API, so Sampledge never automates it.',
    ],
    docsUrl: 'https://support.signal.org/',
  },
  imessage: {
    provider: 'imessage',
    name: 'iMessage',
    mode: 'handoff',
    summary: 'Hand off to Messages; Apple Messages for Business is planned.',
    auth: {
      method: 'None today (Apple Messages for Business needs an approved provider)',
      authorization: 'Enter the number or Apple ID your team texts from.',
    },
    credentialFields: [
      {
        key: 'senderId',
        label: 'Your number or Apple ID',
        secret: false,
        required: false,
        help: 'Shown to agents.',
      },
    ],
    inboundEvents: ['Logged by an agent'],
    outboundOperations: ['Open chat in Messages (sms: link); agent sends it there'],
    attachments: { inbound: false, outbound: false, note: 'Send files in Messages.' },
    webhookValidation: 'No webhook.',
    rateLimit: { perSecond: 0, note: 'Not applicable.' },
    retry: 'Not applicable: nothing is sent automatically.',
    errorHandling: 'Not applicable.',
    identityMapping: 'Client phone number or email → client identity.',
    deliveryStates: 'Replies are marked Handoff until the agent sends them in Messages.',
    credentialRotation: 'Not applicable.',
    limitations: [
      'Handoff only: there is no public iMessage API. Apple Messages for Business through an approved messaging service provider is planned.',
    ],
    docsUrl: 'https://register.apple.com/resources/messages/messaging-documentation/',
  },
};
