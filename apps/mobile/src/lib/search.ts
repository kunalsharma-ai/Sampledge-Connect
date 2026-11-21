import { parseSearchOperators, searchTerms, type SearchType } from '@sampledge/contracts';
import type { LocalSearch } from '../db/store';
import type { SearchParams } from '../sync/transport';

export interface SearchPerson {
  userId: string;
  displayName: string;
  email?: string | null;
}
export interface SearchPlace {
  conversationId: string;
  kind: string;
  name: string | null;
  memberIds: string[];
}

/** A filter the search applies, shown as a chip under the box. */
export interface SearchFilter {
  key: 'from' | 'in' | 'hasFile' | 'after' | 'before';
  label: string;
}

export interface BuiltSearch {
  /** For the server. */
  params: SearchParams;
  /** For the messages saved on this phone. */
  local: LocalSearch;
  filters: SearchFilter[];
  /** Something typed could not be understood (e.g. no one by that name). */
  problem: string | null;
  /** Nothing to search for yet. */
  empty: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Local midnight of a YYYY-MM-DD date, as ISO. */
function dayStart(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toISOString();
}

/** Finds a person by "me", name (or first name) or email. */
export function findPerson(
  name: string,
  people: readonly SearchPerson[],
  selfId: string,
): SearchPerson | null {
  const n = norm(name).replace(/[._-]+/g, ' ');
  if (n === 'me' || n === 'myself') return people.find((p) => p.userId === selfId) ?? null;
  const exact = people.find((p) => norm(p.displayName) === n || norm(p.email ?? '') === norm(name));
  if (exact) return exact;
  const starts = people.filter(
    (p) =>
      norm(p.displayName).startsWith(n) ||
      norm(p.displayName)
        .split(/\s+/)
        .some((w) => w === n) ||
      norm(p.email ?? '').startsWith(norm(name)),
  );
  return starts.length === 1 ? starts[0]! : (starts[0] ?? null);
}

/** Finds a channel by name, or a direct chat by the other person's name. */
export function findPlace(
  name: string,
  places: readonly SearchPlace[],
  people: readonly SearchPerson[],
  selfId: string,
): SearchPlace | null {
  const n = norm(name).replace(/^#/, '');
  const named =
    places.find((c) => c.name && norm(c.name) === n) ??
    places.find((c) => c.name && norm(c.name).startsWith(n));
  if (named) return named;
  const person = findPerson(n, people, selfId);
  if (!person) return null;
  return (
    places.find(
      (c) => c.kind === 'dm' && c.memberIds.includes(person.userId) && c.memberIds.includes(selfId),
    ) ?? null
  );
}

/**
 * Turns what was typed (with from:, in:, has:file, before:, after: and "phrases") plus the
 * chosen tab into a server query and a query for this phone.
 */
export function buildSearch(
  raw: string,
  ctx: {
    people: readonly SearchPerson[];
    places: readonly SearchPlace[];
    selfId: string;
    placeTitle: (c: SearchPlace) => string;
    type?: SearchType | null;
  },
): BuiltSearch {
  const op = parseSearchOperators(raw);
  const terms = searchTerms(op.text);
  const filters: SearchFilter[] = [];
  const params: SearchParams = {};
  const local: LocalSearch = { terms };
  let problem: string | null = null;
  if (op.text.trim()) params.q = op.text.trim();
  if (op.from) {
    const p = findPerson(op.from, ctx.people, ctx.selfId);
    if (p) {
      params.from = local.from = p.userId;
      filters.push({
        key: 'from',
        label: `From ${p.userId === ctx.selfId ? 'you' : p.displayName}`,
      });
    } else problem = `No one called “${op.from}” here.`;
  }
  if (op.in) {
    const c = findPlace(op.in, ctx.places, ctx.people, ctx.selfId);
    if (c) {
      params.in = local.in = c.conversationId;
      filters.push({ key: 'in', label: `In ${ctx.placeTitle(c)}` });
    } else problem ??= `No channel or chat called “${op.in}”.`;
  }
  if (op.hasFile) {
    params.hasFile = local.hasFile = true;
    filters.push({ key: 'hasFile', label: 'Has a file' });
  }
  if (op.after) {
    params.after = local.after = dayStart(op.after);
    filters.push({ key: 'after', label: `After ${op.after}` });
  }
  if (op.before) {
    // "before:2026-11-01" means up to the start of that day.
    params.before = local.before = dayStart(op.before);
    filters.push({ key: 'before', label: `Before ${op.before}` });
  }
  if (ctx.type) params.types = [ctx.type];
  const empty = !params.q && filters.length === 0;
  return { params, local, filters, problem, empty };
}

/** Removes one operator from what was typed (when its chip is closed). */
export function dropOperator(raw: string, key: SearchFilter['key']): string {
  const op = key === 'hasFile' ? 'has' : key;
  return raw
    .replace(new RegExp(`(^|\\s)${op}:("[^"]*"|\\S+)`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits text into plain and highlighted parts by [start, end) ranges. */
export function highlightParts(
  text: string,
  ranges: readonly (readonly [number, number])[],
): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a < at || a >= text.length) continue;
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    out.push({ text: text.slice(a, Math.min(b, text.length)), hit: true });
    at = Math.min(b, text.length);
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
