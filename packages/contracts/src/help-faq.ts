import type { FeatureHelpCategory } from './feature-help.js';

/**
 * Frequently asked questions for the Help center, on web and mobile. Each answer is short and
 * plain, and links to the feature guide it belongs to (`featureId`, a FEATURE_HELP id), so a
 * person can read more. Only describe what is built.
 */
export interface HelpFaq {
  id: string;
  category: FeatureHelpCategory;
  question: string;
  answer: string;
  featureId?: string;
  /** Only shown to owners and admins. */
  adminOnly?: boolean;
}

export const HELP_FAQS: readonly HelpFaq[] = [
  // Getting around
  {
    id: 'what-is',
    category: 'basics',
    question: 'What is SampConnect?',
    answer:
      'One secure workspace for your organization: chat, channels, calls and meetings, tasks and approvals, files, a shared client inbox and a private AI assistant, on the web and your phone.',
    featureId: 'home',
  },
  {
    id: 'where-start',
    category: 'basics',
    question: 'Where should I start each day?',
    answer:
      'Open Home. It shows unread conversations, mentions, your next meetings, tasks that are due and approvals waiting on you. Tap any card to jump straight there.',
    featureId: 'home',
  },
  {
    id: 'offline',
    category: 'basics',
    question: 'Does it work without internet?',
    answer:
      'Yes. Everything you have opened stays readable, and what you do (messages, edits, reactions, tasks, settings and more) is saved on your device and sent in order as soon as you are back online.',
    featureId: 'sync',
  },
  {
    id: 'devices-sync',
    category: 'basics',
    question: 'Will my phone and computer stay in step?',
    answer:
      'Yes. Reads, messages, settings and choices you make on one device show on your other devices straight away.',
    featureId: 'sync',
  },
  {
    id: 'missed',
    category: 'basics',
    question: 'How do I see what I missed?',
    answer:
      'Notifications (Activity on the phone) lists mentions, replies, reactions and invites. For a busy conversation, use Catch me up to get an AI summary.',
    featureId: 'notifications',
  },
  {
    id: 'help-symbol',
    category: 'basics',
    question: 'What is the gold “i” next to features?',
    answer:
      'It opens a short guide to that feature: what it is, why it helps, where to find it and how to use it. All guides are also in Help > Feature guides.',
  },

  // Messaging
  {
    id: 'start-chat',
    category: 'messaging',
    question: 'How do I start a conversation?',
    answer:
      'Select New (the pencil on the phone), pick one or more people and type your message. A group is created when you pick more than one person.',
    featureId: 'messages',
  },
  {
    id: 'edit-delete',
    category: 'messaging',
    question: 'Can I edit or delete a message after sending it?',
    answer:
      'Yes. Hover over (or long-press) your message and choose Edit or Delete. Everyone sees the change, on every device.',
    featureId: 'messages',
  },
  {
    id: 'mention',
    category: 'messaging',
    question: 'How do I get someone’s attention?',
    answer:
      'Type @ and pick their name. They get a notification even if the conversation is muted for mentions only.',
    featureId: 'messages',
  },
  {
    id: 'read-receipts',
    category: 'messaging',
    question: 'How do I know my message was read?',
    answer: 'The ticks under your message show when it was sent, delivered and read.',
    featureId: 'messages',
  },
  {
    id: 'channel-vs-group',
    category: 'messaging',
    question: 'What is the difference between a channel and a group?',
    answer:
      'A group is a private chat with chosen people. A channel is a topic room the team can find and join; private channels are invite-only, and announcement channels let only chosen people post.',
    featureId: 'channels',
  },
  {
    id: 'thread',
    category: 'messaging',
    question: 'How do I reply to one message without cluttering the chat?',
    answer: 'Choose Reply in thread on that message. The thread opens beside the conversation.',
    featureId: 'threads',
  },
  {
    id: 'save-later',
    category: 'messaging',
    question: 'How do I keep a message to come back to?',
    answer: 'Choose Save on it. Find it later under Saved. Only you can see your saved list.',
    featureId: 'threads',
  },
  {
    id: 'find-file',
    category: 'messaging',
    question: 'Where are the files people sent me?',
    answer:
      'Open Files to see every file shared in your conversations, with filters for type, person and conversation.',
    featureId: 'files',
  },
  {
    id: 'schedule',
    category: 'messaging',
    question: 'Can I send a message later?',
    answer:
      'Yes. Use Schedule send (the clock next to Send, or hold Send on the phone) and pick a time. You can edit or cancel it until it goes.',
    featureId: 'scheduled-messages',
  },
  {
    id: 'poll',
    category: 'messaging',
    question: 'How do I run a quick vote?',
    answer:
      'Use the plus menu in the message box and choose Poll. Results update live for everyone.',
    featureId: 'polls',
  },
  {
    id: 'mute',
    category: 'messaging',
    question: 'How do I stop a busy channel from notifying me?',
    answer:
      'Open its menu and choose a notify level: all activity, mentions only, or nothing. Unread counts still update.',
    featureId: 'quiet-hours',
  },

  // Calls and meetings
  {
    id: 'start-call',
    category: 'meetings',
    question: 'How do I start a call?',
    answer: 'Open a conversation and press the phone or camera button at the top.',
    featureId: 'calls',
  },
  {
    id: 'call-private',
    category: 'meetings',
    question: 'Are calls private?',
    answer: 'Yes. Calls run on your organization’s own call server, not an outside service.',
    featureId: 'calls',
  },
  {
    id: 'blur',
    category: 'meetings',
    question: 'Can I blur or change my background?',
    answer:
      'Yes. Open Call background (or the effects button during a call) and pick blur, a photo or your own picture.',
    featureId: 'call-background',
  },
  {
    id: 'invite-external',
    category: 'meetings',
    question: 'Can I invite people outside my organization to a meeting?',
    answer:
      'Yes. Add their email when you schedule the meeting. They get a link and can join from a browser without an account.',
    featureId: 'meetings',
  },
  {
    id: 'booking',
    category: 'meetings',
    question: 'How do clients book time with me?',
    answer:
      'Create a booking page under Meetings > Booking pages and share its link. People pick a free slot from your working hours.',
    featureId: 'booking-pages',
  },
  {
    id: 'record',
    category: 'meetings',
    question: 'How do I record a meeting and find it later?',
    answer:
      'Start recording from the call controls; everyone is told. After the call, open Recordings to play, download or delete it.',
    featureId: 'recordings',
  },
  {
    id: 'minutes',
    category: 'meetings',
    question: 'Can I get meeting notes automatically?',
    answer:
      'Yes. Minutes are drafted from the transcript with decisions and action items. Review and edit them, then share or turn actions into tasks.',
    featureId: 'minutes',
  },

  // Work
  {
    id: 'task-from-message',
    category: 'work',
    question: 'How do I turn a message into a task?',
    answer: 'Open the message menu and choose Create task. Pick an owner and a due date.',
    featureId: 'tasks',
  },
  {
    id: 'approval',
    category: 'work',
    question: 'How do I ask someone to approve something?',
    answer:
      'Choose Request approval, describe it and pick who decides. They approve or reject with a comment, and you are notified.',
    featureId: 'tasks',
  },
  {
    id: 'projects',
    category: 'work',
    question: 'What are projects for?',
    answer:
      'A project groups the people, conversations and tasks of one piece of work so everyone sees progress in one place.',
    featureId: 'projects',
  },

  // Clients
  {
    id: 'inbox-what',
    category: 'clients',
    question: 'What is the Client Inbox?',
    answer:
      'A shared inbox for client messages from email, WhatsApp, web chat and other channels. Assign conversations, add internal notes and track response times.',
    featureId: 'client-inbox',
  },
  {
    id: 'inbox-notes',
    category: 'clients',
    question: 'Can clients see internal notes?',
    answer: 'No. Notes are only visible to your team.',
    featureId: 'client-inbox',
  },
  {
    id: 'inbox-connect',
    category: 'clients',
    question: 'How do we connect WhatsApp or email to the inbox?',
    answer:
      'An admin opens Client Inbox > Channels, adds the channel, enters its details and tests the connection.',
    featureId: 'inbox-channels',
    adminOnly: true,
  },

  // Find and understand
  {
    id: 'search-all',
    category: 'discover',
    question: 'How do I find an old message?',
    answer:
      'Use Universal Search (Ctrl+Shift+F on web). Type a word or name and narrow it down by person, conversation, date or type.',
    featureId: 'search',
  },
  {
    id: 'ai-private',
    category: 'discover',
    question: 'Can the AI assistant see everything?',
    answer:
      'No. It only uses conversations and files you are allowed to see, and your data stays under your organization’s control.',
    featureId: 'ai',
  },
  {
    id: 'ai-ask',
    category: 'discover',
    question: 'What can I ask the AI assistant?',
    answer:
      'Questions about your work (“What did we decide about the Q4 tracker?”), summaries of busy conversations, and help drafting replies.',
    featureId: 'ai',
  },

  // Network
  {
    id: 'network-what',
    category: 'network',
    question: 'What is SampConnect Network?',
    answer:
      'A separate space for connecting with people in other organizations: connections, messages, status updates and communities. Your work chat stays private to your organization.',
    featureId: 'network',
  },
  {
    id: 'connect-id',
    category: 'network',
    question: 'How do people find me on the Network?',
    answer:
      'By your Connect ID or name, if your privacy settings allow it. You choose who can find you and message you in your network profile.',
    featureId: 'network-people',
  },
  {
    id: 'block',
    category: 'network',
    question: 'How do I block or report someone?',
    answer: 'Open their profile and choose Block or Report. Blocked people cannot message you.',
    featureId: 'network-people',
  },

  // Make it yours
  {
    id: 'photo',
    category: 'personal',
    question: 'How do I change my photo or name?',
    answer: 'Open your profile (Settings on web, More on the phone), choose Edit and save.',
    featureId: 'profile',
  },
  {
    id: 'dnd',
    category: 'personal',
    question: 'How do I stop notifications after work?',
    answer: 'Set quiet hours under Status and quiet hours. Notifications pause on that schedule.',
    featureId: 'presence',
  },
  {
    id: 'theme',
    category: 'personal',
    question: 'Can I use a dark or light theme?',
    answer:
      'Yes. Choose one under Appearance. You can also pick a chat theme or your own background picture for conversations.',
    featureId: 'appearance',
  },
  {
    id: 'lost-phone',
    category: 'personal',
    question: 'I lost my phone. What should I do?',
    answer:
      'Sign out of it from Devices on another device, or ask an admin to do it from Administration > Devices.',
    featureId: 'devices',
  },
  {
    id: 'password',
    category: 'personal',
    question: 'How do I change my password or turn on two-step sign-in?',
    answer:
      'Open Settings (More > Password on the phone). Two-step sign-in is in Settings on the web.',
  },

  // Admins
  {
    id: 'invite-members',
    category: 'admin',
    question: 'How do I add people to our workspace?',
    answer: 'Open Administration > Members and choose Invite or Add member. Pick their role.',
    featureId: 'admin',
    adminOnly: true,
  },
  {
    id: 'roles',
    category: 'admin',
    question: 'What can each role do?',
    answer:
      'Owners and admins manage members, settings and integrations. Members use the workspace. Guests only see the conversations they are invited to.',
    featureId: 'admin',
    adminOnly: true,
  },
  {
    id: 'integrations-setup',
    category: 'admin',
    question: 'Where do we set up email, storage, AI and push?',
    answer:
      'In Integrations. Settings are stored encrypted, and each service has a Test connection button.',
    featureId: 'integrations',
    adminOnly: true,
  },
  {
    id: 'brand',
    category: 'admin',
    question: 'Can we use our own logo and colors?',
    answer: 'Yes. Open Branding to set your name, logo, colors and sign-in page text.',
    featureId: 'branding',
    adminOnly: true,
  },
  {
    id: 'answer-queries',
    category: 'admin',
    question: 'Where do I answer questions from my team?',
    answer:
      'Help > Team questions (Administration > Help questions on the phone). Reply, set a status, or pass a question on to SampConnect support.',
    adminOnly: true,
  },

  // Help itself
  {
    id: 'not-answered',
    category: 'basics',
    question: 'My question is not answered here. What now?',
    answer:
      'Open Help > Ask a question. Choose your organization’s admins or SampConnect support, write your question and send it. You can follow the replies under My questions, and you are notified when someone answers.',
  },
];

/** Case-insensitive search over questions and answers, questions first. */
export function searchFaqs(query: string, faqs: readonly HelpFaq[] = HELP_FAQS): HelpFaq[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...faqs];
  const terms = q.split(/\s+/);
  const scored: { f: HelpFaq; score: number }[] = [];
  for (const f of faqs) {
    const question = f.question.toLowerCase();
    const answer = f.answer.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (question.includes(t)) score += 3;
      else if (answer.includes(t)) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (score > 0) scored.push({ f, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.f);
}
