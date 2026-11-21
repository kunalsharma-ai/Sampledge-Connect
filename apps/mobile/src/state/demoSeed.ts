import { uuidv7, type Conversation, type Message } from '@sampledge/contracts';
import type { LocalStore } from '../db/store';

/**
 * Local demo workspace. Chosen explicitly on the sign-in screen and labelled
 * everywhere as "Demo workspace, no server connected". Nothing here pretends to
 * be live: messages you send stay queued on the device because there is no server.
 */
export const DEMO_SELF = 'demo-you';

export const DEMO_PEOPLE: Record<string, string> = {
  [DEMO_SELF]: 'You',
  'demo-aisha': 'Aisha Khan',
  'demo-marco': 'Marco Silva',
  'demo-lena': 'Lena Fischer',
  'demo-ravi': 'Ravi Menon',
};

export async function seedDemo(store: LocalStore): Promise<void> {
  if ((await store.getSetting('demo.seeded')) === '1') return;
  const t0 = Date.now() - 1000 * 60 * 60 * 5;
  const conv = (
    id: string,
    kind: Conversation['kind'],
    name: string | null,
    topic: string | null,
    members: string[],
  ): Conversation => ({
    conversationId: id,
    tenantId: 'demo',
    workspaceId: 'demo',
    kind,
    name,
    topic,
    memberIds: members,
    createdBy: DEMO_SELF,
    createdAt: new Date(t0).toISOString(),
    archivedAt: null,
    lastChangeSequence: 0,
    lastMessageAt: null,
    myRole: 'member',
    myNotifyLevel: 'all',
  });
  const all = Object.keys(DEMO_PEOPLE);
  const conversations = [
    conv(
      'demo-fieldwork',
      'channel_public',
      'fieldwork-ops',
      'Daily field status across all live studies',
      all,
    ),
    conv('demo-aisha', 'dm', null, null, [DEMO_SELF, 'demo-aisha']),
    conv('demo-qa', 'channel_private', 'qa-review', 'Questionnaire QA before client sign-off', [
      DEMO_SELF,
      'demo-lena',
      'demo-ravi',
    ]),
    conv('demo-launch', 'group', 'Retail tracker launch', null, [
      DEMO_SELF,
      'demo-marco',
      'demo-aisha',
    ]),
  ];
  await store.upsertConversations(conversations);

  const script: [
    string,
    string,
    string,
    { mentions?: string[]; replyToSeq?: number; reactions?: [string, string[]][] }?,
  ][] = [
    [
      'demo-fieldwork',
      'demo-marco',
      'Morning all. UK panel is at 62% of quota for the retail tracker, DE at 48%.',
    ],
    [
      'demo-fieldwork',
      'demo-lena',
      'DE is slow because of the 35-44 cell. I can open a boost sample this afternoon.',
      { replyToSeq: 1 },
    ],
    ['demo-fieldwork', DEMO_SELF, 'Please do. Keep the incidence assumptions from last wave.'],
    [
      'demo-fieldwork',
      'demo-ravi',
      'Data checks on the first 400 completes look clean. Two speeders removed.',
      {
        reactions: [
          ['👍', ['demo-marco', DEMO_SELF]],
          ['🎉', ['demo-lena']],
        ],
      },
    ],
    ['demo-aisha', 'demo-aisha', 'Do you have five minutes before the client call?'],
    ['demo-aisha', DEMO_SELF, 'Yes, calling you now.'],
    [
      'demo-aisha',
      'demo-aisha',
      'Thanks. Sending the revised proposal deck after lunch.',
      { replyToSeq: 2 },
    ],
    [
      'demo-qa',
      'demo-lena',
      'Q14 routing skips the brand-awareness block for non-users. Is that intended?',
    ],
    [
      'demo-qa',
      'demo-ravi',
      'No, that is a bug. @Lena Fischer the fix is in, can you re-test Q14?',
      { mentions: ['demo-lena'], replyToSeq: 1 },
    ],
    ['demo-launch', 'demo-marco', 'Soft launch is live. Watching the first 50 completes.'],
    [
      'demo-fieldwork',
      'demo-lena',
      'Boost sample is open for DE 35-44. Incidence kept at 18% as last wave.',
      { replyToSeq: 3 },
    ],
  ];
  const seqByConv = new Map<string, number>();
  const messages: Message[] = script.map(([conversationId, senderId, text, extra], i) => {
    const seq = (seqByConv.get(conversationId) ?? 0) + 1;
    seqByConv.set(conversationId, seq);
    const at = t0 + i * 1000 * 60 * 23;
    return {
      messageId: `demo-${conversationId}-${seq}`,
      clientMessageId: uuidv7(at),
      tenantId: 'demo',
      conversationId,
      senderId,
      messageType: 'text',
      content: { text, mentions: extra?.mentions ?? [] },
      attachmentIds: [],
      attachments: [],
      replyToMessageId: extra?.replyToSeq ? `demo-${conversationId}-${extra.replyToSeq}` : null,
      serverSequence: seq,
      changeSequence: seq,
      createdAt: new Date(at).toISOString(),
      editedAt: null,
      deletedAt: null,
      metadata: {},
      reactions: (extra?.reactions ?? []).map(([emoji, userIds]) => ({
        emoji,
        userIds,
        count: userIds.length,
      })),
    };
  });
  await store.applyServerMessages(messages);
  // Your own demo messages count as read by everyone so the ticks look settled.
  await store.applyReceipts(
    conversations.flatMap((c) =>
      c.memberIds
        .filter((m) => m !== DEMO_SELF)
        .map((userId) => ({
          conversationId: c.conversationId,
          userId,
          deliveredUpTo: seqByConv.get(c.conversationId) ?? 0,
          readUpTo: seqByConv.get(c.conversationId) ?? 0,
        })),
    ),
  );
  await store.markReadLocally('demo-fieldwork', 3);
  // Activity: what the server feed would hold for these messages (replies to you, mentions of you).
  const byId = new Map(messages.map((m) => [m.messageId, m]));
  const items = messages
    .filter((m) => m.senderId !== DEMO_SELF)
    .flatMap((m) => {
      const kind = m.content.mentions?.includes(DEMO_SELF)
        ? ('mention' as const)
        : m.replyToMessageId && byId.get(m.replyToMessageId)?.senderId === DEMO_SELF
          ? ('reply' as const)
          : null;
      return kind
        ? [
            {
              notificationId: `demo-n-${m.messageId}`,
              kind,
              conversationId: m.conversationId,
              messageId: m.messageId,
              actorId: m.senderId,
              preview: m.content.text.slice(0, 140),
              createdAt: m.createdAt,
              readAt: null,
            },
          ]
        : [];
    })
    .reverse();
  await store.replaceNotifications({ items, unreadCount: items.length, nextBefore: null });
  await store.setSetting('people', JSON.stringify(DEMO_PEOPLE));
  await store.setSetting('demo.seeded', '1');
}
