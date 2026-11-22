import { RTL_LANGUAGES, type MinutesTemplate } from '@sampledge/contracts';
import type { FontFace } from './fonts.js';

/**
 * A document described once and drawn twice: as PDF (pdf.ts) and as Word (docx.ts). Minutes
 * and chat exports build this model; templates only change how it looks.
 */
export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string; muted?: boolean }
  | { kind: 'list'; items: string[]; style: 'bullet' | 'number' | 'check'; checked?: boolean[] }
  | { kind: 'table'; columns: string[]; widths: number[]; rows: string[][] }
  | { kind: 'day'; text: string }
  | { kind: 'chat'; line: ChatLine }
  | { kind: 'transcript'; title: string; note: string; lines: TranscriptRow[] }
  | { kind: 'pageBreak' };

export interface ChatLine {
  who: string;
  at: string;
  text: string;
  system?: boolean;
  files?: string[];
  /** A recording's transcript, printed under it. */
  transcript?: string | null;
  edited?: boolean;
}

export interface TranscriptRow {
  at: string;
  speaker: string | null;
  text: string;
}

export interface DocLogo {
  data: Buffer;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

export interface DocModel {
  title: string;
  subtitle: string;
  /** "Minutes of meeting", "Chat export": small label above the title. */
  eyebrow: string;
  orgName: string;
  appName: string;
  logo: DocLogo | null;
  /** Organization brand colour (#RRGGBB). */
  brand: string;
  /** Main language of the content (paragraph direction). */
  language: string;
  facts: [string, string][];
  blocks: Block[];
  /** Printed on every page, next to the page number. */
  footer: string;
  /** Diagonal mark on PDF pages and a tag in the Word header ("DRAFT"). */
  watermark: string | null;
  /** Document properties. */
  author: string;
  subject: string;
}

export interface Theme {
  body: FontFace;
  bold: FontFace;
  title: FontFace;
  size: number;
  headingSize: number;
  titleSize: number;
  margin: number;
  ink: string;
  muted: string;
  rule: string;
  /** Tint behind facts and table headers. */
  panel: string;
  accent: string;
  header: 'centered' | 'brand' | 'band' | 'compact';
  heading: 'rule' | 'accent' | 'caps' | 'inline';
  /** Word font names (Word substitutes per script on the reader's computer). */
  wordBody: string;
  wordTitle: string;
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
function mix(hex: string, other: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex);
  const b = p(other);
  return `#${a
    .map((v, i) =>
      clamp(v + (b[i]! - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** A brand colour dark enough for text on white (WCAG AA for headings). */
export function readableAccent(hex: string): string {
  const ok = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#2563EB';
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  let c = ok;
  for (let i = 0; i < 8 && 1.05 / (lum(c) + 0.05) < 4.5; i++) c = mix(c, '#000000', 0.18);
  return c;
}

export function theme(template: MinutesTemplate, brand: string): Theme {
  const accent = readableAccent(brand);
  switch (template) {
    case 'classic':
      return {
        body: 'serif',
        bold: 'serifBold',
        title: 'serifBold',
        size: 10.5,
        headingSize: 12.5,
        titleSize: 22,
        margin: 64,
        ink: '#1F2328',
        muted: '#5B6168',
        rule: '#9AA0A6',
        panel: '#F4F1EA',
        accent: '#1F2328',
        header: 'centered',
        heading: 'rule',
        wordBody: 'Georgia',
        wordTitle: 'Georgia',
      };
    case 'executive':
      return {
        body: 'ui',
        bold: 'uiBold',
        title: 'uiBold',
        size: 10,
        headingSize: 9.5,
        titleSize: 22,
        margin: 52,
        ink: '#0F172A',
        muted: '#475569',
        rule: '#CBD5E1',
        panel: '#F1F5F9',
        accent,
        header: 'band',
        heading: 'caps',
        wordBody: 'Segoe UI',
        wordTitle: 'Segoe UI Semibold',
      };
    case 'compact':
      return {
        body: 'ui',
        bold: 'uiBold',
        title: 'uiBold',
        size: 9,
        headingSize: 10,
        titleSize: 15,
        margin: 40,
        ink: '#111827',
        muted: '#4B5563',
        rule: '#D1D5DB',
        panel: '#F3F4F6',
        accent,
        header: 'compact',
        heading: 'inline',
        wordBody: 'Arial',
        wordTitle: 'Arial',
      };
    case 'modern':
    default:
      return {
        body: 'ui',
        bold: 'uiBold',
        title: 'uiBold',
        size: 10.5,
        headingSize: 13,
        titleSize: 24,
        margin: 56,
        ink: '#111827',
        muted: '#4B5563',
        rule: '#E5E7EB',
        panel: mix(accent, '#FFFFFF', 0.92),
        accent,
        header: 'brand',
        heading: 'accent',
        wordBody: 'Calibri',
        wordTitle: 'Calibri Light',
      };
  }
}

export const isRtl = (language: string) => RTL_LANGUAGES.has(language.split('-')[0]!);

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿऀ-෿぀-鿿]/;
/** Paragraph direction from its first strong character. */
export function textIsRtl(text: string): boolean {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return true;
    if (STRONG_LTR.test(ch)) return false;
  }
  return false;
}

/** Width and height of a PNG or JPEG (for the logo); null when not one of those. */
export function imageInfo(data: Buffer): DocLogo | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47)
    return { data, type: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1]!;
      const len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return {
          data,
          type: 'jpg',
          height: data.readUInt16BE(i + 5),
          width: data.readUInt16BE(i + 7),
        };
      i += 2 + len;
    }
  }
  return null;
}

/** The organization logo from its data URL (PNG and JPEG only; SVG/WebP are skipped). */
export function logoFromDataUrl(url: string | null | undefined): DocLogo | null {
  if (!url) return null;
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(url);
  if (!m) return null;
  const info = imageInfo(Buffer.from(m[2]!, 'base64'));
  return info && info.width > 0 && info.height > 0 ? info : null;
}
