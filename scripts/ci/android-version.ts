import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the Android APKs built in CI share: the app version each counts apart
 * from Boite's, and the certificate every update must carry.
 *
 * An app's `VERSION` holds MAJOR.MINOR, raised by hand; a rebuild takes the
 * next patch of the last published APK, or patch 0 when VERSION moved past it.
 */

/**
 * Every Boite APK is signed with one key, the one this file publishes for the
 * Trusted Web Activity Boite shipped before its native app: copies still
 * installed open full screen while the core serves it.
 */
export const ASSETLINKS = 'packages/ui/public/.well-known/assetlinks.json';

export interface AppVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Android keeps versionCode under 2100000000; three digits per part keep the order. */
const PART = 1000;

/** The MAJOR.MINOR a `VERSION` file holds. */
export function parseBase(text: string, file: string): { major: number; minor: number } {
  const match = /^(\d+)\.(\d+)$/.exec(text.trim());
  if (!match) throw new Error(`${file} must hold MAJOR.MINOR such as 1.0, got '${text.trim()}'`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  // Codes under 1000000 were the commit count of main; a lower code is an
  // update every installed app refuses.
  if (major < 1 || major > 999) throw new Error(`${file}: MAJOR must be 1 to 999, got ${major}`);
  if (minor >= PART) throw new Error(`${file}: MINOR must be under ${PART}, got ${minor}`);
  return { major, minor };
}

export function formatVersion({ major, minor, patch }: AppVersion): string {
  return `${major}.${minor}.${patch}`;
}

export function versionCode({ major, minor, patch }: AppVersion): number {
  if (minor >= PART || patch >= PART) {
    throw new Error(`${formatVersion({ major, minor, patch })}: MINOR and PATCH must stay under ${PART} to keep versionCode ordered`);
  }
  return major * PART * PART + minor * PART + patch;
}

/**
 * The version of a rebuilt APK. Same MAJOR.MINOR as the last published APK:
 * its patch plus one. VERSION raised, or no earlier app version: patch 0.
 */
export function nextVersion(base: { major: number; minor: number }, previous: AppVersion | null, file: string): AppVersion {
  let next: AppVersion = { ...base, patch: 0 };
  if (previous) {
    if (previous.major === base.major && previous.minor === base.minor) {
      next = { ...base, patch: previous.patch + 1 };
    } else if (previous.major > base.major || (previous.major === base.major && previous.minor > base.minor)) {
      throw new Error(`${file} holds ${base.major}.${base.minor}, below the published ${formatVersion(previous)}: phones would refuse the update`);
    }
  }
  versionCode(next);
  return next;
}

export interface Release {
  tag_name: string;
  draft: boolean;
  assets: { name: string }[];
}

export function digest(value: string): string {
  return value.replace(/[:\s]/g, '').toLowerCase();
}

/**
 * `Signer #1 certificate SHA-256 digest:` on build-tools 35, `V3.0 Signer:
 * certificate SHA-256 digest:` on 37. The first scheme printed is the one
 * every Android reads.
 */
export function signerDigest(printCerts: string): string | null {
  const match = /certificate SHA-256 digest:\s*([0-9a-fA-F:]+)/.exec(printCerts);
  return match ? digest(match[1]!) : null;
}

export function assetlinksDigest(json: string, packageName = 'com.boite.two'): string {
  const statements = JSON.parse(json) as { target?: { package_name?: string; sha256_cert_fingerprints?: string[] } }[];
  const target = statements.find((statement) => statement.target?.package_name === packageName)?.target;
  const fingerprint = target?.sha256_cert_fingerprints?.[0];
  if (!fingerprint) throw new Error(`${ASSETLINKS} names no certificate for ${packageName}`);
  return digest(fingerprint);
}

export function run(command: string[], quiet = false): { ok: boolean; out: string } {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: quiet ? 'pipe' : 'inherit' });
  return { ok: result.exitCode === 0, out: result.stdout.toString() };
}

export function buildTool(name: string): string {
  const home = process.env.ANDROID_HOME;
  if (!home) throw new Error('ANDROID_HOME is unset');
  const versions = readdirSync(join(home, 'build-tools')).sort((a, b) => Bun.semver.order(a, b));
  const newest = versions.at(-1);
  if (!newest) throw new Error(`no build-tools under ${home}`);
  return join(home, 'build-tools', newest, name);
}
