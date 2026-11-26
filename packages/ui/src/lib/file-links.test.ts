import { expect, test } from 'vitest';
import { fileChipHtml, fileKind, foreignPath, markCollisions } from './file-links';

test('a chip names the file, keeps the written path for hover and copy, and picks its icon by kind', () => {
  const host = document.createElement('div');
  host.innerHTML = fileChipHtml('N:\\dev\\orbitkit\\orbitkit-setup.exe', 'N:\\dev\\orbitkit\\orbitkit-setup.exe', 'N:\\dev\\orbitkit\\orbitkit-setup.exe', undefined);
  const chip = host.querySelector<HTMLAnchorElement>('a.file-chip')!;
  expect(chip.querySelector('.file-chip-name')?.textContent).toBe('orbitkit-setup.exe');
  expect(chip.title).toBe('N:\\dev\\orbitkit\\orbitkit-setup.exe');
  expect(chip.dataset.source).toBe('N:\\dev\\orbitkit\\orbitkit-setup.exe');
  expect(chip.dataset.kind).toBe('program');
  // A Markdown link keeps the agent's words, with nothing hidden to copy instead.
  host.innerHTML = fileChipHtml('the notes', 'notes.md', 'notes.md', 4);
  expect(host.textContent).toBe('the notes');
  expect(host.querySelector<HTMLElement>('a')!.dataset).toMatchObject({ filePath: 'notes.md', fileLine: '4', kind: 'doc' });
  expect(host.querySelector<HTMLElement>('a')!.dataset.source).toBeUndefined();
  expect(['src/', 'shot.PNG', 'run.ps1', 'Makefile', 'a.tar.gz', 'lib.rs', 'LICENSE', 'docs'].map(fileKind)).toEqual(['folder', 'image', 'program', 'code', 'archive', 'code', 'doc', 'folder']);
});

test('only a drive path in a thread on Linux or macOS belongs to the computer showing the chat', () => {
  expect(foreignPath('N:\\dev\\game.exe', 'linux')).toBe(true);
  expect(foreignPath('c:/dev/game.exe', 'macos')).toBe(true);
  expect(foreignPath('N:\\dev\\game.exe', 'windows')).toBe(false);
  expect(foreignPath('/srv/game', 'linux')).toBe(false);
  expect(foreignPath('N:\\dev\\game.exe', undefined)).toBe(false);
});

test('two chips of one name and different folders show their folder, the same file twice does not', () => {
  const host = document.createElement('div');
  host.innerHTML = [
    fileChipHtml('src/index.ts', 'src/index.ts', 'src/index.ts', undefined),
    fileChipHtml('test/index.ts', 'test/index.ts', 'test/index.ts', undefined),
    fileChipHtml('lib/app.ts', 'lib/app.ts', 'lib/app.ts', 2),
    fileChipHtml('lib/app.ts', 'lib/app.ts', 'lib/app.ts', 9),
    fileChipHtml('app/src/main.ts', 'app/src/main.ts', 'app/src/main.ts', undefined),
    fileChipHtml('web/src/main.ts', 'web/src/main.ts', 'web/src/main.ts', undefined)
  ].join(' ');
  markCollisions(host);
  const chips = [...host.querySelectorAll('a.file-chip')];
  expect(chips.map(chip => chip.classList.contains('collide'))).toEqual([true, true, false, false, true, true]);
  // One folder is not enough when both sit in a `src`: as many show as tell them apart.
  expect(chips.map(chip => chip.querySelector('.file-chip-dir')?.textContent)).toEqual(['src/', 'test/', 'lib/', 'lib/', 'app/src/', 'web/src/']);
});
