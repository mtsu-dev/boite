/*
 * Draws a scene of `scenes.ts` on a canvas with WebGL 2. The graphics card
 * fills the triangles, so a frame costs the page a few thousand vertices of
 * arithmetic and the motion keeps the screen's own rate.
 *
 * The picture of an early 2000s console comes from three things done here:
 * the frame is drawn at a fraction of the screen's resolution and stretched
 * smooth by the browser, the textures are procedural and filtered, and
 * brightness is cut to a few steps through a 4x4 ordered dither.
 *
 * A pixel is a tint and an opacity (premultiplied), never a ground of its own:
 * the frame sits on whatever the theme draws behind it.
 *
 * Loaded on demand by the component that shows it, so a device that only
 * picks a scene in Settings never fetches it.
 */

import { markFeature } from '@boite/contracts';
import { Batch, STRIDE, TEX } from './batch';
import { turnHue, type Rgb } from './math';
import { GLYPH_INK, GLYPHS, SCENES, type Frame, type SceneId } from './scenes';

const ATLAS_COLUMNS = 5;
const ATLAS_ROWS = Math.ceil(GLYPHS.length / ATLAS_COLUMNS);
const ATLAS_CELL = 64;
const NEAR = 0.05;
const FAR = 40;
/** How far past the words the quiet zone reaches before the scene comes back, in CSS pixels. */
const CALM_MARGIN = 28;

markFeature('boite-feature:draft-backdrop');

const VERTEX = `#version 300 es
layout(location = 0) in vec3 aPlace;
layout(location = 1) in vec3 aSurface;
layout(location = 2) in vec3 aMaterial;
uniform vec2 uLens;
out vec2 vAt;
out float vShade;
flat out vec3 vMaterial;
void main() {
  vAt = aSurface.xy;
  vShade = aSurface.z;
  vMaterial = aMaterial;
  float z = aPlace.z;
  gl_Position = vec4(aPlace.xy * uLens, (z * ${(FAR + NEAR).toFixed(2)} - ${(2 * FAR * NEAR).toFixed(2)}) / ${(FAR - NEAR).toFixed(2)}, z);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vAt;
in float vShade;
flat in vec3 vMaterial;
uniform vec3 uTint[3];
uniform sampler2D uAtlas;
uniform vec4 uCalm;
uniform float uQuiet;
uniform float uLevels;
out vec4 color;

const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

// Each texture is averaged over the pixel it lands in, so a far wall settles
// into its mean tone instead of flickering.
// A wall panel: two squares by two, and a seam where it meets the next panel.
float checker(vec2 p) {
  vec2 w = max(fwidth(p), 1e-4);
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  vec2 rim = abs(fract(p * 0.5) - 0.5);
  float seam = smoothstep(0.47 - w.x * 0.5, 0.47, rim.x) + smoothstep(0.47 - w.y * 0.5, 0.47, rim.y);
  return mix(0.42, 1.0, 0.5 - 0.5 * i.x * i.y) * (1.0 - 0.55 * min(seam, 1.0) / (1.0 + 3.0 * max(w.x, w.y)));
}

float grid(vec2 p) {
  const float thin = 14.0;
  vec2 w = max(fwidth(p), 1e-4);
  vec2 a = p + 0.5 * w, b = p - 0.5 * w;
  vec2 i = (floor(a) + min(fract(a) * thin, 1.0) - floor(b) - min(fract(b) * thin, 1.0)) / (thin * w);
  return mix(0.3, 1.0, 1.0 - (1.0 - i.x) * (1.0 - i.y));
}

// A crate's face: a frame, a groove inside it, one brace, four planks and a nail in each corner.
float crate(vec2 p) {
  vec2 f = fract(p);
  float w = max(fwidth(p.x), fwidth(p.y)) + 0.004;
  float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float frame = 1.0 - smoothstep(0.13 - w, 0.13 + w, edge);
  float groove = (1.0 - frame) * (1.0 - smoothstep(0.15, 0.15 + 2.0 * w, edge));
  float brace = 1.0 - smoothstep(0.085 - w, 0.085 + w, abs(f.x - f.y));
  float plank = fract(f.y * 4.0);
  float seam = 1.0 - smoothstep(0.0, 0.07 + 4.0 * w, min(plank, 1.0 - plank));
  float body = (0.4 + 0.14 * mod(floor(f.y * 4.0), 2.0)) * (1.0 - 0.4 * seam);
  float m = mix(mix(body, 0.85, brace), 1.0, frame) * (1.0 - 0.45 * groove);
  float nail = 1.0 - smoothstep(0.02, 0.02 + 2.0 * w, length(abs(f - 0.5) - 0.435));
  return mix(m, 0.4, nail * frame);
}

void main() {
  int kind = int(vMaterial.x + 0.5);
  float m = 1.0;
  if (kind == ${TEX.checker}) m = checker(vAt);
  else if (kind == ${TEX.crate}) m = crate(vAt);
  else if (kind == ${TEX.grid}) m = grid(vAt);
  else if (kind == ${TEX.glow}) { float d = max(0.0, 1.0 - length(vAt * 2.0 - 1.0)); m = d * d; }
  else if (kind == ${TEX.glyph}) {
    float cell = floor(vMaterial.z + 0.5);
    vec2 corner = vec2(mod(cell, ${ATLAS_COLUMNS}.0), floor(cell / ${ATLAS_COLUMNS}.0));
    m = texture(uAtlas, (corner + vec2(vAt.x, 1.0 - vAt.y)) / vec2(${ATLAS_COLUMNS}.0, ${ATLAS_ROWS}.0)).a;
  }
  else if (kind == ${TEX.streak}) { float across = 1.0 - abs(vAt.x * 2.0 - 1.0); m = across * across * sin(vAt.y * 3.14159); }
  else if (kind == ${TEX.beam}) { float across = 1.0 - abs(vAt.x * 2.0 - 1.0); m = across * across; }
  float a = clamp(vShade * m, 0.0, 1.0);
  // An oval over the heading and the composer is quietened, so both stay easy to read.
  a *= 1.0 - uQuiet * (1.0 - smoothstep(0.55, 1.0, length((gl_FragCoord.xy - uCalm.xy) / uCalm.zw)));
  if (uLevels > 0.0) {
    ivec2 cell = ivec2(gl_FragCoord.xy) & 3;
    a = min(floor(a * uLevels + BAYER[cell.y * 4 + cell.x] / 16.0), uLevels) / uLevels;
  }
  color = vec4(uTint[int(vMaterial.y + 0.5)] * a, a);
}`;

/** What the last frame cost and how many were drawn, for a test or a measurement to read. */
export const stats = { frames: 0, milliseconds: 0 };

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
    // The scenes drawn small get their edges smoothed before the stretch; the
    // glyphs are upright squares at the screen's density and have none to smooth.
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: scene.levels > 0, depth: true, stencil: false, powerPreference: 'low-power' });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const context = gl;

  const solid = new Batch();
  const soft = new Batch();
  const frame: Frame = { solid, soft, time: 3, leanX: 0, leanY: 0, focal: 1 };
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
  let levels: WebGLUniformLocation | null = null;
  let width = 0, height = 0, family = '', raf = 0, last = 0, stopped = false, announced = false;
  /** Whether the canvas is on screen: false under a cover the app names (a phone's list, its settings). */
  let seen = !options.covered;
  let wantX = 0, wantY = 0;
  /** The quiet oval: its middle and its two radii, in CSS pixels from the canvas's top left corner. */
  const zone = { x: 0, y: 0, across: 1, down: 1 };

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
    levels = context.getUniformLocation(program, 'uLevels');
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
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR_MIPMAP_LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 1, 1, 0, context.RGBA, context.UNSIGNED_BYTE, new Uint8Array(4));

    context.depthFunc(context.LEQUAL);
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

  /** The characters of the glyph scene, drawn once in the code face the device picked. */
  function letter(face: string): void {
    const sheet = document.createElement('canvas');
    sheet.width = ATLAS_COLUMNS * ATLAS_CELL;
    sheet.height = ATLAS_ROWS * ATLAS_CELL;
    const pen = sheet.getContext('2d');
    if (!pen || stopped || context.isContextLost()) return;
    pen.font = `600 ${ATLAS_CELL * GLYPH_INK}px ${face}`;
    pen.textAlign = 'center';
    pen.textBaseline = 'middle';
    // Any opaque colour: the shader reads the coverage alone.
    pen.fillStyle = 'white';
    for (let i = 0; i < GLYPHS.length; i++) {
      pen.fillText(GLYPHS[i]!, ((i % ATLAS_COLUMNS) + 0.5) * ATLAS_CELL, (Math.floor(i / ATLAS_COLUMNS) + 0.52) * ATLAS_CELL);
    }
    context.bindTexture(context.TEXTURE_2D, atlas);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, sheet);
    context.generateMipmap(context.TEXTURE_2D);
    if (still.matches) draw();
  }

  /** Reads the theme again: its text colour, its accent, its code face. */
  function restyle(): void {
    const style = getComputedStyle(canvas);
    if (probeContext) {
      const text = colorOf(probeContext, style, '--color-foreground') ?? [255, 255, 255];
      const accent = colorOf(probeContext, style, '--color-accent') ?? text;
      [text, accent, turnHue(accent, -70)].forEach((rgb, i) => {
        tints[i * 3] = rgb[0] / 255; tints[i * 3 + 1] = rgb[1] / 255; tints[i * 3 + 2] = rgb[2] / 255;
      });
    }
    if (id !== 'glyphs') return;
    const face = style.fontFamily || 'monospace';
    if (face === family) return;
    family = face;
    letter(face);
    // The face may still be on its way: draw the sheet again once it is in.
    const awaited = face;
    void document.fonts?.load(`600 ${ATLAS_CELL * GLYPH_INK}px ${face}`, GLYPHS).then(() => { if (family === awaited) letter(awaited); }, () => {});
  }

  function resize(): void {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height) return;
    const pixel = scene.pixel(width, height) || 1 / Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(8, Math.round(width / pixel));
    canvas.height = Math.max(8, Math.round(height / pixel));
    frame.focal = scene.focal(width, height);
    settle();
  }

  /**
   * Places the quiet oval on the words. The shader keeps the scene at its
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
  }

  /** Draws one batch. An empty one is skipped: a length of zero would upload its whole array. */
  function send(batch: Batch): void {
    if (batch.count === 0) return;
    context.bufferData(context.ARRAY_BUFFER, batch.data, context.DYNAMIC_DRAW, 0, batch.count * STRIDE);
    context.drawArrays(context.TRIANGLES, 0, batch.count);
  }

  function draw(): void {
    if (!program || !seen || !width || !height || context.isContextLost()) return;
    const began = performance.now();
    solid.reset();
    soft.reset();
    scene.draw(frame);
    const scale = canvas.width / width;
    context.viewport(0, 0, canvas.width, canvas.height);
    context.uniform2f(lens, (2 * frame.focal) / width, (2 * frame.focal) / height);
    context.uniform3fv(tint, tints);
    // A fragment counts its rows from the bottom of the canvas.
    context.uniform4f(calm, zone.x * scale, (height - zone.y) * scale, zone.across * scale, zone.down * scale);
    context.uniform1f(quiet, scene.calm);
    context.uniform1f(levels, scene.levels);
    context.depthMask(true);
    context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
    context.enable(context.DEPTH_TEST);
    context.disable(context.BLEND);
    send(solid);
    context.depthMask(false);
    context.enable(context.BLEND);
    send(soft);
    stats.frames++;
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

  const sized = new ResizeObserver(() => { resize(); if (still.matches || raf) draw(); });
  sized.observe(canvas);
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
