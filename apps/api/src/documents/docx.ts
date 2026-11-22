import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type IBorderOptions,
  type ParagraphChild,
} from 'docx';
import type { MinutesTemplate } from '@sampledge/contracts';
import { textIsRtl, theme, type Block, type ChatLine, type DocModel, type Theme } from './model.js';

/** A4 text width in twentieths of a point for a margin in points. */
const pageTwips = (marginPt: number) => Math.round((595.28 - marginPt * 2) * 20);
const hex = (c: string) => c.replace('#', '').toUpperCase();
const pt = (n: number) => Math.round(n * 2); // docx sizes are half-points
const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = {
  top: NONE,
  bottom: NONE,
  left: NONE,
  right: NONE,
  insideHorizontal: NONE,
  insideVertical: NONE,
};

/**
 * Renders the document model as a Word file. Word handles every script and right-to-left
 * text on the reader's computer, so this is the format to edit and to use for languages the
 * server has no PDF font for.
 */
export async function renderDocx(model: DocModel, template: MinutesTemplate): Promise<Buffer> {
  const th = theme(template, model.brand);
  const r = new DocxRenderer(th, model);
  const children = [...r.header(), ...model.blocks.flatMap((b) => r.block(b))];
  const doc = new Document({
    creator: model.author,
    title: model.title,
    subject: model.subject,
    description: model.footer,
    styles: {
      default: {
        document: {
          run: { font: th.wordBody, size: pt(th.size + 0.5), color: hex(th.ink) },
          paragraph: { spacing: { after: 80 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 260 } } },
            },
          ],
        },
        {
          reference: 'numbers',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 300 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: Math.round(th.margin * 20),
              bottom: Math.round(th.margin * 20),
              left: Math.round(th.margin * 20),
              right: Math.round(th.margin * 20),
            },
          },
        },
        headers: { default: r.pageHeader() },
        footers: { default: r.pageFooter() },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

class DocxRenderer {
  private readonly width: number;
  constructor(
    private readonly th: Theme,
    private readonly m: DocModel,
  ) {
    this.width = pageTwips(th.margin);
  }

  private run(
    text: string,
    o: {
      bold?: boolean;
      size?: number;
      color?: string;
      font?: string;
      italics?: boolean;
      caps?: boolean;
      spacing?: number;
    } = {},
  ) {
    return new TextRun({
      text,
      bold: o.bold,
      italics: o.italics,
      allCaps: o.caps,
      size: o.size ? pt(o.size) : undefined,
      color: o.color ? hex(o.color) : undefined,
      font: o.font,
      characterSpacing: o.spacing,
      rightToLeft: textIsRtl(text) || undefined,
    });
  }

  private para(
    children: ParagraphChild[],
    o: {
      align?: 'left' | 'center' | 'right';
      after?: number;
      before?: number;
      text?: string;
      numbering?: 'bullets' | 'numbers';
      indent?: number;
      keepNext?: boolean;
      border?: 'bottom' | 'left';
    } = {},
  ) {
    const rtl = o.text ? textIsRtl(o.text) : false;
    const align =
      o.align === 'center'
        ? AlignmentType.CENTER
        : o.align === 'right'
          ? AlignmentType.RIGHT
          : rtl
            ? AlignmentType.RIGHT
            : AlignmentType.LEFT;
    return new Paragraph({
      children,
      alignment: align,
      bidirectional: rtl || undefined,
      spacing: { after: o.after ?? 80, before: o.before ?? 0 },
      numbering: o.numbering ? { reference: o.numbering, level: 0 } : undefined,
      indent: o.indent ? { left: o.indent } : undefined,
      keepNext: o.keepNext,
      border:
        o.border === 'bottom'
          ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(this.th.rule), space: 4 } }
          : o.border === 'left'
            ? { left: { style: BorderStyle.SINGLE, size: 12, color: hex(this.th.rule), space: 8 } }
            : undefined,
    });
  }

  private logo(heightPx: number) {
    const l = this.m.logo;
    if (!l) return null;
    const width = Math.round(Math.min(200, (l.width / l.height) * heightPx));
    return new ImageRun({
      type: l.type,
      data: l.data,
      transformation: { width, height: Math.round(heightPx) },
    });
  }

  pageHeader() {
    const th = this.th;
    const left = `${this.m.orgName}`;
    const right = this.m.watermark ? `${this.m.watermark} · ${this.m.eyebrow}` : this.m.eyebrow;
    return new Header({
      children: [
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: this.width }],
          children: [
            this.run(left, { size: 8, color: th.muted }),
            new TextRun({ text: '\t' }),
            this.run(right, {
              size: 8,
              color: this.m.watermark ? '#B42318' : th.muted,
              bold: !!this.m.watermark,
            }),
          ],
        }),
      ],
    });
  }

  pageFooter() {
    const th = this.th;
    return new Footer({
      children: [
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: this.width }],
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: hex(th.rule), space: 4 } },
          children: [
            this.run(this.m.footer, { size: 7.5, color: th.muted }),
            new TextRun({ text: '\t' }),
            new TextRun({
              children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
              size: pt(7.5),
              color: hex(th.muted),
            }),
          ],
        }),
      ],
    });
  }

  header(): (Paragraph | Table)[] {
    const { th, m } = this;
    const out: (Paragraph | Table)[] = [];
    if (th.header === 'band') {
      const logo = this.logo(36);
      const cell = new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: '0F172A' },
        margins: { top: 240, bottom: 240, left: 280, right: 280 },
        borders: {
          top: NONE,
          bottom: { style: BorderStyle.SINGLE, size: 24, color: hex(th.accent) },
          left: NONE,
          right: NONE,
        },
        children: [
          this.para(
            [
              this.run(m.eyebrow, {
                size: 8.5,
                color: '#94A3B8',
                bold: true,
                caps: true,
                spacing: 24,
              }),
            ],
            { after: 60 },
          ),
          this.para(
            [
              this.run(m.title, {
                size: th.titleSize,
                color: '#FFFFFF',
                bold: true,
                font: th.wordTitle,
              }),
            ],
            { after: 60, text: m.title },
          ),
          this.para([this.run(m.subtitle, { size: 10, color: '#CBD5E1' })], { after: 0 }),
        ],
      });
      const cells = [cell];
      if (logo)
        cells.push(
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: '0F172A' },
            borders: {
              top: NONE,
              bottom: { style: BorderStyle.SINGLE, size: 24, color: hex(th.accent) },
              left: NONE,
              right: NONE,
            },
            margins: { top: 240, bottom: 240, left: 120, right: 280 },
            width: { size: 2400, type: WidthType.DXA },
            children: [this.para([logo], { align: 'right', after: 0 })],
          }),
        );
      out.push(
        new Table({
          width: { size: this.width, type: WidthType.DXA },
          borders: NO_BORDERS,
          rows: [new TableRow({ children: cells })],
        }),
        this.para([], { after: 160 }),
      );
      out.push(...this.facts(3));
      return out;
    }
    if (th.header === 'compact') {
      out.push(
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: this.width }],
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 12, color: hex(th.accent), space: 4 },
          },
          spacing: { after: 120 },
          children: [
            this.run(m.title, { size: th.titleSize, bold: true, font: th.wordTitle }),
            new TextRun({ text: '\t' }),
            this.run(`${m.orgName} · ${m.subtitle}`, { size: 8.5, color: th.muted }),
          ],
        }),
      );
      if (m.facts.length)
        out.push(
          this.para(
            [
              this.run(m.facts.map(([k, v]) => `${k}: ${v}`).join('   ·   '), {
                size: th.size,
                color: th.muted,
              }),
            ],
            { after: 160 },
          ),
        );
      return out;
    }
    if (th.header === 'centered') {
      const logo = this.logo(44);
      if (logo) out.push(this.para([logo], { align: 'center', after: 120 }));
      out.push(
        this.para([this.run(m.orgName, { size: 9, color: th.muted, caps: true, spacing: 40 })], {
          align: 'center',
          after: 80,
        }),
        this.para([this.run(m.eyebrow, { size: 11, color: th.muted, italics: true })], {
          align: 'center',
          after: 40,
        }),
        this.para([this.run(m.title, { size: th.titleSize, bold: true, font: th.wordTitle })], {
          align: 'center',
          after: 60,
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          border: { bottom: { style: BorderStyle.DOUBLE, size: 6, color: hex(th.ink), space: 8 } },
          children: [this.run(m.subtitle, { size: 10, color: th.muted })],
        }),
      );
      out.push(...this.facts(1));
      return out;
    }
    // brand
    const logo = this.logo(32);
    out.push(
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 36, color: hex(th.accent), space: 12 } },
        spacing: { after: 240 },
        children: [
          ...(logo ? [logo, new TextRun({ text: '   ' })] : []),
          this.run(m.orgName, { bold: true, size: 10 }),
        ],
      }),
      this.para(
        [this.run(m.eyebrow, { size: 8.5, bold: true, color: th.accent, caps: true, spacing: 28 })],
        { after: 40 },
      ),
      this.para([this.run(m.title, { size: th.titleSize, bold: true, font: th.wordTitle })], {
        after: 60,
        text: m.title,
      }),
      this.para([this.run(m.subtitle, { size: 10.5, color: th.muted })], { after: 200 }),
    );
    out.push(...this.facts(2));
    return out;
  }

  private facts(cols: number): (Paragraph | Table)[] {
    const { th, m } = this;
    if (!m.facts.length) return [];
    if (cols === 1) {
      const rows = m.facts.map(
        ([k, v]) =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: 2200, type: WidthType.DXA },
                borders: { top: NONE, left: NONE, right: NONE, bottom: NONE },
                children: [this.para([this.run(k, { bold: true })], { after: 40 })],
              }),
              new TableCell({
                width: { size: this.width - 2200, type: WidthType.DXA },
                borders: { top: NONE, left: NONE, right: NONE, bottom: NONE },
                children: [this.para([this.run(v)], { after: 40, text: v })],
              }),
            ],
          }),
      );
      return [
        new Table({ width: { size: this.width, type: WidthType.DXA }, borders: NO_BORDERS, rows }),
        this.para([], { after: 120, border: 'bottom' }),
      ];
    }
    const rows: TableRow[] = [];
    const cellW = Math.floor(this.width / cols);
    for (let i = 0; i < m.facts.length; i += cols) {
      const slice = m.facts.slice(i, i + cols);
      while (slice.length < cols) slice.push(['', '']);
      rows.push(
        new TableRow({
          children: slice.map(
            ([k, v]) =>
              new TableCell({
                width: { size: cellW, type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, color: 'auto', fill: hex(th.panel) },
                margins: { top: 100, bottom: 100, left: 160, right: 160 },
                borders: { top: NONE, left: NONE, right: NONE, bottom: NONE },
                children: [
                  this.para(
                    [
                      this.run(k, {
                        size: 7.5,
                        bold: true,
                        color: th.muted,
                        caps: true,
                        spacing: 16,
                      }),
                    ],
                    { after: 20 },
                  ),
                  this.para([this.run(v, { bold: true })], { after: 0, text: v }),
                ],
              }),
          ),
        }),
      );
    }
    return [
      new Table({ width: { size: this.width, type: WidthType.DXA }, borders: NO_BORDERS, rows }),
      this.para([], { after: 160 }),
    ];
  }

  private heading(text: string): Paragraph {
    const th = this.th;
    if (th.heading === 'caps')
      return this.para(
        [
          this.run(text, {
            bold: true,
            size: th.headingSize,
            color: th.accent,
            caps: true,
            spacing: 26,
          }),
        ],
        {
          before: 240,
          after: 100,
          keepNext: true,
          text,
        },
      );
    if (th.heading === 'rule')
      return this.para([this.run(text, { bold: true, size: th.headingSize, font: th.wordTitle })], {
        before: 240,
        after: 120,
        keepNext: true,
        border: 'bottom',
        text,
      });
    if (th.heading === 'inline')
      return this.para([this.run(text, { bold: true, size: th.headingSize, color: th.accent })], {
        before: 140,
        after: 60,
        keepNext: true,
        text,
      });
    return new Paragraph({
      keepNext: true,
      spacing: { before: 260, after: 100 },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: hex(th.accent), space: 8 } },
      children: [this.run(text, { bold: true, size: th.headingSize })],
    });
  }

  block(b: Block): (Paragraph | Table)[] {
    const th = this.th;
    switch (b.kind) {
      case 'heading':
        return [this.heading(b.text)];
      case 'paragraph':
        return b.text.split('\n').map((line) =>
          this.para(
            [
              this.run(line, {
                color: b.muted ? th.muted : undefined,
                size: b.muted ? th.size - 0.5 : undefined,
              }),
            ],
            {
              after: 100,
              text: line,
            },
          ),
        );
      case 'list':
        return b.items.map((item, i) =>
          b.style === 'check'
            ? this.para(
                [this.run(b.checked?.[i] ? '☑  ' : '☐  ', { color: th.accent }), this.run(item)],
                {
                  after: 60,
                  indent: 120,
                  text: item,
                },
              )
            : this.para([this.run(item)], {
                after: 60,
                numbering: b.style === 'number' ? 'numbers' : 'bullets',
                text: item,
              }),
        );
      case 'table':
        return [this.table(b), this.para([], { after: 120 })];
      case 'day':
        return [
          this.para(
            [this.run(b.text, { bold: true, size: 8.5, color: th.muted, caps: true, spacing: 16 })],
            {
              align: 'center',
              before: 200,
              after: 100,
            },
          ),
        ];
      case 'chat':
        return this.chat(b.line);
      case 'transcript':
        return [
          this.heading(b.title),
          ...(b.note
            ? [
                this.para(
                  [this.run(b.note, { size: th.size - 1, color: th.muted, italics: true })],
                  { after: 120 },
                ),
              ]
            : []),
          ...b.lines.map(
            (l) =>
              new Paragraph({
                tabStops: [{ type: TabStopType.LEFT, position: 900 }],
                indent: { left: 900, hanging: 900 },
                spacing: { after: 40 },
                bidirectional: textIsRtl(l.text) || undefined,
                children: [
                  this.run(l.at, { size: th.size - 1.5, color: th.muted }),
                  new TextRun({ text: '\t' }),
                  ...(l.speaker ? [this.run(`${l.speaker}: `, { bold: true })] : []),
                  this.run(l.text),
                ],
              }),
          ),
        ];
      case 'pageBreak':
        return [new Paragraph({ pageBreakBefore: true, children: [] })];
    }
  }

  private chat(l: ChatLine): Paragraph[] {
    const th = this.th;
    const out: Paragraph[] = [];
    if (l.system)
      out.push(
        this.para(
          [
            this.run(`${l.at}  ·  ${l.text}`, {
              size: th.size - 1,
              color: th.muted,
              italics: true,
            }),
          ],
          {
            after: 80,
            indent: 160,
          },
        ),
      );
    else {
      out.push(
        this.para(
          [
            this.run(l.who, { bold: true }),
            this.run(`   ${l.at}${l.edited ? ' (edited)' : ''}`, {
              size: th.size - 1.5,
              color: th.muted,
            }),
          ],
          { after: 20, keepNext: true },
        ),
      );
      for (const line of l.text.split('\n'))
        out.push(this.para([this.run(line)], { after: 20, indent: 160, text: line }));
    }
    for (const f of l.files ?? [])
      out.push(
        this.para([this.run(`Attachment: ${f}`, { size: th.size - 1.5, color: th.accent })], {
          after: 20,
          indent: 160,
        }),
      );
    if (l.transcript)
      out.push(
        this.para(
          [
            this.run('Transcript  ', { bold: true, size: th.size - 2, color: th.muted }),
            this.run(l.transcript, { size: th.size - 1, color: th.muted }),
          ],
          { after: 40, indent: 320, border: 'left', text: l.transcript },
        ),
      );
    if (out.length) out.push(this.para([], { after: 60 }));
    return out;
  }

  private table(b: Extract<Block, { kind: 'table' }>): Table {
    const th = this.th;
    const total = b.widths.reduce((a, c) => a + c, 0);
    const widths = b.widths.map((w) => Math.floor((w / total) * this.width));
    const headerFill = th.header === 'centered' ? 'E9E4D8' : hex(th.accent);
    const cell = (text: string, i: number, header: boolean, shade: boolean) =>
      new TableCell({
        width: { size: widths[i]!, type: WidthType.DXA },
        shading: header
          ? { type: ShadingType.CLEAR, color: 'auto', fill: headerFill }
          : shade
            ? { type: ShadingType.CLEAR, color: 'auto', fill: hex(th.panel) }
            : undefined,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: {
          top: NONE,
          left: NONE,
          right: NONE,
          bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(th.rule) },
        },
        children: [
          this.para(
            [
              this.run(text, {
                bold: header,
                size: th.size - 0.5,
                color: header ? (th.header === 'centered' ? th.ink : '#FFFFFF') : undefined,
              }),
            ],
            { after: 0, text },
          ),
        ],
      });
    return new Table({
      width: { size: this.width, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          tableHeader: true,
          children: b.columns.map((c, i) => cell(c, i, true, false)),
        }),
        ...b.rows.map(
          (r, ri) =>
            new TableRow({
              cantSplit: true,
              children: r.map((c, i) => cell(c, i, false, ri % 2 === 1)),
            }),
        ),
      ],
    });
  }
}
