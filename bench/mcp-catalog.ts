/**
 * What `boite mcp` costs a model before its first call: the `tools/list`
 * result as the server sends it, in bytes, with an approximate token count
 * (bytes / 4) and the share of descriptions, input schemas, output schemas
 * and annotations. The server runs in process on an in-memory transport with
 * a stub agent identity; no core starts and no tool is called.
 *
 * Run: bun bench/mcp-catalog.ts
 */
import { createRequire } from 'node:module';
import type { CoreClient } from '../packages/core/src/client.ts';
import { createBoiteMcpServer } from '../packages/core/src/mcp/server.ts';

// The SDK is the core package's dependency, not the root's.
const sdk = createRequire(new URL('../packages/core/package.json', import.meta.url)).resolve('@modelcontextprotocol/server');
type Transport = Parameters<ReturnType<typeof createBoiteMcpServer>['connect']>[0];
const { InMemoryTransport } = await import(sdk) as { InMemoryTransport: { createLinkedPair(): [Transport, Transport] } };
const threadId = 'bench-thread';
const client = { principal: 'agent', threadId, call: () => { throw new Error('the catalog bench calls no tool'); }, close: () => {} } as unknown as CoreClient;
const server = createBoiteMcpServer(client, threadId);
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const replies = new Map<number, Record<string, any>>();
clientSide.onmessage = (message: Record<string, unknown>) => { if ('id' in message && typeof message.id === 'number') replies.set(message.id, message); };
await server.connect(serverSide);
await clientSide.start();

async function rpc(id: number, method: string, params: unknown): Promise<Record<string, any>> {
  await clientSide.send({ jsonrpc: '2.0', id, method, params } as never);
  for (let i = 0; i < 100 && !replies.has(id); i++) await Bun.sleep(1);
  const reply = replies.get(id);
  if (!reply?.result) throw new Error(`${method} returned ${JSON.stringify(reply)}`);
  return reply.result;
}

await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'catalog-bench', version: '1' } });
await clientSide.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);
const listed = await rpc(2, 'tools/list', {});
await server.close();

const bytes = (value: unknown): number => value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value));
const tools = listed.tools as Record<string, unknown>[];
const sum = (key: string): number => tools.reduce((total, tool) => total + bytes(tool[key]), 0);
const total = bytes(listed);
const row = (label: string, size: number): string => `${label.padEnd(14)} ${String(size).padStart(6)} B  ~${String(Math.round(size / 4)).padStart(5)} tokens`;
console.log(`tools/list: ${tools.length} tools`);
console.log(row('total', total));
console.log(row('descriptions', sum('description')));
console.log(row('inputSchema', sum('inputSchema')));
console.log(row('outputSchema', sum('outputSchema')));
console.log(row('annotations', sum('annotations')));
