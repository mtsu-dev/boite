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
    pick: 'Pick a file to see its diff',
    loading: 'Reading the working tree',
    renamedFrom: 'Renamed from {path}',
    /** A narrow panel shows the list or one diff: the way back, and the steps between files. */
    backToList: 'All changes',
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
