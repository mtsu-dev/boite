import { basename, dirname, join } from 'node:path';

export type UpdateCommand = (command: string, args: string[]) => Promise<string>;

export interface AndroidServerInstallation {
  root: string;
  executable: string;
  controller: string;
  channel: 'stable' | 'nightly';
}
export interface AndroidServerUpdatePlatform {
  inspect(dataDir: string): Promise<AndroidServerInstallation | null>;
  check(run: UpdateCommand, installation: AndroidServerInstallation, current: string): Promise<{ version: string; channel: 'stable' | 'nightly' } | null>;
  launch(run: UpdateCommand, installation: AndroidServerInstallation, plan: string): Promise<void>;
}

/**
 * The link to the worker's executable that its recovery runs. It sits beside
 * the operation directory, which a finished worker deletes, and outside the
 * installation, which the worker moves.
 */
export const recoveryLink = (plan: string): string => {
  const operation = dirname(plan);
  return join(dirname(operation), basename(operation).replace('.boite-update-', '.boite-recover-'));
};

export interface ServerInstallation {
  directory: string;
  executable: string;
  service: string;
}

/** Native service integration is supplied by ProcessPlatform; tests use an isolated service. */
export interface ServerUpdatePlatform {
  inspect(run: UpdateCommand): Promise<ServerInstallation | null>;
  launch(run: UpdateCommand, executable: string, plan: string): Promise<void>;
  control(service: string, action: 'start' | 'stop'): Promise<void>;
  mainPid(service: string): Promise<number>;
  /** The maintenance lock a rollback and a start that finishes one hold; see `FileLock` in `restore.ts`. */
  lock(file: string): () => void;
}

export interface ServerUpdatePlan {
  id: string;
  installation: ServerInstallation;
  dataDir: string;
  version: string;
  previousVersion: string;
  originalPid: number;
  healthUrl: string;
  archiveHash: string;
}
