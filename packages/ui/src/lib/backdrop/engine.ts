/*
 * Draws a scene of `scenes.ts` on a canvas with WebGL 2, at the screen's own
 * density: the graphics card fills the strokes, so a frame costs the page a
 * few thousand vertices of arithmetic and the motion keeps the screen's rate.
 *
 * A pixel is a tint and an opacity (premultiplied), never a ground of its own:
 * the frame sits on whatever the theme draws behind it. Nothing hides anything
 * else, so there is one pass and no depth to keep.
 *
 * Loaded on demand by the component that shows it, so a device that only
 * picks a scene in Settings never fetches it.
 */

import { markFeature } from '@boite/contracts';
import { Batch, STRIDE, TEX } from './batch';
import { themeTints, type Rgb } from './math';
import { GLYPH_SHADES, GLYPHS, RELIEF_CAP, RELIEF_FADE, SCENES, type Frame, type SceneId } from './scenes';

const NEAR = 0.02;
const FAR = 60;
/** How far past the words the quiet zone reaches before the scene comes back, in CSS pixels. */
const CALM_MARGIN = 28;
/** A character of the glyph scene and the cell it stands in, in CSS pixels. */
const GLYPH_SIZE = 13;
const GLYPH_CELL = [9, 18] as const;

markFeature('boite-feature:draft-backdrop');

const VERTEX = `#version 300 es
layout(location = 0) in vec3 aPlace;
layout(location = 1) in vec3 aSurface;
layout(location = 2) in vec3 aMaterial;
uniform vec2 uLens;
uniform vec2 uHeart;
uniform vec3 uView;
out vec2 vAt;
out float vShade;
flat out vec3 vMaterial;
void main() {
  vAt = aSurface.xy;
  vShade = aSurface.z;
  vMaterial = aMaterial;
  float z = aPlace.z;
  // What lies straight ahead lands on the heart of the screen, not on the canvas's middle. A sheet over the whole canvas stays put.
  vec2 ahead = aMaterial.x > 4.5 ? vec2(0.0) : uHeart / uView.xy * 2.0 - 1.0;
  gl_Position = vec4(aPlace.xy * uLens + ahead * z, (z * ${(FAR + NEAR).toFixed(2)} - ${(2 * FAR * NEAR).toFixed(2)}) / ${(FAR - NEAR).toFixed(2)}, z);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
// The character grid counts device pixels from far off the screen: past what a medium integer has to hold.
precision highp int;
in vec2 vAt;
in float vShade;
flat in vec3 vMaterial;
uniform vec3 uTint[3];
uniform sampler2D uAtlas;
uniform vec4 uCalm;
uniform float uQuiet;
// The canvas in its own pixels, then how many of them make a CSS pixel.
uniform vec3 uView;
// Where the scene's heart is on the canvas, in device pixels from its bottom left corner.
uniform vec2 uHeart;
uniform ivec2 uCell;
uniform vec4 uData[8];
out vec4 color;

float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(p)) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n >> 8) / 16777216.0;
}

void main() {
  int kind = int(vMaterial.x + 0.5);
  vec3 tint = uTint[int(vMaterial.y + 0.5)];
  float density = uView.z;
  float m = 1.0;
  if (kind == ${TEX.line}) {
    // A stroke a given number of pixels wide: full inside, and its edge spread over one screen pixel.
    float reach = vMaterial.z;
    m = clamp((reach - abs(vAt.x * 2.0 - 1.0) * (reach + 1.0)) * density + 0.5, 0.0, 1.0);
  } else if (kind == ${TEX.beam}) {
    float across = 1.0 - abs(vAt.x * 2.0 - 1.0);
    m = across * across;
  } else if (kind == ${TEX.dot}) {
    float radius = vMaterial.z;
    m = clamp((radius - length(vAt * 2.0 - 1.0) * (radius + 1.0)) * density + 0.5, 0.0, 1.0);
  } else if (kind == ${TEX.glow}) {
    float d = max(0.0, 1.0 - length(vAt * 2.0 - 1.0));
    m = d * d;
  } else if (kind == ${TEX.contour}) {
    // The height of the ground under this pixel: a sum of round hills.
    vec2 here = (gl_FragCoord.xy - uHeart) / density;
    vec2 top = (here - uData[0].xy) / uData[0].z;
    float near = dot(top, top);
    float around = 0.0;
    for (int i = 1; i < 7; i++) {
      vec2 off = (here - uData[i].xy) / uData[i].z;
      around += uData[i].w * exp(-dot(off, off));
    }
    // The hills around fade out toward the top of the wide rise and never add up past a height it stands above:
    // they shape its sides and leave its summit where it is put, the highest ground on the screen.
    around = ${RELIEF_CAP.toFixed(2)} * tanh(around / ${RELIEF_CAP.toFixed(2)});
    float height = uData[0].w * exp(-near) + around * (1.0 - exp(-near * ${RELIEF_FADE.toFixed(1)}));
    float level = height * 9.0 + uData[7].x;
    float slope = fwidth(level);
    // One CSS pixel of line where the height crosses a level; flat ground, where a line would swell, is left bare.
    float line = clamp(0.5 * density + 0.5 - abs(fract(level) - 0.5) / max(slope, 1e-5), 0.0, 1.0);
    line *= smoothstep(0.003, 0.009, slope * density);
    bool major = mod(floor(level), 4.0) < 0.5;
    tint = uTint[major ? 1 : 0];
    m = line * (major ? 0.38 : 0.13);
  } else if (kind == ${TEX.ascii}) {
    // The cell of the character grid this pixel is in, counted from the middle of the screen.
    ivec2 at = ivec2(gl_FragCoord.xy) - ivec2(uHeart) + uCell * 2048 + uCell / 2;
    ivec2 cell = at / uCell;
    ivec2 inside = at - cell * uCell;
    cell -= 2048;
    vec2 here = vec2(cell * uCell) / density;
    float unit = 0.5 * min(uView.x, uView.y) / density;
    float away = length(here) / unit;
    // The column through the middle has no slope to take an angle from.
    float angle = here.x == 0.0 ? sign(here.y) * 1.5707963 : atan(here.y, here.x);
    // The depth of a tunnel seen down its axis grows as the logarithm of the distance to its middle.
    float deep = log(max(away, 0.03));
    float spin = angle + deep * 0.5 + uData[0].w;
    // Rings rushing out of the middle, one in four a gate in the accent, on a wall whose panels turn slowly.
    float turn = deep * 13.0 - uData[0].x;
    float ring = max(sin(turn), 0.0);
    bool gate = mod(floor(turn / 6.2831853), 4.0) < 0.5;
    float panel = (0.55 + 0.45 * sin(spin * 7.0 + uData[0].y)) * (0.5 + 0.5 * sin(spin * 3.0 - deep * 2.0 + uData[0].z));
    float grain = hash(vec2(cell));
    float bright = clamp(ring * ring * mix(0.4, 1.0, panel) + (grain - 0.5) * 0.14, 0.0, 1.0) * smoothstep(0.12, 1.0, away);
    int shade = int(bright * ${GLYPH_SHADES}.99);
    int glyph = shade - 1;
    float ink = shade > 0 ? (gate ? 0.14 + 0.3 * bright : 0.08 + 0.2 * bright) : 0.0;
    if (gate) tint = uTint[1];
    // Streams of code along some of the spokes, one character wide, falling toward the middle.
    const float SPOKES = 24.0;
    float spoke = floor(angle / 6.2831853 * SPOKES + 0.5);
    float lean = angle - spoke * 6.2831853 / SPOKES;
    float aside = abs(length(here) * sin(lean));
    // One cell per row on a steep spoke, one per column on a shallow one, so the stream has no gap.
    float steep = abs(sin(angle)), flat_ = abs(cos(angle));
    vec2 size = vec2(uCell) / density;
    bool on = steep * size.y > flat_ * size.x ? aside < 0.5 * size.x * steep : aside < 0.5 * size.y * flat_;
    // The spoke pointing left is the last and the first at once, by the sign its angle came with: one name for both.
    float strand = mod(spoke, SPOKES);
    float pick = hash(vec2(strand + 64.0, 7.0));
    if (pick > 0.55 && on) {
      float along = fract(deep * 0.55 + uData[1].x * (0.05 + 0.08 * hash(vec2(strand + 64.0, 3.0))) + pick * 9.0);
      float trail = max(0.0, 1.0 - along / 0.22) * smoothstep(0.2, 0.5, away);
      if (trail > 0.02) {
        glyph = ${GLYPH_SHADES} + int(hash(vec2(cell) + uData[1].y) * ${GLYPHS.length - GLYPH_SHADES}.0);
        ink = 0.8 * trail * trail;
        tint = uTint[trail > 0.85 ? 1 : 2];
      }
    }
    m = ink * texelFetch(uAtlas, ivec2(clamp(glyph, 0, ${GLYPHS.length - 1}) * uCell.x + inside.x, uCell.y - 1 - inside.y), 0).a;
  }
  float a = clamp(vShade * m, 0.0, 1.0);
  // An oval over the heading is quietened, so it stays easy to read.
  a *= 1.0 - uQuiet * (1.0 - smoothstep(0.55, 1.0, length((gl_FragCoord.xy - uCalm.xy) / uCalm.zw)));
  color = vec4(tint * a, a);
}`;

/** What the last frame cost, how many were drawn and where the scene's heart is on the canvas, for a test or a measurement to read. */
export const stats = { frames: 0, milliseconds: 0, heart: [0, 0] };

export interface RunningBackdrop {
  /** Reads the place of the words again, after they moved or changed size. */
  settle(): void;
  /** The screen went under a cover, or came back: nothing is drawn under one. */
  cover(covered: boolean): void;
  stop(): void;
}

/** A box of the canvas, in CSS pixels from its top left corner. */
export interface CalmBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BackdropOptions {
  /** Called once the first frame is on the canvas. */
  ready?: () => void;
  /** Where the words to keep readable are. The scene is dimmed in an oval around them; the middle of the canvas without it. */
  calm?: () => CalmBox | null;
  /** What the scene is built around: its vanishing point, its summit, its hub sit on the middle of this box. The middle of the canvas without it. */
  heart?: () => CalmBox | null;
  /** The screen starts under a cover. */
  covered?: boolean;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  if (!gl.isContextLost()) console.warn(`backdrop: a shader did not compile: ${gl.getShaderInfoLog(shader) ?? ''}`);
  gl.deleteShader(shader);
  return null;
}

/** The colour a custom property of the page resolves to, as the browser itself paints it. */
function colorOf(probe: CanvasRenderingContext2D, style: CSSStyleDeclaration, property: string): Rgb | null {
  const value = style.getPropertyValue(property).trim();
  if (!value) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const pixel = probe.getImageData(0, 0, 1, 1).data;
  return pixel[3] ? [pixel[0]!, pixel[1]!, pixel[2]!] : null;
}

/**
 * Starts the scene on the canvas and keeps it running until `stop`. Answers
 * null where WebGL 2 is missing, and the canvas then stays empty: the screen
 * behind it is whole without it.
 */
export function startBackdrop(canvas: HTMLCanvasElement, id: SceneId, options: BackdropOptions = {}): RunningBackdrop | null {
  const scene = SCENES[id];
  const ready = options.ready ?? (() => {});
  let gl: WebGL2RenderingContext | null = null;
  try {
    // Every stroke fades its own edge, so the canvas smooths nothing more.
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const context = gl;

  const batch = new Batch();
  const frame: Frame = { batch, time: 3, leanX: 0, leanY: 0, focal: 1, width: 0, height: 0, data: new Float32Array(32) };
  const tints = new Float32Array(9);
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const probeContext = probe.getContext('2d', { willReadFrequently: true });
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dark = window.matchMedia('(prefers-color-scheme: dark)');

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let vertexArray: WebGLVertexArrayObject | null = null;
  let atlas: WebGLTexture | null = null;
  let lens: WebGLUniformLocation | null = null;
  let tint: WebGLUniformLocation | null = null;
  let calm: WebGLUniformLocation | null = null;
  let quiet: WebGLUniformLocation | null = null;
  let view: WebGLUniformLocation | null = null;
  let heart: WebGLUniformLocation | null = null;
  let cell: WebGLUniformLocation | null = null;
  let data: WebGLUniformLocation | null = null;
  let width = 0, height = 0, density = 1, family = '', lettered = 0, raf = 0, last = 0, stopped = false, announced = false;
  /** Whether the canvas is on screen: false under a cover the app names (a phone's list, its settings). */
  let seen = !options.covered;
  let wantX = 0, wantY = 0;
  /** The quiet oval: its middle and its two radii, in CSS pixels from the canvas's top left corner. */
  const zone = { x: 0, y: 0, across: 1, down: 1 };
  /** The scene's heart, in CSS pixels from the canvas's top left corner. */
  const core = { x: 0, y: 0 };

  function build(): boolean {
    const vertex = compile(context, context.VERTEX_SHADER, VERTEX);
    const fragment = compile(context, context.FRAGMENT_SHADER, FRAGMENT);
    program = context.createProgram();
    if (vertex && fragment && program) {
      context.attachShader(program, vertex);
      context.attachShader(program, fragment);
      context.linkProgram(program);
    }
    // A program keeps what it linked: the shaders go now, whether or not the other one compiled.
    context.deleteShader(vertex);
    context.deleteShader(fragment);
    if (!vertex || !fragment || !program || !context.getProgramParameter(program, context.LINK_STATUS)) return false;
    context.useProgram(program);
    lens = context.getUniformLocation(program, 'uLens');
    tint = context.getUniformLocation(program, 'uTint');
    calm = context.getUniformLocation(program, 'uCalm');
    quiet = context.getUniformLocation(program, 'uQuiet');
    view = context.getUniformLocation(program, 'uView');
    heart = context.getUniformLocation(program, 'uHeart');
    cell = context.getUniformLocation(program, 'uCell');
    data = context.getUniformLocation(program, 'uData');
    context.uniform1i(context.getUniformLocation(program, 'uAtlas'), 0);

    vertexArray = context.createVertexArray();
    buffer = context.createBuffer();
    context.bindVertexArray(vertexArray);
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    for (let slot = 0; slot < 3; slot++) {
      context.enableVertexAttribArray(slot);
      context.vertexAttribPointer(slot, 3, context.FLOAT, false, STRIDE * 4, slot * 12);
    }

    atlas = context.createTexture();
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, atlas);
    // A character is drawn at the size it is shown and read pixel for pixel, as sharp as text.
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 1, 1, 0, context.RGBA, context.UNSIGNED_BYTE, new Uint8Array(4));

    context.enable(context.BLEND);
    context.blendFunc(context.ONE, context.ONE_MINUS_SRC_ALPHA);
    context.clearColor(0, 0, 0, 0);
    family = '';
    return true;
  }

  /** Gives back every object `build` made, a half-built set included. */
  function release(): void {
    // A program still in use is only marked for deletion.
    context.useProgram(null);
    context.deleteProgram(program);
    context.deleteBuffer(buffer);
    context.deleteVertexArray(vertexArray);
    context.deleteTexture(atlas);
    program = buffer = vertexArray = atlas = null;
  }

  const cellWidth = () => Math.round(GLYPH_CELL[0] * density);
  const cellHeight = () => Math.round(GLYPH_CELL[1] * density);

  /** The characters of the glyph scene in a row, drawn in the code face the device picked, at the screen's density. */
  function letter(face: string): void {
    const sheet = document.createElement('canvas');
    sheet.width = GLYPHS.length * cellWidth();
    sheet.height = cellHeight();
    const pen = sheet.getContext('2d');
    if (!pen || stopped || context.isContextLost()) return;
    lettered = density;
    pen.font = `500 ${GLYPH_SIZE * density}px ${face}`;
    pen.textAlign = 'center';
    pen.textBaseline = 'middle';
    // Any opaque colour: the shader reads the coverage alone.
    pen.fillStyle = 'white';
    for (let i = 0; i < GLYPHS.length; i++) pen.fillText(GLYPHS[i]!, (i + 0.5) * cellWidth(), cellHeight() * 0.52);
    context.bindTexture(context.TEXTURE_2D, atlas);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, sheet);
    if (still.matches) draw();
  }

  /** Reads the theme again: its text colour, its accent, its code face. */
  function restyle(): void {
    const style = getComputedStyle(canvas);
    if (probeContext) {
      const text = colorOf(probeContext, style, '--color-foreground') ?? [255, 255, 255];
      const accent = colorOf(probeContext, style, '--color-accent') ?? text;
      themeTints(text, accent).forEach((rgb, i) => {
        tints[i * 3] = rgb[0] / 255; tints[i * 3 + 1] = rgb[1] / 255; tints[i * 3 + 2] = rgb[2] / 255;
      });
    }
    if (id !== 'glyphs') return;
    const face = style.fontFamily || 'monospace';
    if (face === family && lettered === density) return;
    family = face;
    letter(face);
    // The face may still be on its way: draw the sheet again once it is in.
    const awaited = face;
    void document.fonts?.load(`500 ${GLYPH_SIZE}px ${face}`, GLYPHS).then(() => { if (family === awaited) letter(awaited); }, () => {});
  }

  /** Device pixels drawn for a CSS pixel: the screen's own count, up to two. */
  const sharp = () => Math.min(2, window.devicePixelRatio || 1);

  function resize(): void {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height) return;
    density = sharp();
    canvas.width = Math.max(8, Math.round(width * density));
    canvas.height = Math.max(8, Math.round(height * density));
    frame.width = width;
    frame.height = height;
    frame.focal = batch.focal = scene.focal(width, height);
    settle();
    // A window moved to a screen of another density needs its characters drawn again.
    if (program && id === 'glyphs' && family && lettered !== density) letter(family);
  }

  /**
   * Places the quiet oval on the words and the scene's heart. The shader keeps the scene at its
   * dimmest out to 0.55 of a radius and gives it back by the full radius, so
   * the radii are the box's half sizes and a margin, over that 0.55.
   */
  function settle(): void {
    const box = options.calm?.() ?? null;
    if (box && box.width > 0 && box.height > 0) {
      zone.x = box.x + box.width / 2;
      zone.y = box.y + box.height / 2;
      zone.across = (box.width / 2 + CALM_MARGIN) / 0.55;
      zone.down = (box.height / 2 + CALM_MARGIN) / 0.55;
    } else {
      zone.x = width / 2;
      zone.y = height / 2;
      zone.across = Math.min(width * 0.8, 640);
      zone.down = Math.min(height * 0.32, 240);
    }
    const around = options.heart?.() ?? null;
    const held = around && around.width > 0 && around.height > 0;
    core.x = held ? around.x + around.width / 2 : width / 2;
    core.y = held ? around.y + around.height / 2 : height / 2;
  }

  /** Draws the batch. An empty one is skipped: a length of zero would upload its whole array. */
  function send(batch: Batch): void {
    if (batch.count === 0) return;
    context.bufferData(context.ARRAY_BUFFER, batch.data, context.DYNAMIC_DRAW, 0, batch.count * STRIDE);
    context.drawArrays(context.TRIANGLES, 0, batch.count);
  }

  function draw(): void {
    if (!program || !seen || !width || !height || context.isContextLost()) return;
    const began = performance.now();
    batch.reset();
    scene.draw(frame);
    const scale = canvas.width / width;
    context.viewport(0, 0, canvas.width, canvas.height);
    context.uniform2f(lens, (2 * frame.focal) / width, (2 * frame.focal) / height);
    context.uniform3fv(tint, tints);
    // A fragment counts its rows from the bottom of the canvas.
    context.uniform4f(calm, zone.x * scale, (height - zone.y) * scale, zone.across * scale, zone.down * scale);
    context.uniform1f(quiet, scene.calm);
    context.uniform3f(view, canvas.width, canvas.height, scale);
    context.uniform2f(heart, core.x * scale, (height - core.y) * scale);
    context.uniform2i(cell, cellWidth(), cellHeight());
    context.uniform4fv(data, frame.data);
    context.clear(context.COLOR_BUFFER_BIT);
    send(batch);
    stats.frames++;
    stats.heart = [core.x, core.y];
    stats.milliseconds = performance.now() - began;
    if (!announced) {
      announced = true;
      ready();
    }
  }

  function tick(now: number): void {
    raf = requestAnimationFrame(tick);
    // A long gap is a hidden window coming back: the scene resumes where it was.
    const elapsed = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    frame.time += elapsed;
    const ease = 1 - Math.exp(-elapsed * 1.9);
    frame.leanX += (wantX - frame.leanX) * ease;
    frame.leanY += (wantY - frame.leanY) * ease;
    if (density !== sharp()) resize();
    draw();
  }

  /**
   * Runs the loop, or draws one still frame for a device that asked for reduced
   * motion. Nothing runs under a cover: `cover` calls back when it lifts, and
   * the scene resumes where it was.
   */
  function pace(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (stopped || !seen || context.isContextLost()) return;
    if (still.matches) draw();
    else raf = requestAnimationFrame(tick);
  }

  const point = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || !width || !height) return;
    const box = canvas.getBoundingClientRect();
    wantX = Math.min(1, Math.max(-1, ((event.clientX - box.left) / box.width - 0.5) * 2));
    wantY = Math.min(1, Math.max(-1, ((event.clientY - box.top) / box.height - 0.5) * 2));
  };
  const rest = () => { wantX = 0; wantY = 0; };
  const repaint = () => { restyle(); if (still.matches) draw(); };
  const lost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(raf); raf = 0; program = buffer = vertexArray = atlas = null; };
  const restored = () => { if (build()) { restyle(); pace(); } else release(); };

  if (!build()) {
    release();
    return null;
  }
  resize();
  restyle();

  const fit = () => { resize(); if (still.matches || raf) draw(); };
  const sized = new ResizeObserver(fit);
  sized.observe(canvas);
  // A window dragged to a screen of another density keeps its size, so the observer hears nothing. A running scene
  // sees it at its next frame; a still one waits on this query, which stops matching and is asked again.
  let dense: MediaQueryList | undefined;
  const rescale = () => {
    dense?.removeEventListener('change', rescale);
    dense = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dense.addEventListener('change', rescale);
    if (density !== sharp()) fit();
  };
  rescale();
  // The theme, the accent and the faces are all stamped on the root element.
  const themed = new MutationObserver(repaint);
  themed.observe(document.documentElement, { attributes: true });
  dark.addEventListener('change', repaint);
  still.addEventListener('change', pace);
  window.addEventListener('pointermove', point, { passive: true });
  document.documentElement.addEventListener('pointerleave', rest);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  pace();

  return {
    settle() {
      settle();
      if (still.matches) draw();
    },
    cover(covered) {
      if (seen === !covered) return;
      seen = !covered;
      pace();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      sized.disconnect();
      dense?.removeEventListener('change', rescale);
      themed.disconnect();
      dark.removeEventListener('change', repaint);
      still.removeEventListener('change', pace);
      window.removeEventListener('pointermove', point);
      document.documentElement.removeEventListener('pointerleave', rest);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      // Hands the graphics memory back now rather than at the next collection,
      // the context too where the browser can drop one.
      release();
      context.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}
