import { homedir, hostname } from 'node:os';
import { existsSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import type { Channel, Os } from '@boite/contracts';

export function currentOs(): Os {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

/**
 * What other machines and clients call this one: `BOITE_MACHINE_NAME`, else
 * the host name. Android tells every app its host is `localhost`, so the
 * phone's server names the phone itself.
 */
export function machineName(env: Record<string, string | undefined> = process.env): string {
  return env.BOITE_MACHINE_NAME?.trim().slice(0, 100) || hostname();
}

/**
 * The one directory name a channel owns, on every OS. The dev install writes
 * next to the stable one rather than into it, which is the whole point of the
 * channel: a beta build a user tries out cannot touch the journal, the accounts
 * or the managed installs of the app they work in.
 */
export function dataDirName(channel: Channel): string {
  return channel === 'dev' ? 'boite2-dev' : 'boite2';
}

export function defaultDataDir(
  channel: Channel = 'stable',
  os: Os = currentOs(),
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
  exists: (path: string) => boolean = existsSync,
): string {
  const name = dataDirName(channel);
  switch (os) {
    case 'windows': {
      const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
      return join(local, name);
    }
    case 'macos':
      return posix.join(home, 'Library', 'Application Support', name);
    default: {
      const dataHome = env.XDG_DATA_HOME;
      const legacy = posix.join(home, '.local', 'share', name);
      if (!dataHome || !posix.isAbsolute(dataHome)) return legacy;
      const directory = posix.join(dataHome, name);
      // An upgrade must not hide conversations stored before XDG support.
      return exists(posix.join(legacy, 'journal.db')) && !exists(posix.join(directory, 'journal.db')) ? legacy : directory;
    }
  }
}

/**
 * `--data-dir` first, then `BOITE_DATA_DIR`, then the channel's own default.
 * The channel only ever decides the last of the three: a run that names a
 * directory means it, whichever install started it.
 */
export function resolveDataDir(override?: string | undefined, channel: Channel = 'stable'): string {
  const fromEnv = process.env.BOITE_DATA_DIR;
  if (override && override.length > 0) return override;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return defaultDataDir(channel);
}

export function homePath(): string {
  return homedir();
}

/** A path as a person reads it: `~` for the home directory, `/` between segments. */
export function tildePath(path: string): string {
  const inside = relative(homePath(), path);
  if (inside.length > 0 && !inside.startsWith('..') && !/^[a-zA-Z]:/.test(inside)) return `~/${inside.split(sep).join('/')}`;
  return path.split(sep).join('/');
}

/** Everything a managed install of this provider owns: downloads, releases, the current link. */
export function providerAgentDir(dataDir: string, providerId: string): string {
  return join(dataDir, 'agents', providerId);
}

/**
 * What `{agentsDir}` becomes in a descriptor: the release a managed install
 * points at right now. A profile with an `install` block names its executable
 * under this, so the candidate resolves the moment the files land and resolves
 * to nothing before that.
 */
export function agentsDirPath(dataDir: string, providerId: string): string {
  return join(providerAgentDir(dataDir, providerId), 'current');
}

/**
 * What `{browserNoop}` becomes in a descriptor: a `BROWSER` value that takes a
 * URL and exits 0 without opening anything. An agent that would otherwise pop
 * the user's browser mid-turn is pointed at it, and the link it printed reaches
 * the user through Boite instead.
 *
 * Off Windows it is the script at `browserNoopPath`, written by `AccountStore`
 * before the first spawn. On Windows it is a Python `webbrowser` command line,
 * since a `.cmd` file cannot take a sign-in link: Python starts it through
 * `cmd.exe`, which splits the URL at every `&`, fails, and lets Python fall back
 * to the default browser. The `%s` makes Python split the value like a POSIX
 * shell (single quotes keep the backslashes), the URL arrives quoted so `cmd`
 * reads no `&` in it, and `exit 0` ends before anything else runs. The path
 * needs backslashes: `cmd` reads `C:/Windows` as switches.
 */
export function browserNoopCommand(
  dataDir: string,
  os: Os = currentOs(),
  env: Record<string, string | undefined> = process.env,
): string {
  if (os !== 'windows') return browserNoopPath(dataDir);
  const root = [env.SystemRoot, env.SYSTEMROOT, env.windir].find((value) => value !== undefined && /^[a-z]:\\[^'%"]*$/i.test(value)) ?? 'C:\\Windows';
  return `'${root.replace(/\\+$/, '')}\\System32\\cmd.exe' /d /c exit 0 '"%s"'`;
}

/** Where the script `{browserNoop}` names off Windows lives. */
export function browserNoopPath(dataDir: string): string {
  return join(dataDir, 'browser-noop.sh');
}

/** What that script holds: it ignores its argument and succeeds. */
export function browserNoopScript(): string {
  return '#!/bin/sh\nexit 0\n';
}

/**
 * What `{appdata}` becomes in a descriptor: Windows' roaming per-user directory,
 * where npm puts its global installs. Only a windows profile ever names the
 * token, so off Windows it expands to a path nothing exists at and a `file`
 * candidate using it simply loses to the next candidate.
 */
export function appDataPath(): string {
  if (currentOs() === 'windows') {
    const roaming = process.env.APPDATA;
    if (roaming !== undefined && roaming.length > 0) return roaming;
  }
  return join(homedir(), 'AppData', 'Roaming');
}
