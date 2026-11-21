import PDFDocument from 'pdfkit';
import type { MinutesTemplate } from '@sampledge/contracts';
import { bundledFont, fontRuns, type FontFace } from './fonts.js';
import { textIsRtl, theme, type Block, type DocModel, type Theme } from './model.js';

type Doc = PDFKit.PDFDocument;

interface TextOpts {
  face: FontFace;
  size: number;
  color: string;
  width?: number;
  x?: number;
  y?: number;
  align?: 'left' | 'right' | 'center' | 'justify';
  lineGap?: number;
  characterSpacing?: number;
}

const FALLBACK: Record<FontFace, FontFace> = {
  sans: 'sans',
  sansBold: 'sansBold',
  serif: 'sans',
  serifBold: 'sansBold',
  ui: 'sans',
  uiBold: 'sansBold',
};

/**
 * Renders the document model as an A4 PDF. Fonts are embedded as subsets, text that the
 * template font lacks (Hindi, Arabic, Chinese...) switches to a font that has it, and every
 * page gets a footer with the page number.
 */
export function renderPdf(model: DocModel, template: MinutesTemplate): Promise<Buffer> {
  const th = theme(template, model.brand);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: th.margin, bottom: th.margin + 18, left: th.margin, right: th.margin },
    bufferPages: true,
    autoFirstPage: true,
    lang: model.language,
    displayTitle: true,
    info: {
      Title: model.title,
      Author: model.author,
      Subject: model.subject,
      Creator: model.appName,
      Producer: model.appName,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const r = new PdfRenderer(doc, th, model);
  r.header();
  for (const b of model.blocks) r.block(b);
  r.finish();
  doc.end();
  return done;
}

class PdfRenderer {
  private readonly left: number;
  private readonly width: number;

  constructor(
    private readonly doc: Doc,
    private readonly th: Theme,
    private readonly m: DocModel,
  ) {
    this.left = doc.page.margins.left;
    this.width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  }

  private get bottom() {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  private ensure(h: number) {
    if (this.doc.y + h > this.bottom) this.doc.addPage();
  }

  private setFont(face: FontFace, size: number) {
    const f = bundledFont(face);
    if (f.family) this.doc.font(f.path, f.family);
    else this.doc.font(f.path);
    this.doc.fontSize(size);
  }

  /** Width of text drawn with font fallback (each run measured in its own font). */
  private textWidth(text: string, face: FontFace, size: number) {
    let w = 0;
    for (const run of fontRuns(text, bundledFont(face), bundledFont(FALLBACK[face]))) {
      if (run.font.family) this.doc.font(run.font.path, run.font.family);
      else this.doc.font(run.font.path);
      w += this.doc.fontSize(size).widthOfString(run.text);
    }
    return w;
  }

  private height(text: string, face: FontFace, size: number, width: number, lineGap = 2) {
    this.setFont(face, size);
    return this.doc.heightOfString(text || ' ', { width, lineGap });
  }

  /** Writes text with per-script font fallback. Moves doc.y below it. */
  text(text: string, o: TextOpts) {
    const doc = this.doc;
    const primary = bundledFont(o.face);
    const fallback = bundledFont(FALLBACK[o.face]);
    const rtl = textIsRtl(text);
    const runs = fontRuns(text || ' ', primary, fallback);
    const opts = {
      width: o.width ?? this.width,
      align: o.align ?? (rtl ? ('right' as const) : ('left' as const)),
      lineGap: o.lineGap ?? 2,
      characterSpacing: o.characterSpacing ?? 0,
    };
    doc.fillColor(o.color);
    runs.forEach((run, i) => {
      if (run.font.family) doc.font(run.font.path, run.font.family);
      else doc.font(run.font.path);
      doc.fontSize(o.size);
      const continued = i < runs.length - 1;
      if (i === 0 && o.x !== undefined)
        doc.text(run.text, o.x, o.y ?? doc.y, { ...opts, continued });
      else if (i === 0) doc.text(run.text, this.left, doc.y, { ...opts, continued });
      else doc.text(run.text, { ...opts, continued });
    });
  }

  header() {
    const { doc, th, m } = this;
    const pageW = doc.page.width;
    if (th.header === 'band') {
      const bandH = 128;
      doc.save().rect(0, 0, pageW, bandH).fill('#0F172A').restore();
      doc.save().rect(0, bandH, pageW, 4).fill(th.accent).restore();
      let textRight = pageW - th.margin;
      if (m.logo) {
        const h = 34;
        const w = Math.min(120, (m.logo.width / m.logo.height) * h);
        const x = pageW - th.margin - w - 12;
        doc
          .save()
          .roundedRect(x - 8, 30, w + 16, h + 16, 6)
          .fill('#FFFFFF')
          .restore();
        doc.image(m.logo.data, x, 38, { fit: [w, h] });
        textRight = x - 24;
      }
      const w = textRight - th.margin;
      this.text(m.eyebrow.toUpperCase(), {
        face: th.bold,
        size: 8.5,
        color: '#94A3B8',
        x: th.margin,
        y: 30,
        width: w,
        characterSpacing: 1.2,
      });
      this.text(m.title, {
        face: th.title,
        size: th.titleSize,
        color: '#FFFFFF',
        x: th.margin,
        y: 46,
        width: w,
        lineGap: 0,
      });
      this.text(m.subtitle, { face: th.body, size: 10, color: '#CBD5E1', x: th.margin, width: w });
      doc.y = Math.max(doc.y, bandH) + 22;
      this.facts('grid');
      return;
    }
    if (th.header === 'compact') {
      const startY = doc.y;
      const rightW = 190;
      this.text(m.title, {
        face: th.title,
        size: th.titleSize,
        color: th.ink,
        width: this.width - rightW - 10,
        lineGap: 0,
      });
      const afterTitle = doc.y;
      this.text(`${m.orgName}\n${m.subtitle}`, {
        face: th.body,
        size: 8.5,
        color: th.muted,
        x: this.left + this.width - rightW,
        y: startY + 1,
        width: rightW,
        align: 'right',
      });
      doc.y = Math.max(afterTitle, doc.y) + 6;
      doc
        .moveTo(this.left, doc.y)
        .lineTo(this.left + this.width, doc.y)
        .lineWidth(1.2)
        .stroke(th.accent);
      doc.y += 8;
      this.facts('inline');
      return;
    }
    if (th.header === 'centered') {
      if (m.logo) {
        const h = 40;
        const w = Math.min(160, (m.logo.width / m.logo.height) * h);
        doc.image(m.logo.data, (pageW - w) / 2, doc.y, { fit: [w, h], align: 'center' });
        doc.y += h + 10;
      }
      this.text(m.orgName.toUpperCase(), {
        face: th.body,
        size: 9,
        color: th.muted,
        align: 'center',
        characterSpacing: 2,
      });
      doc.y += 6;
      this.text(m.eyebrow, { face: th.body, size: 11, color: th.muted, align: 'center' });
      this.text(m.title, {
        face: th.title,
        size: th.titleSize,
        color: th.ink,
        align: 'center',
        lineGap: 1,
      });
      doc.y += 2;
      this.text(m.subtitle, { face: th.body, size: 10, color: th.muted, align: 'center' });
      doc.y += 10;
      const y = doc.y;
      doc
        .moveTo(this.left, y)
        .lineTo(this.left + this.width, y)
        .lineWidth(0.8)
        .stroke(th.ink);
      doc
        .moveTo(this.left, y + 3)
        .lineTo(this.left + this.width, y + 3)
        .lineWidth(0.4)
        .stroke(th.ink);
      doc.y = y + 14;
      this.facts('table');
      return;
    }
    // brand
    doc.save().rect(0, 0, pageW, 8).fill(th.accent).restore();
    const top = doc.y;
    let nameX = this.left;
    if (m.logo) {
      const h = 30;
      const w = Math.min(110, (m.logo.width / m.logo.height) * h);
      doc.image(m.logo.data, this.left, top, { fit: [w, h] });
      nameX = this.left + w + 10;
    }
    this.text(m.orgName, {
      face: th.bold,
      size: 10,
      color: th.ink,
      x: nameX,
      y: top + (m.logo ? 9 : 0),
      width: this.width - (nameX - this.left),
    });
    doc.y = top + (m.logo ? 30 : 16) + 18;
    this.text(m.eyebrow.toUpperCase(), {
      face: th.bold,
      size: 8.5,
      color: th.accent,
      characterSpacing: 1.4,
    });
    doc.y += 2;
    this.text(m.title, { face: th.title, size: th.titleSize, color: th.ink, lineGap: 0 });
    doc.y += 3;
    this.text(m.subtitle, { face: th.body, size: 10.5, color: th.muted });
    doc.y += 14;
    this.facts('panel');
  }

  private facts(style: 'grid' | 'table' | 'panel' | 'inline') {
    const { doc, th, m } = this;
    if (!m.facts.length) return;
    if (style === 'inline') {
      const line = m.facts.map(([k, v]) => `${k}: ${v}`).join('   ·   ');
      this.text(line, { face: th.body, size: th.size, color: th.muted });
      doc.y += 8;
      return;
    }
    const cols = style === 'grid' ? 3 : style === 'panel' ? 2 : 1;
    const gap = 14;
    const pad = style === 'table' ? 0 : 12;
    const colW = (this.width - pad * 2 - gap * (cols - 1)) / cols;
    const labelW = style === 'table' ? 110 : colW;
    const valueW = style === 'table' ? this.width - labelW - 10 : colW;
    const rows: [string, string][][] = [];
    for (let i = 0; i < m.facts.length; i += cols) rows.push(m.facts.slice(i, i + cols));
    const rowH = rows.map((row) =>
      Math.max(
        ...row.map(([, v]) =>
          style === 'table'
            ? this.height(v, th.body, th.size, valueW) + 6
            : 12 + this.height(v, th.bold, th.size, valueW) + 8,
        ),
      ),
    );
    const total = rowH.reduce((a, b) => a + b, 0) + pad * 2;
    this.ensure(Math.min(total, 300));
    const top = doc.y;
    if (style !== 'table')
      doc.save().roundedRect(this.left, top, this.width, total, 6).fill(th.panel).restore();
    let y = top + pad;
    rows.forEach((row, ri) => {
      row.forEach(([k, v], ci) => {
        const x = this.left + pad + ci * (colW + gap);
        if (style === 'table') {
          this.text(k, {
            face: th.bold,
            size: th.size,
            color: th.ink,
            x: this.left,
            y,
            width: labelW,
          });
          this.text(v, {
            face: th.body,
            size: th.size,
            color: th.ink,
            x: this.left + labelW + 10,
            y,
            width: valueW,
          });
        } else {
          this.text(k.toUpperCase(), {
            face: th.bold,
            size: 7.5,
            color: th.muted,
            x,
            y,
            width: colW,
            characterSpacing: 0.8,
          });
          this.text(v, { face: th.bold, size: th.size, color: th.ink, x, y: y + 12, width: colW });
        }
      });
      y += rowH[ri]!;
    });
    doc.y = top + total + (style === 'table' ? 6 : 18);
    if (style === 'table') {
      doc
        .moveTo(this.left, doc.y)
        .lineTo(this.left + this.width, doc.y)
        .lineWidth(0.4)
        .stroke(th.rule);
      doc.y += 14;
    }
  }

  private heading(text: string) {
    const { doc, th } = this;
    // Keep a heading with the first lines of its section.
    this.ensure(th.headingSize + 90);
    doc.y += th.heading === 'inline' ? 6 : 12;
    if (th.heading === 'accent') {
      const y = doc.y;
      doc
        .save()
        .roundedRect(this.left, y + 3, 4, th.headingSize - 2, 1.5)
        .fill(th.accent)
        .restore();
      this.text(text, {
        face: th.bold,
        size: th.headingSize,
        color: th.ink,
        x: this.left + 12,
        y,
        width: this.width - 12,
      });
      doc.y += 5;
    } else if (th.heading === 'caps') {
      this.text(text.toUpperCase(), {
        face: th.bold,
        size: th.headingSize,
        color: th.accent,
        characterSpacing: 1.3,
      });
      doc.y += 2;
      doc
        .moveTo(this.left, doc.y)
        .lineTo(this.left + 36, doc.y)
        .lineWidth(2)
        .stroke(th.accent);
      doc.y += 8;
    } else if (th.heading === 'rule') {
      this.text(text, { face: th.bold, size: th.headingSize, color: th.ink });
      doc.y += 2;
      doc
        .moveTo(this.left, doc.y)
        .lineTo(this.left + this.width, doc.y)
        .lineWidth(0.5)
        .stroke(th.rule);
      doc.y += 7;
    } else {
      this.text(text, { face: th.bold, size: th.headingSize, color: th.accent });
      doc.y += 3;
    }
    doc.x = this.left;
  }

  block(b: Block) {
    const { doc, th } = this;
    switch (b.kind) {
      case 'heading':
        this.heading(b.text);
        return;
      case 'paragraph': {
        this.ensure(this.height(b.text, th.body, th.size, this.width) > 200 ? 40 : 30);
        this.text(b.text, {
          face: th.body,
          size: b.muted ? th.size - 1 : th.size,
          color: b.muted ? th.muted : th.ink,
          lineGap: 3,
        });
        doc.y += 6;
        return;
      }
      case 'list': {
        const indent = 16;
        b.items.forEach((item, i) => {
          const h = this.height(item, th.body, th.size, this.width - indent, 3);
          this.ensure(h + 4);
          const y = doc.y;
          if (b.style === 'check') {
            const box = th.size - 1;
            doc
              .save()
              .roundedRect(this.left + 1, y + 1.5, box, box, 1.5)
              .lineWidth(0.9)
              .stroke(th.muted)
              .restore();
            if (b.checked?.[i])
              doc
                .save()
                .moveTo(this.left + 3, y + 1.5 + box / 2)
                .lineTo(this.left + box / 2, y + box - 0.5)
                .lineTo(this.left + box - 1, y + 3.5)
                .lineWidth(1.3)
                .stroke(th.accent)
                .restore();
          } else {
            const mark = b.style === 'number' ? `${i + 1}.` : '•';
            this.text(mark, {
              face: th.bold,
              size: th.size,
              color: th.accent,
              x: this.left,
              y,
              width: indent,
            });
          }
          this.text(item, {
            face: th.body,
            size: th.size,
            color: th.ink,
            x: this.left + indent,
            y,
            width: this.width - indent,
            lineGap: 3,
          });
          doc.y = Math.max(doc.y, y + h) + 4;
        });
        doc.y += 4;
        doc.x = this.left;
        return;
      }
      case 'table':
        this.table(b);
        return;
      case 'day': {
        this.ensure(40);
        doc.y += 8;
        const y = doc.y + 6;
        doc
          .moveTo(this.left, y)
          .lineTo(this.left + this.width, y)
          .lineWidth(0.5)
          .stroke(th.rule);
        const label = ` ${b.text} `;
        this.setFont(th.bold, 8.5);
        const w = doc.widthOfString(label) + 16;
        const x = this.left + (this.width - w) / 2;
        doc
          .save()
          .roundedRect(x, y - 7, w, 14, 7)
          .fill(th.panel)
          .restore();
        this.text(b.text, {
          face: th.bold,
          size: 8.5,
          color: th.muted,
          x,
          y: y - 4.5,
          width: w,
          align: 'center',
        });
        doc.y = y + 14;
        return;
      }
      case 'chat':
        this.chat(b.line);
        return;
      case 'transcript': {
        this.heading(b.title);
        if (b.note) {
          this.text(b.note, { face: th.body, size: th.size - 1.5, color: th.muted });
          doc.y += 6;
        }
        const timeW = 44;
        for (const l of b.lines) {
          const body = l.speaker ? `${l.speaker}: ${l.text}` : l.text;
          const h = this.height(body, th.body, th.size - 0.5, this.width - timeW, 2);
          this.ensure(h + 3);
          const y = doc.y;
          this.text(l.at, {
            face: th.body,
            size: th.size - 1.5,
            color: th.muted,
            x: this.left,
            y: y + 0.5,
            width: timeW,
          });
          this.text(body, {
            face: th.body,
            size: th.size - 0.5,
            color: th.ink,
            x: this.left + timeW,
            y,
            width: this.width - timeW,
          });
          doc.y = Math.max(doc.y, y + h) + 3;
        }
        doc.x = this.left;
        return;
      }
      case 'pageBreak':
        doc.addPage();
        return;
    }
  }

  private chat(l: ChatLineLike) {
    const { doc, th } = this;
    const indent = 10;
    if (l.system) {
      const h = this.height(l.text, th.body, th.size - 1, this.width - indent);
      this.ensure(h + 8);
      this.text(`${l.at}  ·  ${l.text}`, {
        face: th.body,
        size: th.size - 1,
        color: th.muted,
        x: this.left + indent,
        width: this.width - indent,
      });
    } else {
      const textH = this.height(l.text, th.body, th.size, this.width - indent, 2.5);
      this.ensure(Math.min(textH, 120) + th.size + 10);
      const y = doc.y;
      this.text(l.who, { face: th.bold, size: th.size, color: th.ink, x: this.left, y });
      const nameW = Math.min(this.width - 80, this.textWidth(l.who, th.bold, th.size));
      this.text(`${l.at}${l.edited ? ' (edited)' : ''}`, {
        face: th.body,
        size: th.size - 1.5,
        color: th.muted,
        x: this.left + nameW + 8,
        y: y + 1,
        width: this.width - nameW - 8,
      });
      doc.y = Math.max(doc.y, y + th.size + 3);
      if (l.text)
        this.text(l.text, {
          face: th.body,
          size: th.size,
          color: th.ink,
          x: this.left + indent,
          width: this.width - indent,
          lineGap: 2.5,
        });
    }
    for (const f of l.files ?? []) {
      this.ensure(14);
      this.text(`Attachment: ${f}`, {
        face: th.body,
        size: th.size - 1.5,
        color: th.accent,
        x: this.left + indent,
        width: this.width - indent,
      });
    }
    if (l.transcript) {
      const h = this.height(l.transcript, th.body, th.size - 1, this.width - indent * 3);
      this.ensure(Math.min(h, 80) + 18);
      const y = doc.y + 2;
      this.text('Transcript', {
        face: th.bold,
        size: th.size - 2,
        color: th.muted,
        x: this.left + indent * 2,
        y,
        width: this.width - indent * 3,
      });
      this.text(l.transcript, {
        face: th.body,
        size: th.size - 1,
        color: th.muted,
        x: this.left + indent * 2,
        width: this.width - indent * 3,
      });
      doc
        .moveTo(this.left + indent + 2, y)
        .lineTo(this.left + indent + 2, doc.y)
        .lineWidth(1.5)
        .stroke(th.rule);
    }
    doc.y += 7;
    doc.x = this.left;
  }

  private table(b: Extract<Block, { kind: 'table' }>) {
    const { doc, th } = this;
    const total = b.widths.reduce((a, c) => a + c, 0);
    const widths = b.widths.map((w) => (w / total) * this.width);
    const padX = 7;
    const padY = 5;
    const size = th.size - 0.5;
    const rowHeight = (cells: string[], face: FontFace) =>
      Math.max(...cells.map((c, i) => this.height(c, face, size, widths[i]! - padX * 2))) +
      padY * 2;
    const drawRow = (cells: string[], header: boolean, shade: boolean) => {
      const face = header ? th.bold : th.body;
      const h = rowHeight(cells, face);
      if (doc.y + h > this.bottom) {
        doc.addPage();
        if (!header) drawRow(b.columns, true, false);
      }
      const y = doc.y;
      if (header)
        doc
          .save()
          .rect(this.left, y, this.width, h)
          .fill(th.header === 'centered' ? '#E9E4D8' : th.accent)
          .restore();
      else if (shade) doc.save().rect(this.left, y, this.width, h).fill(th.panel).restore();
      let x = this.left;
      cells.forEach((c, i) => {
        this.text(c, {
          face,
          size,
          color: header ? (th.header === 'centered' ? th.ink : '#FFFFFF') : th.ink,
          x: x + padX,
          y: y + padY,
          width: widths[i]! - padX * 2,
        });
        x += widths[i]!;
      });
      doc
        .moveTo(this.left, y + h)
        .lineTo(this.left + this.width, y + h)
        .lineWidth(0.4)
        .stroke(th.rule);
      doc.y = y + h;
    };
    this.ensure(60);
    drawRow(b.columns, true, false);
    b.rows.forEach((row, i) => drawRow(row, false, i % 2 === 1));
    doc.y += 10;
    doc.x = this.left;
  }

  finish() {
    const { doc, th, m } = this;
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      if (m.watermark) {
        doc.save();
        doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
        this.setFont(th.bold, 96);
        doc
          .fillColor('#000000')
          .fillOpacity(0.045)
          .text(m.watermark, 0, doc.page.height / 2 - 60, {
            width: doc.page.width,
            align: 'center',
            lineBreak: false,
          });
        doc.restore();
        doc.fillOpacity(1);
      }
      const y = doc.page.height - th.margin + 2;
      doc
        .moveTo(this.left, y - 6)
        .lineTo(this.left + this.width, y - 6)
        .lineWidth(0.4)
        .stroke(th.rule);
      const pageLabel = `Page ${i - range.start + 1} of ${range.count}`;
      this.setFont(th.body, 7.5);
      const pw = doc.widthOfString(pageLabel);
      this.text(m.footer, {
        face: th.body,
        size: 7.5,
        color: th.muted,
        x: this.left,
        y,
        width: this.width - pw - 16,
      });
      this.text(pageLabel, {
        face: th.body,
        size: 7.5,
        color: th.muted,
        x: this.left + this.width - pw - 2,
        y,
        width: pw + 2,
        align: 'right',
      });
      doc.page.margins.bottom = bottomMargin;
    }
  }
}

type ChatLineLike = Extract<Block, { kind: 'chat' }>['line'];
