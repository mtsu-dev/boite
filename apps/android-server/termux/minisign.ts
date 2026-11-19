import { createPublicKey, verify, type KeyObject } from 'node:crypto';

interface Minisign { prehashed: boolean; key: KeyObject; signed: Buffer; comment: string; global: Buffer }

/** Tauri's base64-encoded Minisign packet, including the trusted comment signature, checked against the publisher key. */
export function readSignature(signature: string, publicKey: string): Minisign {
  const lines = Buffer.from(signature, 'base64').toString('utf8').trim().split('\n');
  const keyLines = Buffer.from(publicKey, 'base64').toString('utf8').trim().split('\n');
  const key = Buffer.from(keyLines[1] ?? '', 'base64');
  const packet = Buffer.from(lines[1] ?? '', 'base64');
  const comment = lines[2]?.replace(/^trusted comment: /, '');
  const global = Buffer.from(lines[3] ?? '', 'base64');
  if (key.length !== 42 || key.subarray(0, 2).toString() !== 'Ed' || packet.length !== 74
    || !key.subarray(2, 10).equals(packet.subarray(2, 10)) || lines.length !== 4
    || !lines[2]?.startsWith('trusted comment: ') || comment === undefined || global.length !== 64) {
    throw new Error('Update signature has an invalid Minisign packet or signing key');
  }
  const algorithm = packet.subarray(0, 2).toString();
  // Tauri also publishes legacy Ed packets; both formats authenticate the whole payload.
  if (algorithm !== 'ED' && algorithm !== 'Ed') throw new Error('Update signature algorithm must be Ed25519');
  const signingKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki' });
  return { prehashed: algorithm === 'ED', key: signingKey, signed: packet.subarray(10), comment, global };
}

/** `data` is the whole payload, or its BLAKE2b-512 digest for a prehashed packet. */
export function checkSignature(minisign: Minisign, data: Uint8Array): void {
  const { key, signed, comment, global } = minisign;
  if (!verify(null, data, key, signed) || !verify(null, Buffer.concat([signed, Buffer.from(comment)]), key, global)) {
    throw new Error('Update signature verification failed; the installation was left unchanged');
  }
}
