import { describe, expect, it } from 'vitest';
import { decisionTitle, shortPath } from './decision-title';

const bash = (command: string) => decisionTitle('Bash', { command });

describe('decisionTitle', () => {
  it('names a push by the branch it sends', () => {
    expect(bash('git push -u origin orbit/csv-import')).toBe('Push orbit/csv-import');
    expect(bash('cd /repo && git push origin HEAD:main')).toBe('Push main');
    expect(bash('git push')).toBe('Push the branch');
    expect(bash('git -C /repo push origin fix')).toBe('Push fix');
  });

  it('lets a preparing git verb give way to the act that follows it', () => {
    expect(bash('git add -A && git commit -m "Import"')).toBe('Commit the changes');
    expect(bash('git add src/a.ts')).toBe('Stage a.ts');
    expect(bash('git status')).toBe('Run git status');
  });

  it('reads past variables, wrappers and setup words', () => {
    expect(bash('NODE_ENV=test sudo rm -rf dist 2> /dev/null')).toBe('Delete dist');
    expect(bash('export CI=1; bun run test:unit')).toBe('Run the tests');
    expect(bash('npm install')).toBe('Install the dependencies');
    expect(bash('bun add zod')).toBe('Install zod');
    expect(bash('curl -sL https://example.com/x.tar.gz -o x.tar.gz')).toBe('Download from example.com');
    expect(bash('gh pr create --fill')).toBe('Open a pull request');
  });

  it('names an unknown program and falls back only on an empty command', () => {
    expect(bash('/usr/bin/terraform apply')).toBe('Run terraform');
    expect(bash('')).toBe('Run a command');
    expect(bash('cd /repo')).toBe('Run a command');
    expect(decisionTitle('shell', { command: ['git', 'push', 'origin', 'main'] })).toBe('Push main');
  });

  it('names an edit by its project path', () => {
    expect(decisionTitle('Edit', { file_path: '/home/me/orbit/src/lib/upload.ts', old_string: 'a', new_string: 'b' })).toBe('Edit src/lib/upload.ts');
    expect(decisionTitle('Write', { file_path: '/tmp/notes/today.md', content: '' })).toBe('Create tmp/notes/today.md');
    expect(decisionTitle('ApplyPatch', { grantRoot: '/repo' })).toBe('Write files in /repo from now on');
  });

  it('keeps the sentence for every other kind of tool', () => {
    expect(decisionTitle('WebFetch', { url: 'https://docs.example.com/a' })).toBe('Open docs.example.com');
    expect(decisionTitle('mcp__x__y', { a: 1 })).toBe('Use its mcp__x__y tool');
  });
});

describe('shortPath', () => {
  it('keeps a path from its source folder, or its last three parts', () => {
    expect(shortPath('C:\\repo\\packages\\ui\\src\\App.svelte')).toBe('packages/ui/src/App.svelte');
    expect(shortPath('/a/b/c/d/e.ts')).toBe('c/d/e.ts');
    expect(shortPath('README.md')).toBe('README.md');
  });
});
