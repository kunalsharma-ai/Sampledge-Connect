/**
 * Plain-text @mentions. The composer inserts "@Display Name" and records the user id;
 * the server stores the ids in content.mentions and the text stays readable everywhere.
 */
export interface MentionCandidate {
  userId: string;
  name: string;
}

export interface TextSegment {
  text: string;
  /** Set when this segment is an @mention of that user. */
  userId?: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Splits text into plain runs and "@Name" runs for the mentioned users. */
export function segmentMentions(
  text: string,
  mentioned: readonly MentionCandidate[],
): TextSegment[] {
  const named = mentioned
    .filter((m) => m.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  if (!named.length || !text.includes('@')) return [{ text }];
  const re = new RegExp(
    `@(${named.map((m) => escape(m.name)).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const user = named.find((m) => m.name === match[1]);
    out.push({ text: match[0], userId: user?.userId });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The partial name being typed after a trailing "@", or null when not mentioning. */
export function activeMentionQuery(text: string): string | null {
  const m = /(?:^|\s)@([^\s@]{0,30})$/u.exec(text);
  return m ? m[1]! : null;
}

/** Replaces the trailing "@query" with "@Name ". */
export function insertMention(text: string, name: string): string {
  return text.replace(/@([^\s@]{0,30})$/u, `@${name} `);
}

/** Candidates matching a partial query, by first or any word of their name. */
export function filterCandidates(
  query: string,
  candidates: readonly MentionCandidate[],
  limit = 5,
): MentionCandidate[] {
  const q = query.toLocaleLowerCase();
  return candidates
    .filter(
      (c) =>
        c.name
          .toLocaleLowerCase()
          .split(/\s+/)
          .some((w) => w.startsWith(q)) || c.name.toLocaleLowerCase().startsWith(q),
    )
    .slice(0, limit);
}

/** Ids of picked users whose "@Name" is still in the text (the user may have deleted it). */
export function mentionsInText(text: string, picked: readonly MentionCandidate[]): string[] {
  return [
    ...new Set(
      segmentMentions(text, picked)
        .map((s) => s.userId)
        .filter((id): id is string => !!id),
    ),
  ];
}
