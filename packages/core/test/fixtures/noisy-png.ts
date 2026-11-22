import { crc32, deflateSync } from 'node:zlib';

/** A deterministic RGB PNG, with noise by default so its wire size tracks its dimensions. */
export function noisyPng(width: number, height: number, options: { flat?: boolean; compressionLevel?: number } = {}): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const stride = width * 3 + 1;
  const rows = Buffer.alloc(stride * height);
  let seed = width * 31 + height;
  for (let at = 0; at < rows.length; at += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    rows[at] = options.flat || at % stride === 0 ? 0 : seed >> 23;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: options.compressionLevel })),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}
