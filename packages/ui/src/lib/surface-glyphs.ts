import { Activity, AppWindow, Cpu, FileText, FolderTree, GitCompare, Globe, LampDesk, ListChecks, MessageSquare, MessagesSquare, Puzzle, Smartphone, UsersRound } from '@lucide/svelte';
import type { Component } from 'svelte';
import type { SurfaceKind } from './right-panel.svelte';

type Glyph = Component<{ size?: number; strokeWidth?: number }>;

/** The icon of a kind of surface: its tab, its launcher card and its line in the "+" menu. Both browsers share the globe. */
const GLYPHS: Partial<Record<SurfaceKind, Glyph>> = {
  desk: LampDesk,
  // A chip, not Activity's inbox: the processes a thread runs on its machine.
  trace: Cpu,
  agents: UsersRound,
  messages: MessageSquare,
  changes: GitCompare,
  files: FolderTree,
  file: FileText,
  device: Smartphone,
  window: AppWindow,
  tasks: ListChecks,
  council: MessagesSquare,
  plugin: Puzzle
};

export function surfaceGlyph(kind: SurfaceKind): Glyph {
  return GLYPHS[kind] ?? Globe;
}
