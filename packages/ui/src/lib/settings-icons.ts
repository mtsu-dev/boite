import { Activity, Archive, Bot, Brain, ChartColumn, Cpu, FlaskConical, Gauge, GitBranch, Globe, KeyRound, Keyboard, LifeBuoy, MessagesSquare, Mic, Monitor, MonitorSmartphone, Palette, Puzzle, Rocket, ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, Stethoscope, Wrench } from '@lucide/svelte';
import type { SettingsTab } from './settings-tabs';

/**
 * One lucide icon a Settings entry, the desktop's nav and the phone's rows
 * alike (a list of words alone was slow to scan). One family, one
 * size and one stroke where they are drawn (`SETTINGS_ICON_SIZE`). The nine
 * pages of the map first, then the phone's rows from before it.
 */
export const SETTINGS_ICONS: Record<Exclude<SettingsTab, 'home'> | 'phone' | 'archived' | 'worktrees', typeof Palette> = {
  appearance: Palette,
  input: Keyboard,
  conversations: MessagesSquare,
  ai: Sparkles,
  agents: Bot,
  safeguards: ShieldCheck,
  devices: MonitorSmartphone,
  version: Rocket,
  help: LifeBuoy,
  general: SlidersHorizontal,
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
  phone: Smartphone,
  archived: Archive,
  worktrees: GitBranch
};

export const SETTINGS_ICON_SIZE = 16;
export const SETTINGS_ICON_STROKE = 1.75;
