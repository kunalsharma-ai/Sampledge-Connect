import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';

/**
 * Fonts for generated PDFs. Bundled fonts (assets/fonts) cover Latin, Greek, Cyrillic, Arabic,
 * Hebrew, Armenian and Georgian. Other scripts (Devanagari and other Indic scripts, Thai,
 * Chinese, Japanese, Korean...) use Noto fonts installed on the server: the API image adds
 * them (apk font-noto*). Text is split into runs, and each run uses the first font that has
 * its glyphs, so a Hindi name inside an English sentence still renders.
 */

interface LoadedFont {
  /** Path given to pdfkit. */
  path: string;
  /** Font inside a collection (.ttc), else undefined. */
  family?: string;
  has(cp: number): boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
/** src/documents or dist/documents → apps/api/assets/fonts */
const BUNDLED_DIR = resolve(here, '../../assets/fonts');
const SYSTEM_DIRS = ['/usr/share/fonts', '/usr/local/share/fonts'];

export type FontFace = 'sans' | 'sansBold' | 'serif' | 'serifBold' | 'ui' | 'uiBold';

const BUNDLED: Record<FontFace, string> = {
  sans: 'DejaVuSans.ttf',
  sansBold: 'DejaVuSans-Bold.ttf',
  serif: 'DejaVuSerif.ttf',
  serifBold: 'DejaVuSerif-Bold.ttf',
  ui: 'Inter-Regular.otf',
  uiBold: 'Inter-SemiBold.otf',
};

const cache = new Map<string, LoadedFont | null>();

function load(path: string, family?: string): LoadedFont | null {
  const key = `${path}#${family ?? ''}`;
  if (cache.has(key)) return cache.get(key)!;
  let out: LoadedFont | null = null;
  try {
    const f = fontkit.openSync(path) as unknown as FontkitFont | FontkitCollection;
    let font: FontkitFont | undefined;
    let fam = family;
    if ('fonts' in f) {
      font = (family ? f.fonts.find((x) => x.postscriptName === family) : undefined) ?? f.fonts[0];
      fam = font?.postscriptName;
    } else font = f;
    if (font) {
      const ff = font;
      out = { path, family: fam, has: (cp) => ff.hasGlyphForCodePoint(cp) };
    }
  } catch {
    out = null;
  }
  cache.set(key, out);
  return out;
}

export function bundledFont(face: FontFace): LoadedFont {
  const f = load(join(BUNDLED_DIR, BUNDLED[face]));
  if (!f) throw new Error(`Bundled font ${BUNDLED[face]} is missing from ${BUNDLED_DIR}`);
  return f;
}

let systemList: string[] | null = null;
/** Font files on the server, found once. Regular weights only (bold falls back to regular). */
function systemFonts(): string[] {
  if (systemList) return systemList;
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || out.length > 2000) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (/\.(ttf|otf|ttc)$/i.test(n) && !/emoji|color|mono|italic|oblique/i.test(n))
        out.push(p);
    }
  };
  for (const d of SYSTEM_DIRS) if (existsSync(d)) walk(d, 0);
  // Regular faces first, then UI/"Sans" families, so runs look consistent.
  const score = (p: string) =>
    (/regular/i.test(p) ? 0 : /bold|black|light|thin|medium|semi|extra/i.test(p) ? 2 : 1) +
    (/sans/i.test(p) ? 0 : 1);
  systemList = out.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
  return systemList;
}

/** Unicode block → words that appear in file names of fonts for that script. */
const HINTS: [number, number, RegExp][] = [
  [0x0900, 0x097f, /devanagari/i],
  [0x0980, 0x09ff, /bengali/i],
  [0x0a00, 0x0a7f, /gurmukhi/i],
  [0x0a80, 0x0aff, /gujarati/i],
  [0x0b00, 0x0b7f, /oriya/i],
  [0x0b80, 0x0bff, /tamil/i],
  [0x0c00, 0x0c7f, /telugu/i],
  [0x0c80, 0x0cff, /kannada/i],
  [0x0d00, 0x0d7f, /malayalam/i],
  [0x0d80, 0x0dff, /sinhala/i],
  [0x0e00, 0x0e7f, /thai/i],
  [0x0e80, 0x0eff, /lao/i],
  [0x1000, 0x109f, /myanmar/i],
  [0x1780, 0x17ff, /khmer/i],
  [0x0590, 0x05ff, /hebrew/i],
  [0x0600, 0x06ff, /arabic|naskh|kufi/i],
  [0x10a0, 0x10ff, /georgian/i],
  [0x1200, 0x139f, /ethiopic/i],
  [0x3040, 0x30ff, /cjk|jp|japan|gothic|ipa|mincho/i],
  [0x3400, 0x9fff, /cjk|sc|tc|hei|song|ming|wqy|droid/i],
  [0xac00, 0xd7af, /cjk|kr|korean|nanum|hangul/i],
  [0x1100, 0x11ff, /cjk|kr|korean|nanum|hangul/i],
  [0xff00, 0xffef, /cjk|jp|sc|hei|wqy/i],
];

const fallbackByCp = new Map<number, LoadedFont | null>();

function systemFontFor(cp: number): LoadedFont | null {
  const block = cp >> 7;
  if (fallbackByCp.has(block)) {
    const f = fallbackByCp.get(block)!;
    if (!f || f.has(cp)) return f;
  }
  const hint = HINTS.find(([a, b]) => cp >= a && cp <= b)?.[2];
  const files = systemFonts();
  const ordered = hint ? [...files.filter((p) => hint.test(p)), ...files] : files;
  let found: LoadedFont | null = null;
  for (const p of ordered.slice(0, 400)) {
    const f = load(p);
    if (f?.has(cp)) {
      found = f;
      break;
    }
  }
  fallbackByCp.set(block, found);
  return found;
}

export interface TextRun {
  text: string;
  font: LoadedFont;
}

/**
 * Splits text into runs, each with a font that can draw it. Spaces and punctuation stay with
 * the run before them, so words are not broken across fonts. Characters no font has are drawn
 * with the primary font (they show as boxes, which is the honest outcome).
 */
export function fontRuns(text: string, primary: LoadedFont, fallback: LoadedFont): TextRun[] {
  const runs: TextRun[] = [];
  let cur: TextRun | null = null;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    let font: LoadedFont;
    if (cp < 0x80) font = cur && /[\s\p{P}\d]/u.test(ch) ? cur.font : primary;
    else if (/\s/u.test(ch)) font = cur?.font ?? primary;
    else if (primary.has(cp)) font = primary;
    else if (fallback.has(cp)) font = fallback;
    else font = systemFontFor(cp) ?? primary;
    if (cur && cur.font === font) cur.text += ch;
    else {
      cur = { text: ch, font };
      runs.push(cur);
    }
  }
  return runs;
}

/** Fonts found on this server, for the admin screen and docs ("which scripts can PDFs show"). */
export function fontCoverage(): { bundled: string[]; system: number } {
  return { bundled: Object.values(BUNDLED), system: systemFonts().length };
}

// Minimal fontkit typing (the package ships none).
interface FontkitFont {
  postscriptName: string;
  hasGlyphForCodePoint(cp: number): boolean;
}
interface FontkitCollection {
  fonts: FontkitFont[];
}
