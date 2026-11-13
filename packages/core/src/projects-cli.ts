/**
 * `boite projects`: list the projects and add a folder as one, from the owner's
 * terminal (`projects.add`, on the core `--core` names) or from an agent's thread
 * (`agent.addProject`, on this machine or with `--machine` another of the group).
 */
import { isAbsolute, resolve } from 'node:path';
import type { CoreClient } from './client.ts';
import { requiredText, Usage, type Parsed } from './cli-args.ts';
import type { Caller } from './control-cli.ts';

type Printer = (lines: string[], value: unknown) => void;

export async function projectsCommand(client: CoreClient, caller: Caller, threadId: string, parsed: Parsed, cwd: string, print: Printer): Promise<void> {
  const rest = parsed.positional.slice(1);
  const named = parsed.name === undefined ? {} : { name: parsed.name };
  const here = (folder: string) => isAbsolute(folder) ? folder : resolve(cwd, folder);
  if (caller === 'owner' && threadId === '') {
    if (rest.length > 0 && rest[0] !== 'add') throw new Usage(`projects: unknown action ${rest[0]}`);
    if (rest[0] === 'add') {
      if (parsed.machine !== undefined) throw new Usage('projects add --machine is for an agent in a thread; from a terminal, reach that machine with --core');
      const folder = requiredText(rest, 1, 'projects add needs a folder');
      // With --core the folder is that machine's: sent as written, and that core checks it.
      const project = await client.call('projects.add', { path: parsed.core === undefined ? here(folder) : folder, ...named });
      print([`project: ${project.id}`, `name: ${project.name}`, `path: ${project.path}`, `git: ${project.repository ? 'yes' : 'no'}`], project);
      return;
    }
    const projects = await client.call('projects.list', {});
    print(projects.filter(p => p.archived !== true).map(p => `${p.id} ${JSON.stringify(p.name)} ${p.path}${p.repository ? '' : ' no-git'}${p.kind === 'drafts' ? ' drafts' : ''}`), projects);
    return;
  }
  if (rest.length > 0) {
    if (rest[0] !== 'add') throw new Usage(`projects: unknown action ${rest[0]}`);
    const folder = rest.slice(1).join(' ').trim();
    if (folder.length === 0) throw new Usage('projects add needs a folder');
    // Another machine's folder is a path there: it is sent as written, and that machine checks it.
    const remote = parsed.machine;
    const project = await client.call('agent.addProject', {
      threadId, path: remote === undefined ? here(folder) : folder, ...named, ...(remote === undefined ? {} : { machine: remote }),
    });
    const there = project.machine;
    print([
      `project: ${project.id}`, `name: ${project.name}`, `path: ${project.path}`, `git: ${project.repository ? 'yes' : 'no'}`,
      ...(there === undefined ? [] : [`machine: ${there}`]),
      there === undefined
        ? (project.added
          ? (project.entrusted === true ? 'Added and entrusted to you. boite thread new accepts it by name, id or folder.' : 'Added. boite thread new and boite thread move accept it by name, id or folder.')
          // A bot gains no project by naming its folder: the owner entrusts one that already exists.
          : (project.entrusted === false ? `Already a project; nothing changed, and it is not entrusted to you. Ask with boite settings mochi request projects +${JSON.stringify(project.name)} --why <reason>` : 'Already a project; nothing changed.'))
        : (project.added ? `Added on ${there}. boite thread new --machine ${there} accepts it by name, id or folder.` : `Already a project on ${there}; nothing changed.`),
    ], project);
    return;
  }
  const projects = await client.call('agent.projects', { threadId });
  print(projects.map(p => `${p.id} ${JSON.stringify(p.name)} ${p.path}${p.current ? ' (this thread)' : ''}${p.repository ? '' : ' no-git'}${p.drafts ? ' drafts' : ''}`), projects);
}
