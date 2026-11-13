import { Activity, Archive, Brain, ChartColumn, Cpu, FlaskConical, Gauge, GitBranch, Globe, KeyRound, Keyboard, MessagesSquare, Mic, Monitor, Palette, Puzzle, SlidersHorizontal, Smartphone, Stethoscope, Wrench } from '@lucide/svelte';
import type { SettingsTab } from './settings-tabs';

/**
 * One lucide icon a Settings entry, the desktop's nav and the phone's rows
 * alike (a list of words alone was slow to scan). One family, one
 * size and one stroke where they are drawn (`SETTINGS_ICON_SIZE`).
 */
export const SETTINGS_ICONS: Record<Exclude<SettingsTab, 'home'> | 'conversations' | 'phone' | 'archived' | 'worktrees', typeof Palette> = {
  general: SlidersHorizontal,
  appearance: Palette,
  keyboard: Keyboard,
  voice: Mic,
  accounts: KeyRound,
  plugins: Puzzle,
  browser: Globe,
  brain: Brain,
  limits: Gauge,
  usage: ChartColumn,
  machines: Monitor,
  advanced: Wrench,
  experiments: FlaskConical,
  diagnostics: Stethoscope,
  resources: Cpu,
  'task-manager': Activity,
  conversations: MessagesSquare,
  phone: Smartphone,
  archived: Archive,
  worktrees: GitBranch
};

export const SETTINGS_ICON_SIZE = 16;
export const SETTINGS_ICON_STROKE = 1.75;
