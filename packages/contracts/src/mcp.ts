import type { ProjectId } from './ids';

export type McpScope = 'global' | 'projects';
export type McpTransport = 'stdio' | 'http';

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  scope: McpScope;
  projectIds: ProjectId[];
  command?: string;
  args?: string[];
  url?: string;
  env: Record<string, string>;
  headers: Record<string, string>;
  envKeys: string[];
  headerKeys: string[];
  secretEnvKeys: string[];
  secretHeaderKeys: string[];
}

export type McpServerInput = Omit<McpServer, 'id' | 'env' | 'headers' | 'envKeys' | 'headerKeys' | 'secretEnvKeys' | 'secretHeaderKeys'> & {
  id?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  /** Missing keys keep their value, null deletes a value. */
  secretEnv?: Record<string, string | null>;
  /** Missing keys keep their value only while the URL origin stays the same. */
  secretHeaders?: Record<string, string | null>;
};

export interface McpPresetField {
  target: 'arg' | 'env' | 'header';
  key: string;
  label: string;
  required: boolean;
}

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  fields: McpPresetField[];
}

export interface McpProbeResult {
  ok: boolean;
  latencyMs: number;
  serverName?: string;
  serverVersion?: string;
  tools: { name: string; description?: string }[];
  error?: string;
}

export interface McpRpcMethods {
  'mcp.list': { params: Record<string, never>; result: { servers: McpServer[]; presets: McpPreset[]; encrypted: boolean } };
  'mcp.save': { params: McpServerInput; result: McpServer };
  'mcp.remove': { params: { id: string }; result: { removed: true } };
  'mcp.toggle': { params: { id: string; enabled: boolean }; result: McpServer };
  'mcp.test': { params: { id: string }; result: McpProbeResult };
}

export interface McpRpcEvents {
  'mcp.changed': Record<string, never>;
}
