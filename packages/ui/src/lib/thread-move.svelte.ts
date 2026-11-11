import { threadActive, type ProjectId, type ThreadId, type ThreadSummary } from '@boite/contracts';
import { Closing } from './closing.svelte';
import { confirm } from './confirm.svelte';
import { focusedElement, restoreFocus } from './focus';
import { projectName } from './format';
import type { MenuItem } from './menu';
import { startPointerDrag, type DragGrip } from './pointer-drag';
import { projectRow, type ProjectRow } from './project-rows';
import { fill, strings } from './strings';
import type { Store } from './store.svelte';
import type { Machine } from './workspace.svelte';

/** What a thread row carries while it is dragged: the machine it lives on, so a drop elsewhere is ignored. */
export interface ThreadDrag {
  machineId: string;
  threadId: ThreadId;
  projectId: ProjectId | null;
}

/** The card that follows the mouse: the row's look, its width, and where the mouse took it. */
export interface DragGhost extends DragGrip {
  title: string;
  providerId: string;
}

/**
 * The row being dragged, and the project section it would drop on, keyed as
 * `dropKey` gives it: the section draws its outline from it. The ghost, the
 * mouse and the target's name draw the card that follows the mouse.
 */
export const threadDrag = $state<{
  current: ThreadDrag | null;
  over: string | null;
  target: string | null;
  ghost: DragGhost | null;
  x: number;
  y: number;
}>({ current: null, over: null, target: null, ghost: null, x: 0, y: 0 });

/** A project section's key while a row hovers it. */
export function dropKey(machineId: string, projectId: ProjectId): string {
  return `${machineId}:${projectId}`;
}

/** Whether a drop of the dragged row on this project would move it. */
export function takesDrop(drag: ThreadDrag | null, machineId: string, projectId: ProjectId): boolean {
  return drag !== null && drag.machineId === machineId && drag.projectId !== projectId;
}

/** A project section a row can land on: its machine, its id, and the name the card shows. */
interface DropTarget {
  machineId: string;
  projectId: ProjectId;
  name: string;
}

/** The project section or idle project row under a point, from its own data: each marks itself with `data-thread-drop`. */
function sectionAt(x: number, y: number): DropTarget | null {
  const section = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-thread-drop][data-project-id][data-machine-id]');
  const projectId = section?.dataset['projectId'], machineId = section?.dataset['machineId'];
  return projectId && machineId !== undefined ? { machineId, projectId: projectId as ProjectId, name: section?.dataset['projectName'] ?? '' } : null;
}

/**
 * Drags a thread row with the mouse onto another project's section, from the
 * row's `pointerdown` (`pointer-drag.ts` says why pointer events). A press
 * that does not travel stays a click; Escape cancels. `look` is what the card
 * that follows the mouse shows of the row.
 */
export function startThreadDrag(event: PointerEvent, store: Store, drag: ThreadDrag, look: { title: string; providerId: string }): void {
  startPointerDrag(event, {
    rootClass: 'thread-dragging',
    begin: (grip) => {
      threadDrag.ghost = { ...look, ...grip };
      threadDrag.current = drag;
    },
    aim: (x, y) => {
      threadDrag.x = x;
      threadDrag.y = y;
      const at = sectionAt(x, y);
      const lands = at !== null && takesDrop(drag, at.machineId, at.projectId);
      threadDrag.over = lands ? dropKey(at.machineId, at.projectId) : null;
      threadDrag.target = lands ? at.name : null;
    },
    end: (drop) => {
      threadDrag.current = null;
      threadDrag.over = null;
      threadDrag.target = null;
      threadDrag.ghost = null;
      const target = drop && sectionAt(drop.x, drop.y);
      if (target && takesDrop(drag, target.machineId, target.projectId)) void moveThread(store, drag.threadId, target.projectId);
    },
  });
}

function find(store: Store, threadId: ThreadId): ThreadSummary | null {
  return store.threads.find((t) => t.id === threadId) ?? (store.openThread?.id === threadId ? store.openThread : null);
}

/** The threads a move takes, the core's rule: an ordinary, kept conversation inside a project, not a sub-thread. */
export type Movable = Pick<ThreadSummary, 'projectId' | 'parentThreadId' | 'agentSessionId' | 'archived' | 'incognito'>;

/**
 * Whether the thread can change project at all: a persistent agent's session
 * and a thread outside any project have no project to leave, a sub-thread
 * moves with its parent. Every menu and the drag read this one rule.
 */
export function canMove(thread: Movable): boolean {
  return !thread.parentThreadId && !thread.agentSessionId && thread.projectId !== null && !thread.archived && !thread.incognito;
}

/**
 * Whether a sub-thread of this thread works. The core refuses the move then:
 * the parent's turn end is no moment to move a thread whose child still runs.
 * The thread's own turn is no reason: its move waits for the turn to end.
 */
export function moveBlocked(store: Store, threadId: ThreadId): boolean {
  return store.moveBlocked(threadId);
}

/**
 * The picker's rows: every project of the thread's machine, an archived one
 * marked, the thread's own checked; picking that one moves nothing. None when
 * the machine has no other project, and the picker says so.
 */
export function moveTargets(store: Store, thread: Pick<ThreadSummary, 'projectId'>, machine: Machine): ProjectRow[] {
  if (!store.projects.some((p) => p.id !== thread.projectId)) return [];
  return store.projects.map((p) => projectRow(p, machine, {
    several: false,
    active: p.id === thread.projectId,
    label: p.archived === true ? fill(strings.threadMove.archivedProject, { project: projectName(p) }) : projectName(p),
  }));
}

/**
 * The one way the UI moves a thread (row menu, title menu, drag). A running
 * turn asks first and the move waits for the turn to end; a second move
 * replaces the waiting one. Background work asks too: stop it with the move,
 * or keep it running in the old folder until the agent's next turn starts in
 * the new one. The target project unfolds so the row stays in sight.
 */
export async function moveThread(store: Store, threadId: ThreadId, projectId: ProjectId): Promise<boolean> {
  const thread = find(store, threadId);
  if (!thread || thread.projectId === projectId) return false;
  if (moveBlocked(store, threadId)) {
    store.error = strings.threadMove.stopFirst;
    return false;
  }
  const target = store.projects.find((p) => p.id === projectId);
  const names = { folder: thread.cwd, project: target ? projectName(target) : projectId };
  const running = threadActive(thread.status);
  const kinds = [thread, ...store.threads.filter((t) => t.parentThreadId === threadId)].flatMap((t) => t.backgroundWork?.kinds ?? []);
  let stopBackground: boolean | undefined;
  if (kinds.length > 0) {
    const monitors = kinds.every((kind) => kind === 'monitor');
    const choice = await confirm.choose({
      title: running ? strings.threadMove.runningTitle : monitors ? strings.threadMove.monitorsTitle : strings.threadMove.backgroundTitle,
      body: fill(running ? strings.threadMove.runningBackgroundBody : strings.threadMove.backgroundBody, names),
      confirmLabel: monitors ? strings.threadMove.stopMonitors : strings.threadMove.stopWork,
      altLabel: strings.threadMove.keep,
      cancelLabel: strings.common.cancel,
      danger: true,
    });
    if (choice === 'cancel') return false;
    stopBackground = choice === 'confirm';
  } else if (running) {
    const go = await confirm.ask({
      title: strings.threadMove.runningTitle,
      body: fill(strings.threadMove.runningBody, names),
      confirmLabel: strings.threadMove.runningConfirm,
      cancelLabel: strings.common.cancel,
    });
    if (!go) return false;
  }
  const moved = await store.move(threadId, projectId, stopBackground);
  if (moved === null) return false;
  if (store.isCollapsed(projectId)) store.toggleProject(projectId);
  return true;
}

/** What the move picker (`MoveProjectPicker.svelte`) lists for: the thread, on its own machine's store. */
export interface MoveRequest {
  store: Store;
  threadId: ThreadId;
  projectId: ProjectId | null;
  /** Where the keyboard goes back when the picker closes without a move. */
  returnTo: HTMLElement | null;
}

/**
 * The one "Move to project" picker of the app: the project search the draft's
 * "Change project" opens, with the thread's own project checked. The request
 * outlives the close, so the exit plays on the same rows.
 */
class MovePicker {
  readonly popover = new Closing();
  request = $state<MoveRequest | null>(null);

  open(request: MoveRequest): void {
    this.request = request;
    this.popover.show();
  }

  /**
   * However it closes, the keyboard goes back to what opened the menu: left
   * on the page, the next Escape would stop the thread's running turn.
   */
  close(): void {
    this.popover.hide();
    restoreFocus(this.request?.returnTo ?? null);
  }

  /** A pick of a row: the move and its questions, or nothing for the thread's own project. */
  pick(projectId: ProjectId): void {
    const request = this.request;
    this.popover.hide();
    if (!request) return;
    restoreFocus(request.returnTo);
    void moveThread(request.store, request.threadId, projectId);
  }
}

export const movePicker = new MovePicker();

/**
 * The project picker, opened from a pick of a thread menu. It opens where the
 * command palette does, inside the window on a computer and a phone; `anchor`,
 * the trigger of the menu it came from, gets the keyboard back.
 */
export function openMovePicker(store: Store, thread: Pick<ThreadSummary, 'id' | 'projectId'>, anchor?: HTMLElement | null): void {
  movePicker.open({ store, threadId: thread.id, projectId: thread.projectId, returnTo: anchor ?? focusedElement() });
}

/**
 * The move rows of a thread menu: "Move to project", out while a sub-thread
 * works, and "Cancel move" while a move waits for the turn to end. The menu
 * picks them as `move` and `move-cancel`; `pickMoveItem` answers both.
 */
export function moveItems(store: Store, thread: Pick<ThreadSummary, 'id' | 'pendingMove'>): MenuItem[] {
  const blocked = moveBlocked(store, thread.id);
  const move: MenuItem = { id: 'move', label: strings.threadMove.moveTo, disabled: blocked, ...(blocked ? { title: strings.threadMove.stopFirst } : {}) };
  return thread.pendingMove ? [move, { id: 'move-cancel', label: strings.threadMove.cancelMove }] : [move];
}

/** Answers a pick of `moveItems`' rows; false for any other row. */
export function pickMoveItem(store: Store, thread: Pick<ThreadSummary, 'id' | 'projectId'>, action: string, anchor?: HTMLElement | null): boolean {
  if (action === 'move') openMovePicker(store, thread, anchor);
  else if (action === 'move-cancel') void store.cancelMove(thread.id);
  else return false;
  return true;
}

/** The "Moves to <project> after this turn" line, or null. */
export function pendingLine(thread: Pick<ThreadSummary, 'pendingMove'>): string | null {
  return thread.pendingMove ? fill(strings.threadMove.pending, { project: thread.pendingMove.project }) : null;
}
