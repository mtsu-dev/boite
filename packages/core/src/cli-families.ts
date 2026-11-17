/**
 * What the `boite` CLI's commands need, behind one lazy import: cli.ts loads
 * this module when a command runs, never for `boite help`. One boundary rather
 * than one per command family, since each dynamic import splits the core bundle
 * into more chunks. `desktop-cli.ts` and `mcp/server.ts` stay apart: only their
 * own command loads them.
 */
export { controlCommand, ownerThreadNew, spawnedLines } from './control-cli.ts';
export { BROWSER_HELP, browserCommand } from './browser-cli.ts';
export { browserRun } from './browser-run.ts';
export { browserRecipe } from './browser-recipe.ts';
export { deviceCommand } from './device-cli.ts';
export { WINDOW_REQUEST_TIMEOUT_MS, windowCommand } from './window-cli.ts';
export { secretCommand } from './secret-cli.ts';
export { teamCli } from './teams-entry.ts';
export { issueCommand, logsCommand } from './logs-cli.ts';
export { botCommand } from './agents/cli.ts';
export { DELEGATE_ACTIONS, delegateCommand } from './delegate-cli.ts';
export { AgentsUsage, WAIT_MAX_S, agentsCommand } from './agents-cli.ts';
export { contactsCommand } from './contacts/cli.ts';
export { workflowCommand } from './workflow-cli.ts';
export { projectsCommand } from './projects-cli.ts';
export { viewCheckCommand } from './view-cli.ts';
export { VIEW_EXAMPLE } from './view-example.ts';
export { agentSettingArg, clipped, pictureDataUrl, settingValue, settingsPlace } from './cli-settings.ts';
export { pluginAction, pluginCommand } from './plugin-cli.ts';
export { readSettingsFor, settingsLines, stateCommand } from './cli-state.ts';
export { connect } from './client.ts';
export { BOT_CARD_NOTE, VIEW_HELP } from '@boite/contracts';
