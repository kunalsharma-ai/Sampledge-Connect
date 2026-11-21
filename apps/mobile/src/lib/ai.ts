import type { AiRisk, AiStatus, SummaryRange } from '@sampledge/contracts';

export const SUMMARY_RANGE_LABEL: Record<SummaryRange, string> = {
  recent: 'Recent',
  unread: 'Unread',
  day: 'Last day',
  week: 'Last week',
};

export const DIGEST_STATUS_LABEL = {
  on_track: 'On track',
  needs_attention: 'Needs attention',
  quiet: 'Quiet',
} as const;

const RISK_LABEL: Record<AiRisk['categories'][number], string> = {
  financial: 'money or pricing',
  hr: 'HR or people matters',
  client_facing: 'people outside the organization',
  destructive: 'deleting or cancelling something',
};

/** "This mentions money or pricing and people outside the organization." */
export function riskSentence(risk: AiRisk): string | null {
  if (risk.level !== 'sensitive' || !risk.categories.length) return null;
  const parts = risk.categories.map((c) => RISK_LABEL[c]);
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `This mentions ${list}. Check it before it goes out.`;
}

/** One line on which engine answers, for the top of AI screens. */
export function engineLine(s: AiStatus): string {
  if (!s.enabled) return 'The assistant is off for your organization.';
  if (s.engine === 'model')
    return `Answers come from your organization's own model${s.model ? ` (${s.model})` : ''}. Nothing leaves your servers.`;
  return 'Built-in assistant: quick extracts that run on your server. An admin can connect a model server in Integrations for written answers and translation.';
}

/** Languages offered for translation, by BCP 47 tag. */
export const TRANSLATE_LANGUAGES: { tag: string; label: string }[] = [
  { tag: 'en', label: 'English' },
  { tag: 'es', label: 'Spanish' },
  { tag: 'fr', label: 'French' },
  { tag: 'de', label: 'German' },
  { tag: 'pt-BR', label: 'Portuguese' },
  { tag: 'it', label: 'Italian' },
  { tag: 'hi', label: 'Hindi' },
  { tag: 'ja', label: 'Japanese' },
  { tag: 'zh', label: 'Chinese' },
  { tag: 'ar', label: 'Arabic' },
];

/** The device language as a translate target, falling back to English. */
export function defaultTargetLanguage(locale: string | undefined): string {
  const l = (locale ?? 'en').toLowerCase();
  const hit = TRANSLATE_LANGUAGES.find(
    (x) => x.tag.toLowerCase() === l || x.tag.toLowerCase().split('-')[0] === l.split('-')[0],
  );
  return hit?.tag ?? 'en';
}

/** Turns a summary into a message the person can share (after confirming). */
export function summaryAsMessage(s: {
  summary: string;
  decisions: string[];
  actionItems: { text: string }[];
  openQuestions: string[];
}): string {
  const out = [`Summary: ${s.summary.trim()}`];
  const block = (title: string, items: string[]) => {
    if (items.length) out.push(`${title}:\n${items.map((x) => `• ${x}`).join('\n')}`);
  };
  block('Decisions', s.decisions);
  block(
    'Action items',
    s.actionItems.map((a) => a.text),
  );
  block('Open questions', s.openQuestions);
  return out.join('\n\n').slice(0, 8000);
}
