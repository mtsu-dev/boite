import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ASSETLINKS, assetlinksDigest, nextVersion, parseBase, signerDigest, versionCode } from './android-version.ts';

const FILE = 'apps/example/VERSION';

test('a rebuild takes the next patch, a raised VERSION patch 0, a lower one is refused', () => {
  const base = parseBase('1.0\n', FILE);
  expect(nextVersion(base, null, FILE)).toEqual({ major: 1, minor: 0, patch: 0 });
  expect(nextVersion(base, { major: 1, minor: 0, patch: 3 }, FILE)).toEqual({ major: 1, minor: 0, patch: 4 });
  expect(nextVersion(parseBase('1.1', FILE), { major: 1, minor: 0, patch: 3 }, FILE)).toEqual({ major: 1, minor: 1, patch: 0 });
  // A VERSION below the published app would be an update phones refuse.
  expect(() => nextVersion(base, { major: 1, minor: 2, patch: 0 }, FILE)).toThrow(`${FILE} holds 1.0, below the published 1.2.0`);
});

test('the version code orders every app version above the old commit counts', () => {
  expect(versionCode({ major: 1, minor: 0, patch: 0 })).toBe(1_000_000);
  expect(versionCode({ major: 1, minor: 2, patch: 3 })).toBe(1_002_003);
  expect(versionCode({ major: 1, minor: 0, patch: 999 })).toBeLessThan(versionCode({ major: 1, minor: 1, patch: 0 }));
  expect(() => versionCode({ major: 1, minor: 0, patch: 1000 })).toThrow('under 1000');
  expect(() => nextVersion(parseBase('1.0', FILE), { major: 1, minor: 0, patch: 999 }, FILE)).toThrow('under 1000');
  expect(() => parseBase('1.1000', FILE)).toThrow('MINOR must be under 1000');
  expect(() => parseBase('0.9', FILE)).toThrow('MAJOR must be 1 to 999');
  expect(() => parseBase('1.0.0', FILE)).toThrow(`${FILE} must hold MAJOR.MINOR`);
});

test('the signer is read from apksigner, and the served assetlinks.json names the certificate', () => {
  expect(signerDigest('Signer #1 certificate SHA-256 digest: 3cf11e0fAB\n')).toBe('3cf11e0fab');
  expect(signerDigest('V3.0 Signer: certificate SHA-256 digest: 3C:F1:1E\n')).toBe('3cf11e');
  expect(signerDigest('DOES NOT VERIFY\n')).toBeNull();
  expect(assetlinksDigest(readFileSync(ASSETLINKS, 'utf8'))).toMatch(/^[0-9a-f]{64}$/);
  expect(() => assetlinksDigest('[]')).toThrow('names no certificate');
});
