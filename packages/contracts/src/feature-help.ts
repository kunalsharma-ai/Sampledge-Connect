/**
 * Feature help: the short guides behind the gold "i" next to each feature, on web and mobile.
 *
 * One source for both apps, so a person reads the same explanation wherever they are. Each guide
 * answers four questions in plain words: what it is, why it helps, where to find it, and how to
 * use it. Keep entries short (a guide is read in a popover or a bottom sheet) and honest: only
 * describe what is built. Admin-only features say so, so members are not told about controls they
 * cannot see.
 */

export const FEATURE_HELP_CATEGORIES = [
  'basics',
  'messaging',
  'meetings',
  'work',
  'clients',
  'discover',
  'network',
  'personal',
  'admin',
] as const;
export type FeatureHelpCategory = (typeof FEATURE_HELP_CATEGORIES)[number];

export const FEATURE_HELP_CATEGORY_LABELS: Record<FeatureHelpCategory, string> = {
  basics: 'Getting around',
  messaging: 'Messaging',
  meetings: 'Calls and meetings',
  work: 'Work and projects',
  clients: 'Clients',
  discover: 'Find and understand',
  network: 'SampConnect Network',
  personal: 'Make it yours',
  admin: 'For admins',
};

/** Who can use a feature. Guides for admins are still readable by everyone, but say so. */
export type FeatureHelpAudience = 'everyone' | 'admins' | 'platform';

export interface FeatureHelpEntry {
  id: string;
  title: string;
  category: FeatureHelpCategory;
  audience: FeatureHelpAudience;
  /** One line, shown under the title and in the guide list. */
  summary: string;
  /** What it is. */
  what: string;
  /** Why it helps. */
  why: string;
  /** Where to find it, on each app. */
  where: { web: string; mobile: string };
  /** How to use it: two to five short steps. */
  how: string[];
  /** Optional extra hints. */
  tips?: string[];
  /** Other guides worth reading next (ids). */
  related?: string[];
}

export const FEATURE_HELP = [
  // ── Getting around ────────────────────────────────────────────────────────────────────────
  {
    id: 'home',
    title: 'Home',
    category: 'basics',
    audience: 'everyone',
    summary: 'Your day at a glance: what needs you, what is next, and what changed.',
    what: 'A personal start page that gathers unread conversations, mentions, your next meetings, tasks that are due and approvals waiting on you.',
    why: 'You can see what matters in seconds without opening every conversation, so nothing important slips past.',
    where: { web: 'Home, at the top of the left navigation.', mobile: 'The Home tab.' },
    how: [
      'Open Home when you start your day.',
      'Tap any card to jump straight to that conversation, meeting or task.',
      'Use the quick actions to start a conversation, schedule a meeting or add a task.',
    ],
    related: ['notifications', 'tasks', 'meetings'],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    category: 'basics',
    audience: 'everyone',
    summary: 'Mentions, replies, reactions and invites in one place.',
    what: 'A feed of everything that was addressed to you: mentions, thread replies, reactions, meeting invites, tasks and approvals.',
    why: 'You never have to hunt for the message that needed you. Reading one here marks it read on all your devices.',
    where: { web: 'Notifications in the left navigation.', mobile: 'The Activity tab.' },
    how: [
      'Open the feed to see new items, grouped by day.',
      'Tap an item to open the exact message.',
      'Use Mark all read once you have caught up.',
    ],
    tips: [
      'Choose how loudly each conversation notifies you from its menu: all, mentions only or muted.',
    ],
    related: ['quiet-hours', 'home'],
  },
  {
    id: 'sync',
    title: 'Offline and sync',
    category: 'basics',
    audience: 'everyone',
    summary: 'Keep working without a connection. Everything catches up on its own.',
    what: 'Every action you take is saved on your device first and sent as soon as you are online, then kept in step on all your devices.',
    why: 'A weak connection never loses a message or a change, and what you do on your phone shows up on your laptop straight away.',
    where: {
      web: 'The connection dot at the top of a conversation opens the Sync Center.',
      mobile: 'The banner at the top of the screen, and More > Offline & storage.',
    },
    how: [
      'Keep working as normal when you go offline. Items show as queued.',
      'When the connection returns, queued items send in order by themselves.',
      'Open the Sync Center to see what is waiting or retry anything that failed.',
    ],
    related: ['messages'],
  },

  // ── Messaging ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'messages',
    title: 'Messages',
    category: 'messaging',
    audience: 'everyone',
    summary: 'Direct messages and group chats with your colleagues.',
    what: 'One-to-one and group conversations with rich text, files, voice notes, reactions, replies, read receipts and typing indicators.',
    why: 'Quick conversations stay in one secure place your organization controls, instead of scattered across personal apps.',
    where: { web: 'Messages in the left navigation.', mobile: 'The Messages tab.' },
    how: [
      'Start a new conversation with the pencil or New button and pick people.',
      'Type in the box at the bottom and press Enter (or the send button).',
      'Hover or long-press a message to react, reply in a thread, forward, pin, save, edit or delete it.',
    ],
    tips: [
      'Type @ to mention someone so they are notified.',
      'You can edit or delete your own messages after sending. Everyone sees the update.',
    ],
    related: ['threads', 'files', 'forwarding', 'scheduled-messages'],
  },
  {
    id: 'channels',
    title: 'Teams & Channels',
    category: 'messaging',
    audience: 'everyone',
    summary: 'Topic rooms that the whole team can join and follow.',
    what: 'Public and private channels for a team, topic or client, plus announcement channels where only chosen people can post.',
    why: 'Discussions are organized by subject, new joiners can read the history, and everyone sees the same decisions.',
    where: { web: 'Teams & Channels in the left navigation.', mobile: 'More > Teams & Channels.' },
    how: [
      'Browse channels and select Join on the ones you need.',
      'Create a channel with New, give it a name and topic, and choose public or private.',
      'Open the channel details to add people, change the topic or adjust notifications.',
    ],
    related: ['messages', 'threads', 'polls'],
  },
  {
    id: 'threads',
    title: 'Threads, pins and saved',
    category: 'messaging',
    audience: 'everyone',
    summary:
      'Reply to one message without crowding the conversation, and keep the important ones handy.',
    what: 'Threads hold replies to a single message. Pins keep key messages at the top of a conversation for everyone. Saved keeps a private list just for you.',
    why: 'Busy channels stay readable, important decisions are easy to find again, and you can come back to things later.',
    where: {
      web: 'Message menu > Reply in thread, Pin or Save. Your saved list is under Saved in the navigation.',
      mobile: 'Long-press a message. Saved is under More > Saved.',
    },
    how: [
      'Choose Reply in thread on a message to open its thread.',
      'Pin a message so it shows in the conversation’s pinned list.',
      'Save a message to read it later from Saved.',
    ],
    related: ['messages'],
  },
  {
    id: 'files',
    title: 'Files',
    category: 'messaging',
    audience: 'everyone',
    summary: 'Every file shared with you, searchable in one place.',
    what: 'A library of all images, documents, voice notes and videos shared in your conversations, with previews and filters.',
    why: 'You can find that spreadsheet from last week without scrolling through chats.',
    where: { web: 'Files in the left navigation.', mobile: 'More > Files.' },
    how: [
      'Attach a file in any conversation with the paperclip, or drag and drop on web.',
      'Open Files to browse everything, and filter by type, person or conversation.',
      'Select a file to preview, download or jump to the message it came from.',
    ],
    related: ['search', 'messages'],
  },
  {
    id: 'forwarding',
    title: 'Forwarding',
    category: 'messaging',
    audience: 'everyone',
    summary: 'Send a message on to another person or channel.',
    what: 'Copies a message, with its attachments, into another conversation and notes where it came from.',
    why: 'Share information with the right people without retyping it or taking screenshots.',
    where: { web: 'Message menu > Forward.', mobile: 'Long-press a message > Forward.' },
    how: [
      'Open the message menu and choose Forward.',
      'Pick one or more conversations and add a note if you like.',
      'Send. The forwarded message shows who originally wrote it.',
    ],
    related: ['messages'],
  },
  {
    id: 'scheduled-messages',
    title: 'Scheduled messages',
    category: 'messaging',
    audience: 'everyone',
    summary: 'Write now, send later at the right time.',
    what: 'Pick a date and time and the server sends your message then, even if your device is off.',
    why: 'Respect colleagues’ hours in other time zones and send reminders exactly when they are needed.',
    where: {
      web: 'The clock button next to Send in the message box.',
      mobile: 'Long-press the send button. Manage them under More > Scheduled messages.',
    },
    how: [
      'Write your message as usual (text only for now).',
      'Choose Schedule send and pick a date and time. This needs a connection.',
      'Edit, send now or cancel it from the scheduled list until it goes out.',
    ],
    related: ['messages', 'working-hours'],
  },
  {
    id: 'polls',
    title: 'Polls',
    category: 'messaging',
    audience: 'everyone',
    summary: 'Ask a quick question and see the answers live.',
    what: 'A message with options people vote on, with live results, optional anonymous voting and a closing time.',
    why: 'Reach a decision in minutes instead of a long back-and-forth.',
    where: {
      web: 'The plus menu in the message box > Poll.',
      mobile: 'The plus button in the message box > Poll.',
    },
    how: [
      'Choose Poll and write your question.',
      'Add the options, and choose whether people can pick more than one.',
      'Post it. Results update for everyone as votes come in.',
    ],
    related: ['channels'],
  },
  {
    id: 'greeting-cards',
    title: 'Greeting cards',
    category: 'messaging',
    audience: 'everyone',
    summary: 'Send a beautiful card for a festival or special moment.',
    what: 'Ready-made cards for 59 occasions, from Diwali, Holi, Eid and Onam to birthdays, promotions, farewells and get-well wishes, in five styles with heartfelt messages you can edit.',
    why: 'Show people you care in a few seconds, with words that feel personal and a card that looks lovely on every device.',
    where: {
      web: 'The gift button in the message box.',
      mobile: 'The plus button in the message box > Greeting card.',
    },
    how: [
      'Pick an occasion. Coming up shows the festivals of this month and next, or search by name.',
      'Choose a style and one of the messages: warm, for colleagues and clients, playful or poetic.',
      'Edit the headline, who it is for and the words as you like. The preview updates as you type.',
      'Send it. It works offline too and sends when you reconnect.',
    ],
    tips: [
      'Surprise me picks a different message and style.',
      'Admins can turn greeting cards off or hide categories in Administration > Greeting cards.',
    ],
    related: ['polls', 'messages'],
  },
  {
    id: 'chat-themes',
    title: 'Chat themes',
    category: 'personal',
    audience: 'everyone',
    summary: 'Change how your conversations look, on every device.',
    what: 'Twenty looks for the conversation background and your message bubbles, from calm classics to patterns and colors.',
    why: 'Make long reading easier on your eyes, or simply make the app feel like yours.',
    where: { web: 'Settings > Chat theme.', mobile: 'More > Chat theme.' },
    how: [
      'Open Chat theme and browse the categories.',
      'Select a theme to preview it, then apply it.',
      'Your choice follows you to all your devices.',
    ],
    tips: ['Your organization may set a default or limit the choices.'],
    related: ['chat-background', 'appearance'],
  },
  {
    id: 'chat-background',
    title: 'Chat background picture',
    category: 'personal',
    audience: 'everyone',
    summary: 'Use your own photo behind your conversations.',
    what: 'Pick a picture, crop it and adjust blur, brightness and color so messages stay easy to read.',
    why: 'A personal touch without affecting what anyone else sees.',
    where: {
      web: 'Settings > Chat theme > Your own picture.',
      mobile: 'Open a conversation > Details > Chat background.',
    },
    how: [
      'Choose a photo from your device.',
      'Use the editor to crop and soften it.',
      'Save. The picture stays on this device only.',
    ],
    related: ['chat-themes'],
  },

  // ── Calls and meetings ────────────────────────────────────────────────────────────────────
  {
    id: 'calls',
    title: 'Voice and video calls',
    category: 'meetings',
    audience: 'everyone',
    summary: 'Call anyone, or a whole channel, with one click.',
    what: 'Secure audio and video calls hosted on your organization’s own call server, with screen sharing, chat, reactions and raised hands.',
    why: 'Move from typing to talking instantly, without another app or outside service.',
    where: {
      web: 'The phone and camera buttons at the top of any conversation.',
      mobile: 'The phone and camera buttons at the top of a conversation.',
    },
    how: [
      'Open a conversation and press the call or video button.',
      'Use the bar at the bottom to mute, turn your camera on or off, share your screen or open chat.',
      'Press the red button to leave.',
    ],
    tips: [
      'Calls continue if you switch to another device: join again and you pick up where you were.',
    ],
    related: ['call-background', 'meetings', 'recordings'],
  },
  {
    id: 'call-background',
    title: 'Call backgrounds and appearance',
    category: 'meetings',
    audience: 'everyone',
    summary: 'Blur your room, use a photo, and look your best on camera.',
    what: 'Background blur, professional photo backgrounds, your own picture, and touch-ups such as lighting and soft focus.',
    why: 'Join calls from anywhere and keep the focus on you, not your surroundings.',
    where: {
      web: 'Before or during a call: Settings (gear) > Background or Appearance.',
      mobile: 'More > Call background, or the effects button during a call.',
    },
    how: [
      'Open Call background and preview your camera.',
      'Pick blur, a photo or upload your own.',
      'Adjust appearance if you like. Your choice is used for every call.',
    ],
    related: ['calls'],
  },
  {
    id: 'meetings',
    title: 'Meetings',
    category: 'meetings',
    audience: 'everyone',
    summary: 'Schedule calls, invite anyone, and keep everything in one place.',
    what: 'Scheduled meetings with agendas, repeats, reminders, RSVPs and invitations for people outside your organization.',
    why: 'Everyone knows when to meet and what it is about, and the meeting chat, recording and minutes stay together.',
    where: { web: 'Meetings in the left navigation.', mobile: 'More > Meetings.' },
    how: [
      'Select New meeting, add a title, time and people.',
      'Add guests by email if they are outside your organization. They get a join link.',
      'Join from the meeting card when it starts. You get a reminder beforehand.',
    ],
    tips: ['Set a repeat for weekly stand-ups so you only create it once.'],
    related: ['booking-pages', 'minutes', 'recordings', 'working-hours'],
  },
  {
    id: 'booking-pages',
    title: 'Booking pages',
    category: 'meetings',
    audience: 'everyone',
    summary: 'Let others book time with you from a link.',
    what: 'A public page that shows your free slots, based on your working hours and calendar, so people can pick a time themselves.',
    why: 'No more back-and-forth emails to find a time that works.',
    where: {
      web: 'Meetings > Booking pages.',
      mobile: 'More > Meetings > Booking pages.',
    },
    how: [
      'Create a booking page, give it a name and meeting length.',
      'Choose which days and times are bookable.',
      'Share the link. Bookings appear in your Meetings with a join link.',
    ],
    related: ['meetings', 'working-hours'],
  },
  {
    id: 'recordings',
    title: 'Recordings',
    category: 'meetings',
    audience: 'everyone',
    summary: 'Replay calls and meetings whenever you need.',
    what: 'Recorded calls with playback, transcripts and download. Owners can delete them, and admins can set automatic clean-up.',
    why: 'People who missed the meeting can catch up, and nothing said is lost.',
    where: { web: 'Recordings in the left navigation.', mobile: 'More > Recordings.' },
    how: [
      'Start recording from the call controls. Everyone sees that the call is recorded.',
      'After the call, open Recordings to play, download or share it.',
      'Delete recordings you no longer need.',
    ],
    related: ['minutes', 'calls'],
  },
  {
    id: 'minutes',
    title: 'Minutes of meetings',
    category: 'meetings',
    audience: 'everyone',
    summary: 'Clear notes, decisions and actions after every meeting.',
    what: 'Minutes drafted from the call transcript, with decisions and action items you can review, edit and share.',
    why: 'Everyone leaves with the same record and knows who does what next.',
    where: {
      web: 'Open an ended meeting or recording > Minutes.',
      mobile: 'More > Meetings > Minutes of meetings.',
    },
    how: [
      'Open the minutes for an ended call.',
      'Review and edit the summary, decisions and action items.',
      'Share them to the conversation, or turn actions into tasks.',
    ],
    related: ['recordings', 'tasks', 'ai'],
  },

  // ── Work and projects ─────────────────────────────────────────────────────────────────────
  {
    id: 'tasks',
    title: 'Tasks & Approvals',
    category: 'work',
    audience: 'everyone',
    summary: 'Turn conversations into work with owners and due dates.',
    what: 'Tasks you can assign, date and tick off, and approval requests that someone accepts or declines with a comment.',
    why: 'Requests made in chat do not get forgotten, and approvals leave a clear record.',
    where: {
      web: 'Tasks & Approvals in the left navigation.',
      mobile: 'More > Tasks & Approvals.',
    },
    how: [
      'Select New task, or turn any message into a task from its menu.',
      'Pick an owner and due date. They are notified.',
      'For sign-offs, choose Request approval and pick who decides.',
    ],
    related: ['projects', 'home'],
  },
  {
    id: 'projects',
    title: 'Projects',
    category: 'work',
    audience: 'everyone',
    summary: 'Group the people, conversations and tasks of one piece of work.',
    what: 'A shared space per project with its members, linked conversations, tasks, files and progress.',
    why: 'Everyone on a project sees the same status and finds what they need in one place.',
    where: {
      web: 'Projects in the left navigation.',
      mobile: 'Not on the phone app yet. Use the web app.',
    },
    how: [
      'Create a project and add members.',
      'Link the conversations and tasks that belong to it.',
      'Check the project page to see progress and what is overdue.',
    ],
    related: ['tasks', 'channels'],
  },
  {
    id: 'sampledge-modules',
    title: 'Sampledge modules',
    category: 'work',
    audience: 'everyone',
    summary: 'Work on Sampledge studies and records right inside the chat.',
    what: 'Cards from connected Sampledge modules that show live records in conversations and let you act on them.',
    why: 'Discuss a study or job and update it without switching apps.',
    where: {
      web: 'Shared cards in conversations, and the module panel beside a conversation.',
      mobile: 'Shared cards in conversations.',
    },
    how: [
      'Share a record from a connected module into a conversation.',
      'Open the card to see its latest details.',
      'Use the card’s actions to update it. Everyone sees the change.',
    ],
    related: ['integrations'],
  },

  // ── Clients ───────────────────────────────────────────────────────────────────────────────
  {
    id: 'client-inbox',
    title: 'Client Inbox',
    category: 'clients',
    audience: 'everyone',
    summary: 'Every client conversation, from every channel, in one shared inbox.',
    what: 'One inbox for client messages from email, WhatsApp, web chat and more, with assignment, notes, templates and response targets.',
    why: 'Clients get fast, consistent answers, and no message falls between team members.',
    where: { web: 'Client Inbox in the left navigation.', mobile: 'The Inbox tab.' },
    how: [
      'Open the inbox and pick a conversation.',
      'Assign it to yourself or a teammate, and reply from the box at the bottom.',
      'Add internal notes your client cannot see, then mark it resolved.',
    ],
    tips: ['Use saved templates for answers you send often.'],
    related: ['inbox-dashboard', 'inbox-channels'],
  },
  {
    id: 'inbox-dashboard',
    title: 'Supervisor dashboard',
    category: 'clients',
    audience: 'admins',
    summary: 'See workload and response times across the team.',
    what: 'Live counts of open, waiting and overdue client conversations, by person and team, against your service levels.',
    why: 'Spot overloaded people and late replies early, and balance the work.',
    where: { web: 'Client Inbox > Dashboard.', mobile: 'Inbox > Dashboard.' },
    how: [
      'Open the dashboard to see the current queue.',
      'Select a person or team to see their conversations.',
      'Reassign conversations to even out the load.',
    ],
    related: ['client-inbox'],
  },
  {
    id: 'inbox-channels',
    title: 'Client messaging channels',
    category: 'clients',
    audience: 'admins',
    summary: 'Connect email, WhatsApp, web chat and other channels to the inbox.',
    what: 'The places clients can reach you. Messages from each connected channel arrive in the Client Inbox.',
    why: 'Clients use the channel they prefer, and your team answers from one place.',
    where: { web: 'Client Inbox > Channels.', mobile: 'Inbox > Channels.' },
    how: [
      'Select Add channel and choose the type.',
      'Enter the connection details and test the connection.',
      'Choose which team receives its messages.',
    ],
    related: ['client-inbox', 'integrations'],
  },

  // ── Find and understand ───────────────────────────────────────────────────────────────────
  {
    id: 'search',
    title: 'Universal Search',
    category: 'discover',
    audience: 'everyone',
    summary: 'Find any message, file, person, task or meeting.',
    what: 'One search across everything you can see, with filters for person, conversation, date and type.',
    why: 'Find the answer in seconds instead of asking again.',
    where: {
      web: 'Universal Search in the navigation, or press Ctrl+Shift+F (Cmd+Shift+F on Mac). Ctrl+K opens the command palette.',
      mobile: 'The search button at the top of Home or Messages.',
    },
    how: [
      'Type what you remember, a word, a name or a file name.',
      'Narrow it down with the filters.',
      'Select a result to jump straight to it.',
    ],
    related: ['files', 'ai'],
  },
  {
    id: 'ai',
    title: 'AI Assistant',
    category: 'discover',
    audience: 'everyone',
    summary: 'Ask questions about your work and get catch-up summaries.',
    what: 'A private assistant that answers from the conversations and files you can access, summarizes what you missed and drafts replies.',
    why: 'Catch up on a busy channel in seconds and get help writing, without your data leaving your organization’s control.',
    where: {
      web: 'AI Assistant in the navigation, and Catch me up at the top of a conversation.',
      mobile: 'More > AI Assistant.',
    },
    how: [
      'Ask a question in plain words, such as “What was decided about the Q4 tracker?”.',
      'Open a busy conversation and choose Catch me up for a summary.',
      'Use a suggested reply, then edit it before sending.',
    ],
    tips: ['The assistant only sees what you are allowed to see.'],
    related: ['search', 'minutes'],
  },
  {
    id: 'analytics',
    title: 'Analytics',
    category: 'discover',
    audience: 'everyone',
    summary: 'See how and when your team communicates.',
    what: 'Charts of message activity, busiest conversations and times, and response patterns, for you or the whole organization.',
    why: 'Understand workload and plan better, for example by choosing the best time for announcements.',
    where: {
      web: 'Analytics in the left navigation.',
      mobile: 'Not on the phone app yet. Use the web app.',
    },
    how: [
      'Open Analytics and choose a date range.',
      'Switch between your own view and the organization view (admins).',
      'Select a conversation or person in the charts to open it.',
    ],
    related: ['inbox-dashboard'],
  },

  // ── SampConnect Network ───────────────────────────────────────────────────────────────────
  {
    id: 'network',
    title: 'SampConnect Network',
    category: 'network',
    audience: 'everyone',
    summary: 'Connect with people in any organization.',
    what: 'A separate space, linked to your work account, for connections, messages, statuses and communities across organizations.',
    why: 'Keep in touch with clients, partners and peers outside your company while work chat stays private to your organization.',
    where: {
      web: 'The space switcher at the top of the navigation > SampConnect Network.',
      mobile: 'More > SampConnect Network.',
    },
    how: [
      'Switch to SampConnect Network the first time to set up your network profile.',
      'Find people by their Connect ID or name and send a connection request.',
      'Switch back to Work at any time. Nothing from work is shared.',
    ],
    related: ['network-people', 'communities', 'status-updates'],
  },
  {
    id: 'network-people',
    title: 'People and connections',
    category: 'network',
    audience: 'everyone',
    summary: 'Find people, connect, follow and invite.',
    what: 'Search by Connect ID or name, send and accept connection requests, follow people, and invite those not yet on SampConnect.',
    why: 'Build your professional network and message people only once they have agreed to connect.',
    where: { web: 'People in the Network navigation.', mobile: 'The People tab in Network.' },
    how: [
      'Search for a person and select Connect.',
      'Accept or decline requests under Requests.',
      'Invite someone by email if they are not on SampConnect yet.',
    ],
    tips: ['You can block or report anyone from their profile.'],
    related: ['network', 'communities'],
  },
  {
    id: 'communities',
    title: 'Communities',
    category: 'network',
    audience: 'everyone',
    summary: 'Groups around a shared interest, open to any organization.',
    what: 'Spaces with posts, replies and member groups, which you can join, follow or create yourself.',
    why: 'Share knowledge with peers across the industry and keep the discussion in one place.',
    where: {
      web: 'Communities in the Network navigation.',
      mobile: 'More > Communities in Network.',
    },
    how: [
      'Browse communities and select Join.',
      'Post an update or reply to others.',
      'Create your own community and invite members.',
    ],
    related: ['network', 'status-updates'],
  },
  {
    id: 'status-updates',
    title: 'Status updates',
    category: 'network',
    audience: 'everyone',
    summary: 'Share a short update your connections can see and reply to.',
    what: 'Text, photo or video updates that your connections see for 24 hours, with replies that arrive as private messages.',
    why: 'Stay visible and share news without starting a conversation with everyone.',
    where: {
      web: 'Network Home > Status.',
      mobile: 'Network Home > Post a status, or More > Post a status.',
    },
    how: [
      'Select New status and write or add a photo.',
      'Choose who can see it.',
      'Open a status from the row at the top to view it or reply.',
    ],
    related: ['network', 'presence'],
  },

  // ── Make it yours ─────────────────────────────────────────────────────────────────────────
  {
    id: 'profile',
    title: 'Profile and photo',
    category: 'personal',
    audience: 'everyone',
    summary: 'Your name, photo, title and contact details.',
    what: 'How colleagues see you: photo, display name, job title, department, phone and a short bio.',
    why: 'People recognize you instantly and know how to reach you.',
    where: {
      web: 'Settings > your profile card at the top.',
      mobile: 'More > your name at the top, or More > Profile and photo.',
    },
    how: [
      'Open your profile and select Edit.',
      'Change your photo, name or details.',
      'Save. The change shows everywhere straight away.',
    ],
    related: ['presence'],
  },
  {
    id: 'presence',
    title: 'Status and quiet hours',
    category: 'personal',
    audience: 'everyone',
    summary: 'Let people know if you are available, busy or away.',
    what: 'Your availability dot, a custom status with emoji and end time, and Do not disturb hours that silence notifications.',
    why: 'Colleagues know when to expect a reply, and you get uninterrupted focus time.',
    where: {
      web: 'Settings > Status and Quiet hours.',
      mobile: 'More > Status and quiet hours.',
    },
    how: [
      'Pick a status such as In a meeting or Focusing, or write your own.',
      'Choose when it clears.',
      'Set Do not disturb hours to pause notifications on a schedule.',
    ],
    related: ['working-hours', 'notifications'],
  },
  {
    id: 'quiet-hours',
    title: 'Notification settings',
    category: 'personal',
    audience: 'everyone',
    summary: 'Choose what notifies you, and how.',
    what: 'Settings for push, sound, email and per-conversation levels (all messages, mentions only or muted).',
    why: 'Get alerted for what matters and silence the rest.',
    where: {
      web: 'Settings > Notifications, and each conversation’s menu.',
      mobile: 'More > Notifications.',
    },
    how: [
      'Open Notifications and choose your defaults.',
      'For one conversation, open its menu and choose a notify level.',
      'Allow notifications on this device when asked.',
    ],
    related: ['notifications', 'presence'],
  },
  {
    id: 'working-hours',
    title: 'Working hours',
    category: 'personal',
    audience: 'everyone',
    summary: 'The hours you are usually available.',
    what: 'Your weekly working pattern and time zone, shown to colleagues and used by booking pages.',
    why: 'People see when you are likely to answer, and nobody books you outside your hours.',
    where: { web: 'Meetings > Working hours.', mobile: 'More > Working hours.' },
    how: [
      'Turn each day on or off and set its start and end times.',
      'Check your time zone.',
      'Save. Booking pages and your profile use it straight away.',
    ],
    related: ['booking-pages', 'presence'],
  },
  {
    id: 'appearance',
    title: 'Appearance',
    category: 'personal',
    audience: 'everyone',
    summary: 'Choose the app theme, dark or light.',
    what: 'App-wide themes such as Midnight Executive and Arctic Professional, plus text size and reduced motion.',
    why: 'Work comfortably in any light and match your preference.',
    where: { web: 'Settings > Appearance.', mobile: 'More > Appearance.' },
    how: [
      'Open Appearance.',
      'Pick a theme to apply it at once.',
      'Turn on reduced motion if you prefer.',
    ],
    related: ['chat-themes'],
  },
  {
    id: 'devices',
    title: 'Devices',
    category: 'personal',
    audience: 'everyone',
    summary: 'See where you are signed in, and sign out remotely.',
    what: 'A list of your signed-in browsers and phones with their last activity.',
    why: 'If a phone is lost or you used a shared computer, you can sign it out from anywhere.',
    where: {
      web: 'Administration > Devices (admins), or sign out from Settings.',
      mobile: 'More > Devices.',
    },
    how: [
      'Open Devices.',
      'Check the list for anything you do not recognize.',
      'Select Sign out on that device.',
    ],
    related: ['sync'],
  },

  // ── For admins ────────────────────────────────────────────────────────────────────────────
  {
    id: 'admin',
    title: 'Administration',
    category: 'admin',
    audience: 'admins',
    summary: 'Manage members, roles, devices and organization rules.',
    what: 'The control center for your organization: members and roles, invitations, devices, call settings, network rules and the audit log.',
    why: 'Keep the workspace secure and organized, and see who changed what.',
    where: { web: 'Administration in the left navigation.', mobile: 'More > Administration.' },
    how: [
      'Open Members to invite people, change roles or deactivate accounts.',
      'Use the other tabs for devices, calls and network rules.',
      'Check the audit log to review important changes.',
    ],
    related: ['integrations', 'branding', 'billing'],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    category: 'admin',
    audience: 'admins',
    summary: 'Connect email, storage, AI, push and other services.',
    what: 'Settings for outside services, stored encrypted in the database, each with a connection test.',
    why: 'Turn on features such as email invites, file storage and push without touching servers.',
    where: { web: 'Integrations in the left navigation.', mobile: 'More > Integrations.' },
    how: [
      'Pick a service and enter its details.',
      'Select Test connection to check it works.',
      'Save and switch it on.',
    ],
    tips: ['Secrets are never shown again after saving. Enter a new value to replace one.'],
    related: ['admin', 'inbox-channels'],
  },
  {
    id: 'branding',
    title: 'Branding',
    category: 'admin',
    audience: 'admins',
    summary: 'Your organization’s name, logo and colors across the app.',
    what: 'White-label settings: name, logo, brand colors, sign-in page text and support contact.',
    why: 'The app looks and feels like your company for every member and guest.',
    where: { web: 'Branding in the left navigation.', mobile: 'More > Administration > Branding.' },
    how: [
      'Upload your logo and set your name.',
      'Pick your brand colors and check the preview.',
      'Save. Everyone sees it on their next screen.',
    ],
    related: ['admin'],
  },
  {
    id: 'billing',
    title: 'Billing',
    category: 'admin',
    audience: 'admins',
    summary: 'Your plan, seats and invoices.',
    what: 'Your current plan, seat use, payment method and invoice history.',
    why: 'Know what you pay for and change plans when your team grows.',
    where: {
      web: 'Billing in the left navigation.',
      mobile: 'Not on the phone app yet. Use the web app.',
    },
    how: [
      'Open Billing to see your plan and seats.',
      'Choose Change plan to upgrade or downgrade.',
      'Download invoices from the history.',
    ],
    related: ['admin'],
  },
  {
    id: 'platform',
    title: 'Super admin console',
    category: 'admin',
    audience: 'platform',
    summary: 'Run the whole platform: every organization, plan and platform admin.',
    what: 'Platform-wide controls for organizations, plans, suspensions, platform admins and their permissions, with a full audit trail.',
    why: 'Operate SampConnect for all customers from one secure place.',
    where: { web: 'Super admin in the left navigation.', mobile: 'More > Super admin.' },
    how: [
      'Open Organizations to view, suspend or change an organization’s plan.',
      'Manage platform admins and what each may do under Permissions.',
      'Review activity and the audit log.',
    ],
    related: ['admin'],
  },
] as const satisfies readonly FeatureHelpEntry[];

export type FeatureHelpId = (typeof FEATURE_HELP)[number]['id'];

const BY_ID = new Map<string, FeatureHelpEntry>(FEATURE_HELP.map((e) => [e.id, e]));

/** The guide for a feature, or undefined for an unknown id. */
export function featureHelp(id: string): FeatureHelpEntry | undefined {
  return BY_ID.get(id);
}

export const FEATURE_HELP_AUDIENCE_LABELS: Record<FeatureHelpAudience, string | null> = {
  everyone: null,
  admins: 'For owners and admins',
  platform: 'For platform admins',
};

/** Case-insensitive search across titles, summaries and body text, best matches first. */
export function searchFeatureHelp(query: string): FeatureHelpEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...FEATURE_HELP];
  const terms = q.split(/\s+/);
  const scored: { e: FeatureHelpEntry; score: number }[] = [];
  for (const e of FEATURE_HELP as readonly FeatureHelpEntry[]) {
    const title = e.title.toLowerCase();
    const body = [e.summary, e.what, e.why, ...e.how, ...(e.tips ?? [])].join(' ').toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 3;
      else if (body.includes(t)) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (score > 0) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.e);
}
