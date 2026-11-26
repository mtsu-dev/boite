const BASE85_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';
const BASE85_VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE85_ALPHABET.length; i++) BASE85_VALUE[BASE85_ALPHABET.charCodeAt(i)] = i;

const MAX_VERIFY_BYTES = 16 * 1024 * 1024;
const ADLER_MOD = 65521;
const WINDOW_SIZE = 32768;
const WINDOW_MASK = WINDOW_SIZE - 1;

const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15] as const;
const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
] as const;
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
] as const;
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
] as const;
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
] as const;

interface HuffmanTree {
  counts: Int32Array;
  symbols: Int32Array;
  maxBits: number;
}

function buildTree(lengths: readonly number[] | Uint8Array): HuffmanTree | null {
  const counts = new Int32Array(16);
  let maxBits = 0;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!;
    if (len > 15) return null;
    if (len > 0) {
      counts[len] = counts[len]! + 1;
      if (len > maxBits) maxBits = len;
    }
  }
  if (maxBits === 0) return { counts, symbols: new Int32Array(0), maxBits: 0 };
  let left = 1;
  for (let bits = 1; bits <= maxBits; bits++) {
    left = (left << 1) - counts[bits]!;
    if (left < 0) return null;
  }
  const offsets = new Int32Array(16);
  let total = 0;
  for (let bits = 1; bits <= maxBits; bits++) {
    offsets[bits] = total;
    total += counts[bits]!;
  }
  const symbols = new Int32Array(total);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym]!;
    if (len > 0) symbols[offsets[len]!++] = sym;
  }
  return { counts, symbols, maxBits };
}

let fixedLitLen: HuffmanTree | null = null;
let fixedDist: HuffmanTree | null = null;

function fixedTrees(): { litLen: HuffmanTree; dist: HuffmanTree } {
  if (!fixedLitLen || !fixedDist) {
    const lit = new Uint8Array(288);
    lit.fill(8, 0, 144);
    lit.fill(9, 144, 256);
    lit.fill(7, 256, 280);
    lit.fill(8, 280, 288);
    const dst = new Uint8Array(32).fill(5);
    fixedLitLen = buildTree(lit)!;
    fixedDist = buildTree(dst)!;
  }
  return { litLen: fixedLitLen, dist: fixedDist };
}

function lineDecodedBytes(text: string): number {
  if (text.length < 6) return 0;
  const code = text.charCodeAt(0);
  const bytes = code >= 65 && code <= 90 ? code - 64
    : code >= 97 && code <= 122 ? code - 96 + 26
    : 0;
  if (bytes === 0 || text.length !== 1 + Math.ceil(bytes / 4) * 5) return 0;
  return bytes;
}

/** Validate a single Git base85 binary patch data line's length prefix and alphabet. */
export function isGitBase85Line(text: string): boolean {
  if (lineDecodedBytes(text) === 0) return false;
  for (let i = 1; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 128 || BASE85_VALUE[code] === -1) return false;
  }
  return true;
}

function decodeGitBase85(lines: readonly string[]): Uint8Array | null {
  let total = 0;
  for (const line of lines) {
    const bytes = lineDecodedBytes(line);
    if (bytes === 0) return null;
    total += bytes;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const line of lines) {
    let left = lineDecodedBytes(line);
    for (let i = 1; i < line.length; i += 5) {
      let acc = 0;
      for (let j = 0; j < 5; j++) {
        const code = line.charCodeAt(i + j);
        const digit = code < 128 ? BASE85_VALUE[code]! : -1;
        if (digit < 0) return null;
        acc = acc * 85 + digit;
      }
      if (acc > 0xffffffff) return null;
      for (let shift = 24; shift >= 0 && left > 0; shift -= 8, left--) {
        out[pos++] = (acc >>> shift) & 0xff;
      }
    }
  }
  return out;
}

/**
 * Verify that `data` is a complete RFC 1950 zlib stream decompressing to
 * exactly `expectedSize` bytes with a valid Adler-32 checksum, using only a
 * fixed 32 KiB sliding window.
 */
function verifyZlibStream(data: Uint8Array, expectedSize: number): boolean {
  if (data.length < 6) return false;
  const cmf = data[0]!;
  const flg = data[1]!;
  if ((cmf & 0x0f) !== 8 || (cmf >> 4) > 7) return false;
  if (((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20) !== 0) return false;

  const end = data.length - 4;
  let bytePos = 2;
  let bitBuf = 0;
  let bitCount = 0;

  function readBits(n: number): number {
    while (bitCount < n) {
      if (bytePos >= end) return -1;
      bitBuf |= data[bytePos++]! << bitCount;
      bitCount += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return val;
  }

  function decodeSymbol(tree: HuffmanTree): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= tree.maxBits; len++) {
      const bit = readBits(1);
      if (bit < 0) return -1;
      code = (code << 1) | bit;
      const count = tree.counts[len]!;
      if (code - count < first) return tree.symbols[index + (code - first)]!;
      index += count;
      first = (first + count) << 1;
    }
    return -1;
  }

  const window = new Uint8Array(WINDOW_SIZE);
  let totalOut = 0;
  let s1 = 1;
  let s2 = 0;

  function emit(byte: number): boolean {
    if (totalOut >= expectedSize) return false;
    window[totalOut & WINDOW_MASK] = byte;
    totalOut++;
    s1 = (s1 + byte) % ADLER_MOD;
    s2 = (s2 + s1) % ADLER_MOD;
    return true;
  }

  let bfinal = 0;
  while (bfinal === 0) {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (bfinal < 0 || btype < 0 || btype === 3) return false;

    if (btype === 0) {
      bitBuf = 0;
      bitCount = 0;
      if (bytePos + 4 > end) return false;
      const len = data[bytePos]! | (data[bytePos + 1]! << 8);
      const nlen = data[bytePos + 2]! | (data[bytePos + 3]! << 8);
      bytePos += 4;
      if ((len ^ nlen) !== 0xffff || bytePos + len > end) return false;
      for (let i = 0; i < len; i++) {
        if (!emit(data[bytePos++]!)) return false;
      }
      continue;
    }

    let litLen: HuffmanTree;
    let dist: HuffmanTree;
    if (btype === 1) {
      ({ litLen, dist } = fixedTrees());
    } else {
      const hlit = readBits(5);
      const hdist = readBits(5);
      const hclen = readBits(4);
      if (hlit < 0 || hdist < 0 || hclen < 0) return false;
      const nLit = hlit + 257;
      const nDist = hdist + 1;
      if (nLit > 286 || nDist > 30) return false;
      const clLengths = new Uint8Array(19);
      for (let i = 0; i < hclen + 4; i++) {
        const len = readBits(3);
        if (len < 0) return false;
        clLengths[CL_ORDER[i]!] = len;
      }
      const clTree = buildTree(clLengths);
      if (!clTree || clTree.maxBits === 0) return false;
      const all = new Uint8Array(nLit + nDist);
      let idx = 0;
      while (idx < all.length) {
        const sym = decodeSymbol(clTree);
        if (sym < 0) return false;
        if (sym < 16) {
          all[idx++] = sym;
        } else {
          let repeat: number;
          let value = 0;
          if (sym === 16) {
            if (idx === 0) return false;
            const extra = readBits(2);
            if (extra < 0) return false;
            repeat = 3 + extra;
            value = all[idx - 1]!;
          } else if (sym === 17) {
            const extra = readBits(3);
            if (extra < 0) return false;
            repeat = 3 + extra;
          } else {
            const extra = readBits(7);
            if (extra < 0) return false;
            repeat = 11 + extra;
          }
          if (idx + repeat > all.length) return false;
          all.fill(value, idx, idx + repeat);
          idx += repeat;
        }
      }
      const builtLit = buildTree(all.subarray(0, nLit));
      const builtDist = buildTree(all.subarray(nLit));
      if (!builtLit || !builtDist || builtLit.maxBits === 0) return false;
      litLen = builtLit;
      dist = builtDist;
    }

    for (; ;) {
      const sym = decodeSymbol(litLen);
      if (sym < 0) return false;
      if (sym < 256) {
        if (!emit(sym)) return false;
      } else if (sym === 256) {
        break;
      } else {
        const lenIdx = sym - 257;
        if (lenIdx >= LEN_BASE.length) return false;
        const lenExtra = LEN_EXTRA[lenIdx]!;
        const lenAdd = lenExtra ? readBits(lenExtra) : 0;
        if (lenAdd < 0) return false;
        const length = LEN_BASE[lenIdx]! + lenAdd;
        const distSym = decodeSymbol(dist);
        if (distSym < 0 || distSym >= DIST_BASE.length) return false;
        const distExtra = DIST_EXTRA[distSym]!;
        const distAdd = distExtra ? readBits(distExtra) : 0;
        if (distAdd < 0) return false;
        const distance = DIST_BASE[distSym]! + distAdd;
        if (distance > totalOut || distance > WINDOW_SIZE) return false;
        for (let i = 0; i < length; i++) {
          if (!emit(window[(totalOut - distance) & WINDOW_MASK]!)) return false;
        }
      }
    }
  }

  if (bytePos !== end || totalOut !== expectedSize) return false;
  const expected = ((data[end]! << 24) | (data[end + 1]! << 16) | (data[end + 2]! << 8) | data[end + 3]!) >>> 0;
  const actual = (((s2 << 16) | s1) >>> 0);
  return actual === expected;
}

/**
 * Verify a Git binary patch hunk (`literal <size>` or `delta <size>`) decodes
 * from valid Git base85 into a complete zlib stream of `expectedSize` bytes.
 */
export function isCompleteGitBinaryHunk(lines: readonly string[], expectedSize: number, terminated: boolean): boolean {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) return false;
  if (expectedSize > MAX_VERIFY_BYTES) return terminated;
  const decoded = decodeGitBase85(lines);
  return decoded !== null && verifyZlibStream(decoded, expectedSize);
}
