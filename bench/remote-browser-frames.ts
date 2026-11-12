// Pictures a second a viewer gets from the agent's browser, end to end through
// a scratch core: the core starts its own headless Chromium for the
// conversation, the owner opens a moving page in it as the agent would, and a
// paired phone watches it both ways a viewer can:
//
//   pull  asks `browser.remoteFrame` on the viewer's schedule, naming the frame
//         it shows (`after`): a client or a core from before the stream.
//   push  opens the socket `browser.remoteStream` names and acknowledges each
//         JPEG, as RemoteBrowser.svelte does. Skipped on a core without it, so
//         the same file measures an older checkout.
//
// Latency is added on the phone's side (around each call when pulling, before
// each acknowledgement when pushed); bandwidth is not limited. Each row gives
// the pictures and the bytes a second on the wire (base64 when pulled, the JPEG
// when pushed), the CPU of the core and of its Chrome processes, and the delay
// between a change of the whole page and the first picture that shows it.
// `--still` drops the animation, so a viewer should receive next to nothing.
// `--webgl` draws the page with WebGL instead, a turning gradient that costs a
// GPU nothing, and `--webgl-heavy` a shader with a loop of 24 steps for each
// pixel; both report the renderer Chromium gave the page and the frames a
// second the page itself drew.
// `--save` keeps the last picture of each run there, to look at.
//
//   bun bench/remote-browser-frames.ts [--seconds 8] [--rtt 0,80,200] [--width 780] [--still] [--webgl | --webgl-heavy] [--save dir]
//
// Results: bench/results/2026-11-11-remote-browser-stream.md. Earlier runs
// (2026-10-03, 2026-10-05) measured the pull alone, with other schedules.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { connect } from '../packages/core/src/client.ts';
import { nextPollDelay } from '../packages/ui/src/lib/remote-browser-view.ts';

const { values } = parseArgs({ options: {
  seconds: { type: 'string', default: '8' }, rtt: { type: 'string', default: '0,80,200' }, width: { type: 'string', default: '780' },
  still: { type: 'boolean', default: false }, webgl: { type: 'boolean', default: false }, 'webgl-heavy': { type: 'boolean', default: false }, save: { type: 'string' },
} });
const seconds = Number(values.seconds), rtts = values.rtt.split(',').map(Number), width = Number(values.width), still = values.still, heavy = values['webgl-heavy'], webgl = values.webgl || heavy;
const root = join(import.meta.dir, '..');

// `flip()` covers the page with one flat colour, or uncovers it: a JPEG a fraction of the size, which the bench sees without decoding it.
const shared = `<div id=cover style="display:none;position:fixed;inset:0;background:#000;z-index:9"></div>
<script>function flip(){cover.style.display=cover.style.display==='none'?'block':'none';return cover.style.display}
let drawn=0,since=performance.now();window.fps=0;(function tick(){drawn++;const now=performance.now();if(now-since>=1000){window.fps=drawn*1000/(now-since);drawn=0;since=now}requestAnimationFrame(tick)})()</script>`;
const words = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua '.repeat(6);
const cards = `<!doctype html><meta charset=utf-8><title>bench</title><style>body{font:16px system-ui;margin:0;padding:24px;background:#fafafa;color:#222}
.hero{height:320px;background:radial-gradient(circle at 30% 40%,#f7c,#38f 40%,#123 80%);border-radius:12px}
.card{display:inline-block;width:340px;margin:10px;padding:12px;background:white;box-shadow:0 2px 8px #0002;vertical-align:top}
.spin{width:80px;height:80px;background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);border-radius:50%;${still ? '' : 'animation:s 1s linear infinite'}}@keyframes s{to{transform:rotate(1turn)}}</style>
<div class=hero></div><div class=spin></div><h1>Résultats de recherche</h1>${Array.from({ length: 12 }, (_, i) => `<div class=card><h3>Carte ${i}</h3><p>${words}</p><input placeholder="Champ ${i}"><button>Valider</button></div>`).join('')}${shared}`;
// A full-page fragment shader: a turning gradient, or with `--webgl-heavy` a loop that is real work for a software renderer.
const shader = `<!doctype html><meta charset=utf-8><title>bench</title><style>html,body{margin:0;height:100%;background:#111}canvas{display:block;width:100%;height:100%}</style><canvas id=c></canvas>${shared}
<script>const gl=c.getContext('webgl');window.renderer=gl?(gl.getExtension('WEBGL_debug_renderer_info')?gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)):'refused';
if(gl){c.width=innerWidth*devicePixelRatio;c.height=innerHeight*devicePixelRatio;gl.viewport(0,0,c.width,c.height);
const make=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);return s};const p=gl.createProgram();
gl.attachShader(p,make(gl.VERTEX_SHADER,'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));
gl.attachShader(p,make(gl.FRAGMENT_SHADER,${JSON.stringify(heavy ? 'precision mediump float;uniform float t;uniform vec2 r;void main(){vec2 u=(gl_FragCoord.xy*2.-r)/r.y;vec3 k=vec3(0.);for(int i=0;i<24;i++){float f=float(i);u=abs(u)/dot(u,u)-vec2(.9+.1*sin(t*.3),.6);k+=.04*(.5+.5*cos(f*.4+t+vec3(0.,2.,4.)))/(.2+length(u));}gl_FragColor=vec4(k,1.);}' : 'precision mediump float;uniform float t;uniform vec2 r;void main(){vec2 u=gl_FragCoord.xy/r-.5;float a=atan(u.y,u.x)+t;gl_FragColor=vec4(.5+.5*cos(a+vec3(0.,2.,4.)),1.);}')}));
gl.linkProgram(p);gl.useProgram(p);gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
const a=gl.getAttribLocation(p,'a');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);const t=gl.getUniformLocation(p,'t');gl.uniform2f(gl.getUniformLocation(p,'r'),c.width,c.height);
(function draw(now){gl.uniform1f(t,${still ? '0.' : 'now/1000'});gl.drawArrays(gl.TRIANGLE_STRIP,0,4);requestAnimationFrame(draw)})(0)}</script>`;
const page = webgl ? shader : cards;

const dataDir = mkdtempSync(join(tmpdir(), 'boite-remote-frames-'));
const site = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(page, { headers: { 'content-type': 'text/html;charset=utf-8' } }) });
const core = Bun.spawn([process.execPath, join(root, 'packages/core/src/main.ts'), '--port', '0', '--data-dir', dataDir], { stdout: 'ignore', stderr: 'ignore', windowsHide: true, env: { ...process.env, BOITE_ECHO: '1', BOITE_HOST_AGENTS: '0', BOITE_CORE_RESIDENT: '0', BOITE_TELEMETRY_URL: '' } });

/** The scratch core and the processes under it when last listed, on Windows: Chrome outlives a core that is killed there. */
const under = new Set<number>();
/** CPU seconds used so far by the scratch core and by the Chrome processes under it, or null where they cannot be read. */
function cpu(): { core: number; chrome: number } | null {
  if (existsSync('/proc/self/stat')) {
    const used = (pid: string | number) => { const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' '); return (Number(fields[11]) + Number(fields[12])) / 100; };
    let chrome = 0, own = 0;
    try { own = used(core.pid); } catch { /* the core ended */ }
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      try { if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(dataDir) && /chrom/i.test(readFileSync(`/proc/${pid}/comm`, 'utf8'))) chrome += used(pid); } catch { /* the process ended */ }
    }
    return { core: own, chrome };
  }
  if (process.platform !== 'win32') return null;
  // Every process once, with its parent: Chrome's are those under the scratch core, whatever their command line says.
  const listed = Bun.spawnSync(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.KernelModeTime + $_.UserModeTime) $([int]($_.CommandLine -like '*${basename(dataDir)}*')) $($_.Name)" }`], { windowsHide: true });
  const rows = listed.stdout.toString().split(/\r?\n/).map(line => line.trim().split(' ')).filter(row => row.length >= 5).map(([pid, parent, time, ours, ...name]) => ({ pid: Number(pid), parent: Number(parent), seconds: Number(time) / 1e7, ours: ours === '1', name: name.join(' ') }));
  under.clear(); under.add(core.pid);
  // A Chrome whose launcher ended has no parent left to follow: its command line names the profile of this run.
  for (let grew = true; grew;) { grew = false; for (const row of rows) if ((under.has(row.parent) || (row.ours && row.pid !== process.pid && /chrom|edge|brave/i.test(row.name))) && !under.has(row.pid)) { under.add(row.pid); grew = true; } }
  let chrome = 0, own = 0;
  for (const row of rows) { if (row.pid === core.pid) own = row.seconds; else if (under.has(row.pid) && /chrom|edge|brave/i.test(row.name)) chrome += row.seconds; }
  return { core: own, chrome };
}

interface Seen { at: number; bytes: number }
interface Viewer { seen: Seen[]; last?: Uint8Array; unchanged: number; refused: number; stop(): Promise<void> }
const median = (a: number[]) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : 0;
const closers: (() => void | Promise<void>)[] = [];
try {
  let owner: Awaited<ReturnType<typeof connect>> | undefined, port = 0;
  for (let i = 0; i < 200 && !owner; i++) {
    try { const state = JSON.parse(readFileSync(join(dataDir, 'core.json'), 'utf8')); owner = await connect(`http://127.0.0.1:${state.port}`, state.token); port = state.port; }
    catch { await Bun.sleep(100); }
  }
  if (!owner) throw new Error('the scratch core did not start');
  const agent = owner, url = `http://127.0.0.1:${port}`;
  closers.push(() => agent.close());
  const project = await agent.call('projects.add', { path: dataDir, name: 'bench' });
  const account = (await agent.call('accounts.list', {})).find(a => a.providerId === 'echo')!;
  const thread = await agent.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id, title: 'bench' });
  await agent.call('threads.subscribe', { threadId: thread.id });
  // The agent's page, in the browser the core starts for this conversation.
  await agent.call('browser.command', { threadId: thread.id, action: { kind: 'open', url: site.url.href } });
  await agent.call('browser.command', { threadId: thread.id, action: { kind: 'resize', width: 1200, height: 1300 } });
  const evaluate = async (expression: string) => (await agent.call('browser.command', { threadId: thread.id, action: { kind: 'evaluate', expression } })).value;

  const { grant } = await agent.call('pairing.grant', {});
  const phone = await connect(url, '', { grant, client: { name: 'pwa', version: 'bench' } });
  closers.push(() => phone.close());
  await phone.call('threads.subscribe', { threadId: thread.id });
  const call = phone.call as (method: string, params: object) => Promise<any>;
  const pushed = (phone.core as { features?: { browserStream?: boolean } }).features?.browserStream === true;

  /** A viewer that asks for each frame, as a client does of a core without the stream. */
  const pull = (rtt: number): Viewer => {
    const viewer: Viewer & { done?: Promise<void> } = { seen: [], unchanged: 0, refused: 0, stop: async () => { stopped = true; await viewer.done; } };
    let stopped = false;
    viewer.done = (async () => {
      let failures = 0, roundTrip = 0, unchanged = 0, shown: { id: string; base64: string } | null = null;
      while (!stopped) {
        const started = performance.now();
        let retry = false;
        try {
          await Bun.sleep(rtt / 2);
          const frame = await call('browser.remoteFrame', { threadId: thread.id, maxWidth: width, ...(shown ? { after: shown.id } : {}) });
          await Bun.sleep(rtt / 2);
          roundTrip = Math.max(0, performance.now() - started - (frame.waitedMs ?? 0)); failures = 0;
          if ('unchanged' in frame) { unchanged++; viewer.unchanged++; }
          else {
            unchanged = shown?.base64 === frame.base64 ? unchanged + 1 : 0;
            shown = frame; viewer.seen.push({ at: performance.now(), bytes: frame.base64.length }); viewer.last = Buffer.from(frame.base64, 'base64');
          }
        } catch (error) {
          if (/wait before requesting/.test(String(error))) { viewer.refused++; retry = true; } else { failures++; console.error(String(error)); }
        }
        await Bun.sleep(retry ? 250 : nextPollDelay({ roundTrip, unchanged, failures }));
      }
    })();
    return viewer;
  };
  /** A viewer that is pushed the frames on a socket of its own and acknowledges each. */
  const push = async (rtt: number): Promise<Viewer> => {
    const answer = await call('browser.remoteStream', { threadId: thread.id, maxWidth: width });
    if (!('path' in answer)) throw new Error('the core offered no stream for its own tab');
    const socket = new WebSocket(url.replace(/^http/, 'ws') + answer.path);
    socket.binaryType = 'arraybuffer';
    const viewer: Viewer = { seen: [], unchanged: 0, refused: 0, stop: async () => { socket.close(); } };
    socket.onmessage = ({ data }) => {
      if (typeof data === 'string') return;
      viewer.seen.push({ at: performance.now(), bytes: (data as ArrayBuffer).byteLength }); viewer.last = new Uint8Array(data as ArrayBuffer);
      setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ack"}'); }, rtt);
    };
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('the stream socket did not open')); });
    return viewer;
  };

  /** Milliseconds from asking the page to change whole to the first picture showing it, over a few changes. */
  const delay = async (viewer: Viewer): Promise<number | null> => {
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      const usual = median(viewer.seen.slice(-6).map(one => one.bytes));
      if (!usual) return null;
      const from = viewer.seen.length, covered = i % 2 === 0, asked = performance.now();
      await evaluate('flip()');
      const shows = (one: Seen) => covered ? one.bytes < usual * 0.6 : one.bytes > usual * 1.5;
      for (let waited = 0; waited < 300 && !viewer.seen.slice(from).some(shows); waited++) await Bun.sleep(10);
      const first = viewer.seen.slice(from).find(shows);
      if (first) delays.push(first.at - asked);
      await Bun.sleep(700);
    }
    return delays.length >= 3 ? Math.round(median(delays)) : null;
  };

  const drawing = webgl ? `, WebGL on ${JSON.stringify(await evaluate('window.renderer'))}` : '';
  console.log(`remote-browser-frames ${new Date().toISOString()} Bun ${Bun.version} ${process.platform}, the core's headless browser at 1200x1300 CSS px (devicePixelRatio ${await evaluate('devicePixelRatio')})${drawing}, ${still ? 'a still page' : 'a moving page'}, frames at most ${width} px wide, ${seconds} s per run`);
  for (const rtt of rtts) {
    for (const mode of pushed ? ['pull', 'push'] as const : ['pull'] as const) {
      const viewer = mode === 'pull' ? pull(rtt) : await push(rtt);
      await Bun.sleep(1500);
      const from = viewer.seen.length, kept = viewer.unchanged, before = cpu(), began = performance.now();
      await Bun.sleep(seconds * 1000);
      const elapsed = (performance.now() - began) / 1000, after = cpu(), seen = viewer.seen.slice(from);
      const fps = Number(await evaluate('window.fps'));
      if (values.save && viewer.last) { mkdirSync(values.save, { recursive: true }); writeFileSync(join(values.save, `${mode}-rtt${rtt}.jpg`), viewer.last); }
      const late = still ? null : await delay(viewer);
      await viewer.stop();
      const bytes = seen.reduce((sum, one) => sum + one.bytes, 0);
      const used = before && after ? `core ${Math.round((after.core - before.core) / elapsed * 100)} %, Chrome ${Math.round((after.chrome - before.chrome) / elapsed * 100)} % of a CPU core` : 'CPU unread';
      console.log(`rtt ${String(rtt).padStart(3)} ms ${mode}: ${(seen.length / elapsed).toFixed(1)} pictures/s, ${((viewer.unchanged - kept) / elapsed).toFixed(1)} unchanged/s, ${Math.round(median(seen.map(one => one.bytes)) / 1024)} KiB a picture, ${Math.round(bytes / 1024 / elapsed)} KiB/s, ${used}, page drew ${fps.toFixed(0)} frames/s, change shown after ${late === null ? '-' : `${late} ms`}, ${viewer.refused} early refusals`);
      await Bun.sleep(500);
    }
  }
} finally {
  for (const close of closers.reverse()) try { await close(); } catch {}
  cpu();
  core.kill(); await core.exited; site.stop(true);
  for (const pid of under) if (pid !== core.pid) try { process.kill(pid); } catch { /* it ended with the core */ }
  // Chrome lets go of its profile a moment after it is gone.
  for (let tries = 0; ; tries++) {
    try { rmSync(dataDir, { recursive: true, force: true }); break; }
    catch (error) { if (tries === 60) { console.error(`left ${dataDir}: ${String(error)}`); break; } await Bun.sleep(250); }
  }
}
