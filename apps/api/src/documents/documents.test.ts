import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MINUTES_TEMPLATES } from '@sampledge/contracts';
import { chatModel, chatText, minutesModel, type Brand } from './build.js';
import { renderDocx } from './docx.js';
import { renderPdf } from './pdf.js';
import { fontRuns, bundledFont } from './fonts.js';
import { imageInfo, readableAccent, textIsRtl } from './model.js';

const brand: Brand = {
  orgName: 'Northwind Research',
  appName: 'SampConnect',
  logo: null,
  brand: '#2563EB',
};
const start = new Date('2026-11-21T09:30:00Z');

const minutes = () =>
  minutesModel(
    {
      title: 'Q4 tracker kickoff',
      conversationName: '#q4-tracker',
      media: 'video',
      startedAt: start,
      endedAt: new Date(start.getTime() + 42 * 60_000),
      durationSec: 42 * 60,
      attendees: [
        { userId: 'u1', name: 'Priya Sharma', guest: false, minutes: 42 },
        { userId: 'u2', name: 'Zoë Łukasiewicz', guest: false, minutes: 40 },
        { userId: null, name: 'राहुल वर्मा', guest: true, minutes: 31 },
      ],
      agenda: 'Scope, sample plan, fieldwork dates.',
      summary:
        'The team agreed the Q4 scope. राहुल ने बताया कि सैंपल योजना सोमवार तक तैयार होगी. 会议决定下周二开始。 تم الاتفاق على الموعد.',
      decisions: [
        'Soft launch moves to Tuesday.',
        'Use the oncology panel from the German vendor.',
      ],
      actionItems: [
        {
          id: 'a1',
          text: 'Send the revised sample plan',
          ownerId: 'u2',
          ownerName: null,
          due: 'Monday',
          done: false,
        },
        {
          id: 'a2',
          text: 'Confirm incidence with the client',
          ownerId: null,
          ownerName: 'राहुल वर्मा',
          due: null,
          done: true,
        },
      ],
      openQuestions: ['What incidence should we assume for cardiologists?'],
      notes: '',
      language: 'en',
      sources: {
        transcripts: 1,
        reviewedTranscripts: 1,
        captionLines: 0,
        chatMessages: 4,
        spokenLanguages: ['hi', 'en'],
      },
      status: 'draft',
      updatedByName: 'Priya Sharma',
      updatedAt: start,
      sharedByName: null,
      ownerName: (id) => (id === 'u2' ? 'Zoë Łukasiewicz' : null),
      transcript: [
        {
          title: 'Transcript (Hindi)',
          note: 'Machine transcript from the call recording.',
          lines: [
            { at: '0:00', speaker: null, text: 'सभी का स्वागत है।' },
            { at: '0:04', speaker: null, text: 'Thanks everyone for joining.' },
          ],
        },
      ],
    },
    brand,
    'Asia/Kolkata',
    'Priya Sharma',
  );

const OUT = process.env.DOC_PREVIEW_DIR;

describe('documents', () => {
  it.each(MINUTES_TEMPLATES)('renders minutes as PDF and Word (%s)', async (template) => {
    const m = minutes();
    const pdf = await renderPdf(m, template);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
    const docx = await renderDocx(m, template);
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/minutes-${template}.pdf`, pdf);
      writeFileSync(`${OUT}/minutes-${template}.docx`, docx);
    }
  });

  it('exports chat as PDF, Word and text with day dividers', async () => {
    const input = {
      conversationName: '#q4-tracker',
      kindLabel: 'Public channel',
      memberCount: 6,
      from: null,
      to: null,
      exportedBy: 'Priya Sharma',
      exportedAt: start,
      truncated: false,
      language: 'en',
      lines: [
        { date: start, at: '15:00', who: 'Priya Sharma', text: 'Morning! Kickoff at 3.' },
        {
          date: new Date(start.getTime() + 60_000),
          at: '15:01',
          who: 'राहुल वर्मा (guest)',
          text: 'ठीक है, मैं तैयार हूँ।',
          files: ['sample-plan.xlsx'],
        },
        {
          date: new Date(start.getTime() + 86_400_000),
          at: '15:00',
          who: 'System',
          text: 'Video call ended · 42m 00s',
          system: true,
        },
      ],
    };
    const pdf = await renderPdf(chatModel(input, brand, 'Asia/Kolkata'), 'modern');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const docx = await renderDocx(chatModel(input, brand, 'Asia/Kolkata'), 'modern');
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    const txt = chatText(input, brand, 'Asia/Kolkata');
    expect(txt).toContain('[15:01] राहुल वर्मा (guest): ठीक है, मैं तैयार हूँ।');
    expect(txt).toContain('Attachment: sample-plan.xlsx');
    expect(txt.match(/^--- /gm)?.length).toBe(2);
    if (OUT) {
      writeFileSync(`${OUT}/chat.pdf`, pdf);
      writeFileSync(`${OUT}/chat.docx`, docx);
      writeFileSync(`${OUT}/chat.txt`, txt);
    }
  });

  it('splits text into font runs by script', () => {
    const runs = fontRuns('Hello Привет مرحبا', bundledFont('ui'), bundledFont('sans'));
    expect(runs.map((r) => r.text).join('')).toBe('Hello Привет مرحبا');
    // Inter has Latin and Cyrillic; Arabic falls back to DejaVu Sans.
    expect(runs.at(-1)!.font.path).toMatch(/DejaVuSans/);
  });

  it('detects direction, darkens light brand colours and reads image sizes', () => {
    expect(textIsRtl('مرحبا بالجميع')).toBe(true);
    expect(textIsRtl('123 Hello')).toBe(false);
    expect(readableAccent('#FDE047')).not.toBe('#FDE047');
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(120, 16);
    png.writeUInt32BE(40, 20);
    expect(imageInfo(png)).toMatchObject({ type: 'png', width: 120, height: 40 });
  });
});
