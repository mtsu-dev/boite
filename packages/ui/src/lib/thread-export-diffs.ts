const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const NO_NEWLINE = '\\ No newline at end of file';
const GIT_HEADER = /^(?:index [\da-f]+\.\.[\da-f]+(?: \d+)?|(?:(?:old|new|new file|deleted file) mode) \d+|(?:dis)?similarity index \d+%|(?:rename|copy) (?:from|to) .+|Binary files .+ differ)$/;

function hunkEnd(lines: string[], start: number): number {
  const header = HUNK.exec(lines[start] ?? '');
  if (!header) return start;
  let before = Number(header[1] ?? 1);
  let after = Number(header[2] ?? 1);
  let end = start + 1;
  while (before > 0 || after > 0) {
    const prefix = lines[end]?.[0];
    if (prefix === ' ' || prefix === '-') before--;
    if (prefix === ' ' || prefix === '+') after--;
    if (prefix !== ' ' && prefix !== '-' && prefix !== '+') return start;
    if (before < 0 || after < 0) return start;
    end++;
    if (lines[end] === NO_NEWLINE) end++;
  }
  return end;
}

function patchEnd(lines: string[], start: number): number {
  if (lines[start] === '*** Begin Patch') {
    const end = lines.indexOf('*** End Patch', start + 1);
    return end === -1 ? start : end + 1;
  }
  let end = start;
  const git = lines[start]?.startsWith('diff --git ');
  if (git) {
    end++;
    while (GIT_HEADER.test(lines[end] ?? '')) end++;
  }
  if (lines[end]?.startsWith('--- ') && lines[end + 1]?.startsWith('+++ ')) {
    const firstHunk = end + 2;
    end = hunkEnd(lines, firstHunk);
    if (end === firstHunk) return start;
    for (let next = hunkEnd(lines, end); next > end; next = hunkEnd(lines, end)) end = next;
    return end;
  }
  return git && end > start + 1 ? end : start;
}

/** A hunk's counts distinguish a context line from an indented log after it. */
export function extractToolPatches(value: string | null | undefined): { patches: string[]; rest: string } {
  if (!value || !/^(?:diff --git |--- |\*\*\* Begin Patch\r?$)/m.test(value)) return { patches: [], rest: value ?? '' };
  const lines = value.split(/\r?\n/);
  const patches: string[] = [];
  const rest: string[] = [];
  for (let start = 0; start < lines.length;) {
    const end = patchEnd(lines, start);
    if (end === start) rest.push(lines[start++]!);
    else {
      patches.push(lines.slice(start, end).join('\n'));
      start = end;
    }
  }
  return { patches, rest: patches.length ? rest.join('\n').trim() : value };
}
