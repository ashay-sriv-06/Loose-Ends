// Image dimensions read from actual file bytes. File names are never consulted.

export interface Dimensions {
  width: number;
  height: number;
}

export function pngDimensions(buf: Buffer): Dimensions | null {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  if (buf.readUInt32BE(8) !== 13 || buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

export function jpegDimensions(buf: Buffer): Dimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  let guard = 0;
  while (i + 9 < buf.length && guard++ < 10000) {
    if (buf[i] !== 0xff) return null;
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < buf.length) {
      i++;
      marker = buf[i + 1];
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    if (marker === 0xda || marker === 0xd9) return null;
    i += 2 + len;
  }
  return null;
}
