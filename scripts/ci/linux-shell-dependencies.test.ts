import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const available = process.platform === 'linux' && Bun.which('apt-get') && Bun.which('gpg');
const packages = ['libwebkit2gtk-4.1-dev', 'libayatana-appindicator3-dev', 'librsvg2-dev', 'patchelf', 'xvfb', 'dbus-x11', 'xdg-utils'];
const workflow = Bun.YAML.parse(readFileSync(join(import.meta.dir, '../../.github/workflows/desktop.yml'), 'utf8')) as {
  jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
};
const step = workflow.jobs['portable-linux-x64']!.steps.find(s => s.name === 'Install Linux shell dependencies')!.run!;

function fixture(format: 'list' | 'sources', failure?: 'unavailable' | 'signature' | 'unresolvable') {
  const root = mkdtempSync(join(tmpdir(), 'boite-linux-apt-'));
  const command = (args: string[]) => {
    const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode) throw new Error(result.stderr.toString());
    return result.stdout;
  };
  try {
    const sources = join(root, 'etc');
    const repo = join(root, 'ubuntu');
    const keyHome = join(root, 'keys');
    // The fallback reads every suite of the release: stable carries the packages.
    const suites = ['stable', 'stable-updates', 'stable-backports', 'stable-security'];
    for (const path of [sources, `${sources}/sources.list.d`, `${root}/config-parts`, `${root}/trusted.gpg.d`, keyHome, ...suites.map(suite => `${repo}/dists/${suite}/main/binary-amd64`), `${root}/lists/partial`, `${root}/archives/partial`]) mkdirSync(path, { recursive: true });
    const gpg = (...args: string[]) => command(['gpg', '--homedir', keyHome, '--batch', '--pinentry-mode', 'loopback', '--passphrase', '', ...args]);
    gpg('--quick-generate-key', 'APT fixture <fixture@example.invalid>', 'ed25519', 'sign', '0');
    const key = join(root, 'fixture.asc');
    writeFileSync(key, gpg('--armor', '--export'));
    // The fallback list names no key: it trusts the system keyring, here the fixture's.
    writeFileSync(`${root}/trusted.gpg.d/fixture.asc`, readFileSync(key));
    const packaged = packages.map(name => `Package: ${name}\nVersion: 1.0\nArchitecture: amd64\nDescription: fixture\nFilename: pool/${name}.deb\nSize: 1\nSHA256: ${'0'.repeat(64)}\n`).join('\n');
    const release = `${repo}/dists/stable/Release`;
    for (const suite of suites) {
      const index = suite === 'stable' ? packaged : '';
      writeFileSync(`${repo}/dists/${suite}/main/binary-amd64/Packages`, index);
      const file = `${repo}/dists/${suite}/Release`;
      writeFileSync(file, `Origin: Ubuntu\nSuite: ${suite}\nCodename: ${suite}\nDate: ${new Date().toUTCString()}\nArchitectures: amd64\nComponents: main\nSHA256:\n ${createHash('sha256').update(index).digest('hex')} ${Buffer.byteLength(index)} main/binary-amd64/Packages\n`);
      gpg('--armor', '--output', `${file}.gpg`, '--detach-sign', file);
    }
    if (failure === 'signature') writeFileSync(release, readFileSync(release, 'utf8').replace('Origin: Ubuntu', 'Origin: changed'));
    // The image's mirror during an outage: the apt-get wrapper below answers for it.
    const uri = failure === 'unresolvable' ? 'http://boite-fixture.invalid/ubuntu'
      : `file:${failure === 'unavailable' ? `${root}/missing-ubuntu` : repo}`;
    writeFileSync(`${root}/os-release`, 'VERSION_CODENAME=stable\n');
    const ubuntu = format === 'list' ? `${sources}/sources.list` : `${sources}/sources.list.d/ubuntu.sources`;
    writeFileSync(ubuntu, format === 'list' ? `deb [signed-by=${key}] ${uri} stable main\n`
      : `Types: deb\nURIs: ${uri}\nSuites: stable\nComponents: main\nSigned-By: ${key}\n`);
    if (format === 'sources') writeFileSync(`${sources}/sources.list`, '# Ubuntu sources moved to ubuntu.sources\n');
    // A real APT failure from an unrelated runner feed, without network access.
    writeFileSync(`${sources}/sources.list.d/microsoft.list`, `deb [signed-by=${key}] file:${root}/missing-microsoft stable main\n`);
    writeFileSync(`${root}/status`, '');
    const config = `${root}/apt.conf`;
    writeFileSync(config, `Dir::Etc::sourcelist "${sources}/sources.list";\nDir::Etc::sourceparts "${sources}/sources.list.d";\nDir::Etc::parts "${root}/config-parts";\nDir::Etc::main "-";\nDir::State::lists "${root}/lists";\nDir::State::status "${root}/status";\nDir::Cache::archives "${root}/archives";\nDir::Cache::pkgcache "${root}/pkgcache.bin";\nDir::Cache::srcpkgcache "${root}/srcpkgcache.bin";\nDir::Log "${root}";\nDir::Etc::trusted "${root}/trusted.gpg";\nDir::Etc::trustedparts "${root}/trusted.gpg.d";\nAPT::Architecture "amd64";\nAcquire::Languages "none";\n`);
    // Execute the workflow verbatim except its machine paths, Ubuntu's archive hosts and
    // components, and its privilege boundary. Only installation and the unresolvable
    // mirror's DNS answer are simulated; index acquisition and signatures use real APT.
    const script = `sudo() { "$@"; }
apt-get() {
  local arg list=
  for arg in "$@"; do
    if [ "$arg" = install ]; then command apt-get --simulate "$@"; return; fi
    case "$arg" in Dir::Etc::sourcelist=*) list=\${arg#*=} ;; esac
  done
  if [ -n "$list" ] && grep -q boite-fixture.invalid "$list"; then
    echo "Err:1 http://boite-fixture.invalid/ubuntu stable InRelease"
    echo "  Temporary failure resolving 'boite-fixture.invalid'"
    return 100
  fi
  command apt-get "$@"
}
${step.replaceAll('/etc/apt', sources).replaceAll('/etc/os-release', `${root}/os-release`)
    .replace(/http:\/\/(?:archive|security|ports)\.ubuntu\.com\/ubuntu(?:-ports)?/g, `file:${repo}`)
    .replace("components='main restricted universe multiverse'", "components='main'")}`;
    const result = Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', script], {
      env: { ...process.env, APT_CONFIG: config }, stdout: 'pipe', stderr: 'pipe',
    });
    return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
  } finally {
    Bun.spawnSync(['gpgconf', '--homedir', join(root, 'keys'), '--kill', 'gpg-agent'], { stdout: 'ignore', stderr: 'ignore' });
    rmSync(root, { recursive: true, force: true });
  }
}

for (const format of ['list', 'sources'] as const) {
  test.skipIf(!available)(`Linux shell dependencies use signed Ubuntu ${format === 'list' ? 'legacy' : 'deb822'} sources despite an unavailable Microsoft feed`, () => {
    const result = fixture(format);
    expect(result.output).not.toContain('missing-microsoft');
    expect(result.code, result.output).toBe(0);
    for (const name of packages) expect(result.output).toContain(`Inst ${name} `);
  });
}

test.skipIf(!available)('Linux shell dependency setup still fails on unavailable or invalidly signed Ubuntu sources', () => {
  for (const failure of ['unavailable', 'signature'] as const) {
    const result = fixture('sources', failure);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain(failure === 'unavailable' ? 'missing-ubuntu' : 'BADSIG');
    expect(result.output).not.toContain('Inst ');
  }
});

test.skipIf(!available)('Linux shell dependencies fall back to Ubuntu\'s archive when the image mirror does not resolve', () => {
  const result = fixture('sources', 'unresolvable');
  expect(result.output).toContain('boite-fixture.invalid');
  expect(result.output).not.toContain('missing-microsoft');
  expect(result.code, result.output).toBe(0);
  for (const name of packages) expect(result.output).toContain(`Inst ${name} `);
});
