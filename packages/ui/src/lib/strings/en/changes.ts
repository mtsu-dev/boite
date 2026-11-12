export const strings = {

  /** The changes surface: `git status` of the thread's working directory. */
  changes: {
    clean: 'Working tree clean',
    noBranch: 'No branch',
    ahead: '{count} ahead',
    behind: '{count} behind',
    /** How many files a count of changes covers (`lib/change-count.ts`): "1 file, +7 −2". */
    files: '{count} files',
    oneFile: '1 file',
    staged: 'Staged',
    binary: 'Binary file, nothing to show line by line',
    truncated: 'This file was cut short: the diff below is not the whole file.',
    loading: 'Reading the working tree',
    renamedFrom: 'Renamed from {path}',
    /** The toolbar's chip: every changed file, a pick scrolls the diff to it. */
    fileList: 'Changed files',
    status: {
      added: 'Added',
      modified: 'Modified',
      deleted: 'Deleted',
      renamed: 'Renamed',
      copied: 'Copied',
      untracked: 'Untracked',
      conflict: 'Conflict'
    }
  }
} as const;
