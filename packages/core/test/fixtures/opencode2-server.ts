/** OpenCode 2's native API, with an ACP fallback to reproduce the old refusal. */
import { instructionsOf } from './history.ts';
export {};
if (!process.argv.includes('serve')) {
  await import('./acp-agent.ts');
} else {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const sessionID = 'ses_fixture';
  let cost = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inboxSequence = 0;
  let lateAdmission = false;
  let cancelAdmission = false;
  const event = (type: string, data: Record<string, unknown>) => {
    const bytes = encoder.encode(`data: ${JSON.stringify({ type, data: { sessionID, ...data } })}\n\n`);
    for (const stream of streams) stream.enqueue(bytes);
  };
  // Opt in: each process appends the inline configuration it was started with, and lists a model of that window.
  // A folder ending in "small" defaults to another model of the small window, or gives the same model that window
  // (`OPENCODE_FIXTURE_SAME_MODEL`), as an OpenCode project's configuration can.
  const configLog = process.env['OPENCODE_FIXTURE_CONFIG_LOG'];
  if (configLog) await Bun.write(configLog, `${await Bun.file(configLog).text().catch(() => '')}${process.env['OPENCODE_CONFIG_CONTENT'] ?? '{}'}\n`);
  const small = process.env['OPENCODE_FIXTURE_SMALL_WINDOW'] !== undefined && process.cwd().endsWith('small');
  const window = small ? process.env['OPENCODE_FIXTURE_SMALL_WINDOW'] : process.env['OPENCODE_FIXTURE_WINDOW'];
  const model = { id: small && process.env['OPENCODE_FIXTURE_SAME_MODEL'] === undefined ? 'small' : 'model', providerID: 'fixture', name: 'Fixture model', enabled: true, variants: [{ id: 'high' }], limit: { context: Number(window ?? 32000) } };
  const session = () => ({ id: sessionID, cost, model: { id: model.id, providerID: model.providerID }, agent: 'build', location: { directory: process.cwd() } });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('authorization') !== `Basic ${Buffer.from(`opencode:${process.env['OPENCODE_PASSWORD']}`).toString('base64')}`) return new Response('Unauthorized', { status: 401 });
    if (url.pathname === '/api/event') return new Response(new ReadableStream({ start(controller) {
      streams.add(controller); controller.enqueue(encoder.encode('data: {"type":"server.connected","data":{}}\n\n'));
    }, cancel() {} }), { headers: { 'Content-Type': 'text/event-stream' } });
    if (url.pathname === '/api/model') return Response.json({ data: [model] });
    if (url.pathname === '/api/model/default') return Response.json({ data: { providerID: model.providerID, id: model.id } });
    if (url.pathname === '/api/agent') return Response.json({ data: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }] });
    if (url.pathname === '/api/command') return Response.json({ data: [] });
    if (url.pathname === '/api/session' || (url.pathname === `/api/session/${sessionID}` && request.method === 'GET')) return Response.json({ data: session() });
    if (url.pathname.endsWith('/prompt')) {
      const body = await request.json() as { text: string; delivery: string; files?: unknown[] };
      const instructions = instructionsOf(body.text);
      if (body.delivery !== 'steer') return new Response('delivery must be steer', { status: 400 });
      const inbox = { id: `msg_fixture_${++inboxSequence}`, delivery: 'steer' };
      if (lateAdmission) {
        clearTimeout(timer);
        event('session.execution.succeeded', {});
        if (cancelAdmission) event('session.inbox.cancelled', { inboxID: inbox.id });
        else {
          event('session.execution.started', {});
          setTimeout(() => {
            event('session.inbox.delivered', { inboxID: inbox.id });
            event('session.text.delta', { delta: 'Late follow-up answered' });
            event('session.step.ended', { tokens: { input: 17, output: 3 } });
            event('session.execution.succeeded', {});
          }, 50);
        }
        lateAdmission = false;
        return Response.json({ data: inbox });
      }
      event('session.inbox.delivered', { inboxID: inbox.id });
      if (body.text === '[child-permission]') {
        event('session.created', { sessionID: 'ses_child', parentID: sessionID });
        event('permission.asked', { sessionID: 'ses_child', id: 'permission_child', action: 'shell', metadata: { command: 'git status' } });
        return Response.json({ data: inbox });
      }
      if (instructions.includes('[slow]')) {
        lateAdmission = instructions.includes('[late-admission]');
        cancelAdmission = instructions.includes('[cancelled]');
        event('session.execution.started', {});
        const tool = async () => {
          const gate = process.env['OPENCODE_FIXTURE_TOOL_GATE'];
          while (gate && !await Bun.file(gate).exists()) await Bun.sleep(10);
          event('session.tool.input.started', { id: 'shell-1', name: 'shell' });
          event('session.tool.called', { id: 'shell-1', input: { command: 'git status', cwd: process.cwd() } });
          event('session.tool.success', { id: 'shell-1', content: [{ type: 'text', text: 'working tree clean' }], metadata: { exit: 0 } });
        };
        setTimeout(() => void tool(), 400);
        if (!process.env['OPENCODE_FIXTURE_TOOL_GATE']) timer = setTimeout(() => { cost += 0.01; event('session.execution.succeeded', {}); }, 4000);
      } else {
        event('session.text.delta', { delta: `Received: ${body.text}; images: ${body.files?.length ?? 0}\n` });
        if (body.text.includes('[done]')) {
          event('session.step.ended', { tokens: { input: 17, output: 3 } });
          event('session.execution.succeeded', {});
        }
      }
      return Response.json({ data: inbox });
    }
    if (url.pathname.endsWith('/interrupt')) {
      clearTimeout(timer); event('session.execution.interrupted', {});
    }
    if (url.pathname === '/api/session/ses_child/permission/permission_child/reply') {
      const body = await request.json() as { decision: string };
      event('permission.replied', { sessionID: 'ses_child', requestID: 'permission_child' });
      event('session.text.delta', { delta: body.decision === 'once' ? 'child allowed' : 'child denied' });
      event('session.execution.succeeded', {});
    }
    return Response.json({});
  } });
  console.log(JSON.stringify({ url: server.url.origin }));
  await Bun.stdin.text();
  server.stop(true);
  process.exit(0);
}
