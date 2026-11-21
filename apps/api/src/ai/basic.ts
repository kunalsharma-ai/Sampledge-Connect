import type {
  AiEngineImpl,
  Member,
  RawActionItem,
  SummarizeInput,
  SummaryResult,
  TranscriptLine,
} from './engine.js';

/**
 * Built-in engine: no model, no network. Extractive summaries (sentence scoring), keyword
 * action items, decisions and open questions, and lexical "semantic" vectors (feature-hashed
 * stems and bigrams). Good enough to be useful and honest about its limits; a model server
 * gives better results through the same interface.
 */

const STOP = new Set(
  `a an and are as at be been but by can could did do does for from had has have hey hi i if in into is it its just let like me my no not of ok okay on or our please so that the their them then there these they this to too up us was we were what when where which who will with would yes you your i'm it's we're that's don't can't i'll we'll you're thanks thank`.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  return (
    plain(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? []
  ).filter((t) => t.length > 1 || /\d/.test(t));
}

/** Very small suffix stemmer so "pricing"/"priced"/"prices" land together. */
export function stem(t: string): string {
  if (t.length <= 4) return t;
  for (const suf of ['ations', 'ation', 'ings', 'ing', 'ies', 'ied', 'es', 'ed', 'ly', 's']) {
    if (t.endsWith(suf) && t.length - suf.length >= 3) {
      const base = t.slice(0, -suf.length);
      return suf === 'ies' || suf === 'ied' ? `${base}y` : base;
    }
  }
  return t;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const HASH_DIMS = 512;
export const BASIC_EMBEDDING_ID = `basic-hash-${HASH_DIMS}`;

/** L2-normalized hashed bag of stems + bigrams + character trigrams (typo tolerance). */
export function hashEmbed(text: string): number[] {
  const v = new Array<number>(HASH_DIMS).fill(0);
  const add = (feature: string, w: number) => {
    const h = fnv1a(feature);
    v[h % HASH_DIMS]! += (h & 0x80000000 ? -1 : 1) * w;
  };
  const stems = tokenize(text)
    .filter((t) => !STOP.has(t))
    .map(stem);
  stems.forEach((s, i) => {
    add(`u:${s}`, 1);
    if (i > 0) add(`b:${stems[i - 1]}_${s}`, 0.5);
    if (s.length >= 5) for (let j = 0; j + 3 <= s.length; j++) add(`c:${s.slice(j, j + 3)}`, 0.15);
  });
  const norm = Math.hypot(...v);
  return norm ? v.map((x) => x / norm) : v;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Curly quotes to straight, so "I’ll" matches the same patterns as "I'll". */
export const plain = (text: string) => text.replace(/[\u2018\u2019\u02BC]/g, "'");

export function sentences(text: string): string[] {
  return plain(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}@"“(])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

const ACTION_RE =
  /\b(can you|could you|would you|will you|please|pls|need(?:s)? to|have to|must|i'?ll|i will|we'?ll|we will|let'?s|todo|to-do|action item|follow[- ]up|make sure|remember to|assign(?:ed)? to|take care of|send (?:over|across|out)?|share|review|prepare|update|finalis|finaliz|schedule)\b/i;
const DECISION_RE =
  /\b(decided|decision|agreed|agree to|let'?s go with|we'?ll go with|going with|approved|signed off|final(?:ised|ized)?|confirmed|settled on)\b/i;
const DUE_RE =
  /\b((?:by|before|on|until|due)\s+(?:(?:next|this)\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:by|before)\s+(?:eod|eow|end of (?:the )?(?:day|week|month)|tomorrow|tonight|noon|\d{1,2}(?::\d{2})?\s?(?:am|pm)?)|tomorrow|today|tonight|this week|next week|eod|asap|(?:by|on|before)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)?)\b/i;

function firstName(name: string) {
  return name.split(/\s+/)[0] ?? name;
}

/** The member a sentence is addressed to or claimed by. */
function findAssignee(sentence: string, line: TranscriptLine, members: Member[]): string | null {
  if (/\b(i'?ll|i will|i can|i'm on it|on it)\b/i.test(sentence)) return line.senderName;
  const lower = sentence.toLowerCase();
  for (const m of members) {
    if (m.userId === line.senderId) continue;
    const full = m.name.toLowerCase();
    const first = firstName(m.name).toLowerCase();
    if (lower.includes(`@${full}`) || lower.includes(full)) return m.name;
    if (
      first.length >= 3 &&
      new RegExp(`(^|[^\\p{L}])@?${escape(first)}([^\\p{L}]|$)`, 'iu').test(sentence)
    )
      return m.name;
  }
  return null;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function clip(s: string, n = 220) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

export function basicSummarize(input: SummarizeInput): SummaryResult {
  const lines = input.lines.filter((l) => l.text.trim());
  if (!lines.length)
    return {
      summary: input.agenda?.trim()
        ? `No messages yet. Agenda: ${clip(input.agenda.trim(), 300)}`
        : 'Nothing to summarize yet.',
      highlights: [],
      decisions: [],
      actionItems: [],
      openQuestions: [],
    };

  // Term frequency over the whole range, then score each sentence.
  const tf = new Map<string, number>();
  for (const l of lines)
    for (const t of tokenize(l.text)) if (!STOP.has(t)) tf.set(stem(t), (tf.get(stem(t)) ?? 0) + 1);
  if (input.agenda)
    for (const t of tokenize(input.agenda))
      if (!STOP.has(t)) tf.set(stem(t), (tf.get(stem(t)) ?? 0) + 2);

  type Scored = { s: string; line: TranscriptLine; score: number; idx: number };
  const all: Scored[] = [];
  lines.forEach((line, li) => {
    for (const s of sentences(line.text)) {
      const toks = tokenize(s).filter((t) => !STOP.has(t));
      if (toks.length < 3) continue;
      const base =
        toks.reduce((a, t) => a + Math.log1p(tf.get(stem(t)) ?? 0), 0) / Math.sqrt(toks.length);
      const bonus =
        (DECISION_RE.test(s) ? 1.5 : 0) + (ACTION_RE.test(s) ? 0.5 : 0) + (/\d/.test(s) ? 0.3 : 0);
      all.push({ s, line, score: base + bonus, idx: li });
    }
  });

  const decisions: string[] = [];
  const actionItems: RawActionItem[] = [];
  const seenAction = new Set<string>();
  lines.forEach((line) => {
    for (const s of sentences(line.text)) {
      if (DECISION_RE.test(s) && decisions.length < 5)
        decisions.push(clip(`${firstName(line.senderName)}: ${s}`));
      const isQuestionAsk =
        /\?$/.test(s) && /\b(can|could|would|will) (you|someone|anyone)\b/i.test(s);
      if ((ACTION_RE.test(s) && !/\?$/.test(s)) || isQuestionAsk) {
        const key = s.toLowerCase();
        if (seenAction.has(key) || actionItems.length >= 8) continue;
        if (tokenize(s).filter((t) => !STOP.has(t)).length < 2) continue;
        seenAction.add(key);
        actionItems.push({
          text: clip(s.replace(/^(ok(ay)?|sure|great|thanks)[,!.]?\s*/i, ''), 200),
          assignee: findAssignee(s, line, input.members),
          due: s.match(DUE_RE)?.[0] ?? null,
          messageId: line.messageId,
        });
      }
    }
  });

  // A question is open when nobody else wrote after it.
  const openQuestions: string[] = [];
  lines.forEach((line, i) => {
    const q = sentences(line.text).filter((s) => s.endsWith('?'));
    if (!q.length) return;
    const answered = lines.slice(i + 1).some((l) => l.senderId !== line.senderId);
    if (!answered && openQuestions.length < 3)
      openQuestions.push(clip(`${firstName(line.senderName)}: ${q.at(-1)!}`));
  });

  const top = [...all]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => a.idx - b.idx);
  const highlights = top.map((t) => clip(`${firstName(t.line.senderName)}: ${t.s}`));

  const people = [...new Map(lines.map((l) => [l.senderId, l.senderName])).values()];
  // Topics are words, not people: leave out members' names.
  const nameParts = new Set(
    [...input.members.map((m) => m.name), ...people].flatMap((n) => tokenize(n).map(stem)),
  );
  const topics = [...tf.entries()]
    .filter(([t]) => t.length > 3 && !/^\d+$/.test(t) && !nameParts.has(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);
  const parts = [
    `${lines.length} message${lines.length === 1 ? '' : 's'} from ${listNames(people)}${topics.length ? `, mostly about ${listNames(topics)}` : ''}.`,
  ];
  if (decisions.length)
    parts.push(`${decisions.length} decision${decisions.length === 1 ? '' : 's'} made.`);
  if (actionItems.length)
    parts.push(`${actionItems.length} possible action item${actionItems.length === 1 ? '' : 's'}.`);
  if (openQuestions.length)
    parts.push(
      `${openQuestions.length} question${openQuestions.length === 1 ? '' : 's'} still open.`,
    );

  return { summary: parts.join(' '), highlights, decisions, actionItems, openQuestions };
}

export function basicReplies(lines: TranscriptLine[], meId: string): string[] {
  const last = [...lines].reverse().find((l) => l.senderId !== meId && l.text.trim());
  if (!last) return [];
  const t = plain(last.text.trim());
  if (/\b(thank|thanks|thx|appreciate)\b/i.test(t))
    return ['You’re welcome!', 'Happy to help.', 'Anytime, let me know if you need more.'];
  if (/\b(can|could|would|will) you\b|\bplease\b/i.test(t))
    return [
      'On it, I’ll take care of it.',
      'Sure. When do you need it by?',
      'I can’t take this one today. Can someone else pick it up?',
    ];
  if (t.endsWith('?'))
    return [
      'Yes, that works for me.',
      'Let me check and get back to you.',
      'Can we talk it through on a quick call?',
    ];
  if (/\b(done|shipped|sent|finished|completed|live|merged)\b/i.test(t))
    return ['Great work, thank you!', 'Nice. Anything you need from me?', 'Thanks for the update.'];
  return ['Thanks, noted.', 'Sounds good 👍', 'Could you share a bit more detail?'];
}

export class BasicEngine implements AiEngineImpl {
  readonly kind = 'basic' as const;
  readonly chatModel = null;
  readonly embeddingModelId = BASIC_EMBEDDING_ID;

  async summarize(input: SummarizeInput) {
    return basicSummarize(input);
  }
  async embed(texts: string[]) {
    return texts.map(hashEmbed);
  }
  async answer(input: {
    question: string;
    sources: (TranscriptLine & { where: string })[];
  }): Promise<string> {
    if (!input.sources.length)
      return 'I couldn’t find anything about that in the conversations you can read.';
    const lines = input.sources
      .slice(0, 5)
      .map(
        (s) =>
          `• ${firstName(s.senderName)} in ${s.where} (${s.at.toLocaleDateString('en', { month: 'short', day: 'numeric' })}): “${clip(s.text, 180)}”`,
      );
    return `These are the most relevant messages I found in conversations you can read:\n${lines.join('\n')}\n\nConnect a model server in Administration > Integrations for written answers.`;
  }
  async translate() {
    return null;
  }
  async suggestReplies(input: { lines: TranscriptLine[]; meId: string; meName: string }) {
    return basicReplies(input.lines, input.meId);
  }
}
