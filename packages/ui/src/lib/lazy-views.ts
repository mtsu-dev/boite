import { appViews } from './app-views';
import { parts } from './nested-parts';
import { agentsPage as lazyAgentsPage } from './agents-views';
import { teamChat as lazyTeamChat, councilSalon as lazyCouncilSalon, findBar as lazyFindBar } from './chat-views';
import { settingsShell as lazySettingsShell, agentsLayout as lazyAgentsLayout, homePage as lazyHomePage, contactsRail as lazyContactsRail } from './navigation-views';

const intentViews: Record<string, readonly { load(): Promise<unknown> }[]> = {
  settings: [lazySettingsShell],
  agents: [lazyAgentsLayout, lazyAgentsPage],
  team: [lazyAgentsLayout, lazyAgentsPage, lazyTeamChat],
  council: [appViews.RightPanel, lazyCouncilSalon],
  home: [lazyHomePage, lazyContactsRail],
  panel: [appViews.RightPanel],
  'panel-agents': [appViews.RightPanel],
  terminal: [appViews.TerminalDrawer, appViews.TerminalView],
  board: [appViews.BoardDrawer],
  palette: [appViews.CommandPalette],
  find: [lazyFindBar],
  project: [appViews.ProjectPicker],
  import: [appViews.ImportDialog],
  connect: [appViews.ConnectFlow],
  model: [parts.ModelPickerMenu],
};

export function preloadView(intent: string): void {
  if (!Object.hasOwn(intentViews, intent)) return;
  for (const part of intentViews[intent]!) void part.load().catch(() => undefined);
}
