import type { McpPreset } from './mcp';

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'filesystem', name: 'Filesystem', description: 'Read and edit files inside a directory you choose.',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'],
    fields: [{ target: 'arg', key: 'root', label: 'Root directory', required: true }],
  },
  {
    id: 'github', name: 'GitHub', description: 'Work with issues, pull requests, and repositories.',
    docsUrl: 'https://github.com/github/github-mcp-server',
    transport: 'http', url: 'https://api.githubcopilot.com/mcp/',
    fields: [{ target: 'header', key: 'Authorization', label: 'Personal access token', required: true, prefix: 'Bearer ' }],
  },
  {
    id: 'context7', name: 'Context7', description: 'Look up current library documentation and examples.',
    docsUrl: 'https://github.com/upstash/context7',
    transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'],
    fields: [{ target: 'env', key: 'CONTEXT7_API_KEY', label: 'API key', required: false }],
  },
  {
    id: 'postgresql', name: 'PostgreSQL', description: 'Inspect schemas and query a PostgreSQL database.',
    docsUrl: 'https://github.com/crystaldba/postgres-mcp',
    transport: 'stdio', command: 'uvx', args: ['postgres-mcp', '--access-mode=restricted'],
    fields: [{ target: 'env', key: 'DATABASE_URI', label: 'Database connection URL', required: true }],
  },
  {
    id: 'playwright', name: 'Playwright', description: 'Navigate and interact with websites in a headless browser.',
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
    transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp', '--headless'],
    fields: [],
  },
  {
    id: 'fetch', name: 'Fetch', description: 'Fetch web pages and read their content as text.',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], fields: [],
  },
  {
    id: 'linear', name: 'Linear', description: 'Read and manage issues and projects in Linear.',
    docsUrl: 'https://linear.app/docs/mcp',
    transport: 'http', url: 'https://mcp.linear.app/mcp',
    fields: [{ target: 'header', key: 'Authorization', label: 'Bearer token', required: true, prefix: 'Bearer ' }],
  },
  {
    id: 'notion', name: 'Notion', description: 'Search and update pages in a Notion workspace.',
    docsUrl: 'https://developers.notion.com/docs/mcp',
    transport: 'http', url: 'https://mcp.notion.com/mcp',
    fields: [{ target: 'header', key: 'Authorization', label: 'MCP token (Business or Enterprise)', required: true, prefix: 'Bearer ' }],
  },
  {
    id: 'sentry', name: 'Sentry', description: 'Investigate errors and find related Sentry events.',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
    transport: 'http', url: 'https://mcp.sentry.dev/mcp',
    fields: [{ target: 'header', key: 'Authorization', label: 'Sentry access token', required: true, prefix: 'Sentry-Bearer ' }],
  },
];
