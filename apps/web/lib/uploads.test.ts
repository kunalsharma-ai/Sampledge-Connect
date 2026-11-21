import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '@sampledge/contracts';
import { formatBytes, rejectReason } from './uploads';

const file = (name: string, size: number, type = 'application/octet-stream') =>
  ({ name, size, type }) as File;

describe('rejectReason', () => {
  it('accepts ordinary documents and images', () => {
    expect(rejectReason(file('Q3 bid.pdf', 2_000_000, 'application/pdf'))).toBeNull();
    expect(rejectReason(file('site.JPG', 300_000, 'image/jpeg'))).toBeNull();
  });
  it('refuses blocked types, empty files and files over the cap', () => {
    expect(rejectReason(file('setup.EXE', 10))).toMatch(/not allowed/);
    expect(rejectReason(file('notes.txt', 0))).toMatch(/empty/);
    expect(rejectReason(file('big.zip', MAX_ATTACHMENT_BYTES + 1))).toMatch(/100 MB/);
  });
});

describe('formatBytes', () => {
  it('uses human units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(250 * 1024)).toBe('250 KB');
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
  });
});
