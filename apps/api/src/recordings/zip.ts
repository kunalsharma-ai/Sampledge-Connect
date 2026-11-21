import { crc32 } from 'node:zlib';
import type { Readable, Writable } from 'node:stream';

/**
 * A minimal streaming ZIP writer (store, no compression: recordings are already compressed).
 * Entries are written with data descriptors, so sizes and CRCs are computed while streaming
 * and nothing is buffered. No ZIP64: callers cap an archive below 4 GiB.
 */
export class ZipWriter {
  private offset = 0;
  private readonly entries: {
    name: Buffer;
    crc: number;
    size: number;
    offset: number;
    dosTime: number;
    dosDate: number;
  }[] = [];

  constructor(private readonly out: Writable) {}

  private async write(buf: Buffer) {
    this.offset += buf.length;
    if (!this.out.write(buf)) {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          this.out.off('error', fail);
          resolve();
        };
        const fail = (e: Error) => {
          this.out.off('drain', done);
          reject(e);
        };
        this.out.once('drain', done);
        this.out.once('error', fail);
      });
    }
  }

  async add(fileName: string, source: Readable | Buffer, modified = new Date()) {
    const name = Buffer.from(fileName, 'utf8');
    const { dosTime, dosDate } = toDos(modified);
    const start = this.offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0808, 6); // bit 3: data descriptor, bit 11: UTF-8 names
    header.writeUInt16LE(0, 8); // store
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    // crc / sizes are 0 here; they follow in the data descriptor
    header.writeUInt16LE(name.length, 26);
    await this.write(Buffer.concat([header, name]));

    let crc = 0;
    let size = 0;
    const chunks: AsyncIterable<Buffer> | Iterable<Buffer> = Buffer.isBuffer(source)
      ? [source]
      : source;
    for await (const chunk of chunks) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      crc = crc32(b, crc);
      size += b.length;
      await this.write(b);
    }
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(size, 8);
    desc.writeUInt32LE(size, 12);
    await this.write(desc);
    this.entries.push({ name, crc: crc >>> 0, size, offset: start, dosTime, dosDate });
  }

  async finish() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4); // made by
      h.writeUInt16LE(20, 6); // needed
      h.writeUInt16LE(0x0808, 8);
      h.writeUInt16LE(0, 10);
      h.writeUInt16LE(e.dosTime, 12);
      h.writeUInt16LE(e.dosDate, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.size, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      await this.write(Buffer.concat([h, e.name]));
    }
    const cdSize = this.offset - cdStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    await this.write(end);
    this.out.end();
  }
}

function toDos(d: Date) {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    dosTime: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** A name that is safe inside an archive and on every OS. */
export function safeName(s: string): string {
  return (
    s
      .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'file'
  );
}
