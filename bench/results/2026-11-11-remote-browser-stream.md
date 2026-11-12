# The agent's browser pushed to a viewer, 2026-11-11

`bun bench/remote-browser-frames.ts --seconds 8 --rtt 0,80`, then the same with
`--still`, `--width 2400`, `--webgl` and `--webgl-heavy` at `--rtt 0`, back to
back on `origin/main` (07124676) and on this branch. The page is 1200x1300 CSS
and the viewer asks for 780 px unless a row says otherwise, 8 s per row.

- Before: `origin/main`. Chrome draws on the GPU at a device scale of 1, and
  the viewer polls `browser.remoteFrame` on its schedule (`nextPollDelay`),
  naming the frame it shows.
- After, pull: this branch, polled the same way, as a client from before the
  stream polls it. Chrome runs with `--disable-gpu
  --force-device-scale-factor=2`.
- After, push: this branch, on the socket `browser.remoteStream` gives. The
  viewer acknowledges each picture as it arrives.

KiB/s is what the socket carries: base64 in JSON for a pull, the JPEG's bytes
for a push. Chrome CPU is the processor time of the Chrome processes of the
run's profile, as a share of one core (`/proc` on Linux, `Win32_Process` on
Windows). "Change shown" is the time from a `flip()` in the page, which paints
it whole, to the first picture of another size at the viewer, median of six.
"Page draws" is what `requestAnimationFrame` counts in the page.

## Windows 11 (`skoll`)

Ryzen 7 7800X3D (16 threads), Radeon RX 6750 XT, Chrome 157.0.8103.51
headless, Bun 1.4.2. One run per row; a row repeated gave the ranges shown.

### Moving page, 780 px

| | Pictures/s | KiB/s | Chrome CPU | Core CPU | Change shown | Page draws |
| --- | --- | --- | --- | --- | --- | --- |
| Before, pull | 4.0 | 433 | 29 to 40 % | 0 to 2 % | 377 ms | 260/s |
| After, pull | 4.0 | 414 | 117 to 132 % | 1 to 2 % | 372 ms | 53/s |
| After, push | 25.6 to 27.7 | 2444 to 2638 | 127 to 147 % | 2 to 3 % | 39 to 64 ms | 53/s |

With 80 ms of added latency:

| | Pictures/s | KiB/s | Chrome CPU | Change shown |
| --- | --- | --- | --- | --- |
| Before, pull | 4.0 | 433 | 37 % | 381 ms |
| After, pull | 4.0 | 414 | 116 % | 378 ms |
| After, push | 12.4 | 1181 | 128 % | 107 ms |

A pushed picture of that page weighs 95 KiB. The viewer acknowledges one
before the next is written, so the rate falls with the latency.

### Still page (`--still`)

| | Pictures/s | Chrome CPU | Core CPU |
| --- | --- | --- | --- |
| Before, pull | 0 (0.8 `unchanged`/s) | 2 to 7 % | 0 to 1 % |
| After, pull | 0 | 0 to 3 % | 1 to 2 % |
| After, push | 0 | 0 to 3 % | 1 to 2 % |

### Moving page, 2400 px (`--width 2400`)

| | Pictures/s | KiB per picture | KiB/s | Chrome CPU | Change shown |
| --- | --- | --- | --- | --- | --- |
| Before, pull | 4.0 | 231 (1200 px, the page's own width) | 925 | 59 to 67 % | |
| After, pull | 4.0 | 584 | 2334 | 195 % | |
| After, push | 20 to 21.7 | 536 | 10 700 to 11 600 | 248 to 262 % | 71 to 100 ms |

Before, a viewer on a dense screen was sent 1200 px stretched over 2400. After,
it is sent the 2400 px the page drew.

### WebGL

`--webgl` turns a gradient in a fragment shader. `--webgl-heavy` runs a loop of
24 steps for each pixel. The renderer is what `WEBGL_debug_renderer_info`
answers in the page.

| | Renderer | Chrome CPU | Page draws | Pictures/s | Change shown |
| --- | --- | --- | --- | --- | --- |
| Simple, before, pull | ANGLE, AMD Radeon RX 6750 XT, Direct3D 11 | 44 % | 260/s | 4.0 | 371 ms |
| Simple, after, pull | ANGLE, Microsoft Basic Render Driver, Direct3D 11 | 398 % | 30/s | 4.0 | 429 ms |
| Simple, after, push | the same | 304 % | 31/s | 23.7 | 113 ms |
| Heavy, before, pull | ANGLE, AMD Radeon RX 6750 XT, Direct3D 11 | 46 % | 260/s | 4.0 | |
| Heavy, after, push | ANGLE, Microsoft Basic Render Driver, Direct3D 11 | 1230 to 1330 % | 16 to 17/s | 16.5 to 17.5 | 206 to 210 ms |

On Windows a Chrome without a GPU draws WebGL with Direct3D's software
rasterizer (WARP), on every core it finds: twelve to thirteen cores for the
heavy shader, at a sixteenth of the page's former rate.

## Ubuntu 24.04 (`chris-MN56`)

Ryzen 7 8745HS (16 threads), Radeon 780M, Chrome 157.0.8103.38 headless, Bun
1.4.4, both trees unpacked in `/tmp`. The machine was at work meanwhile (load
average 5 to 12), one run per row. The page draws 60 times a second before:
this Chrome follows the screen's rate.

| Moving page, 780 px | Pictures/s | KiB/s | Chrome CPU | Core CPU | Change shown | Page draws |
| --- | --- | --- | --- | --- | --- | --- |
| Before, pull | 4.0 | 463 | 21 % | 1 % | 386 ms | 60/s |
| After, pull | 4.0 | 449 | 106 % | 2 % | 379 ms | 24/s |
| After, push | 22.6 | 2336 | 118 % | 4 % | 71 ms | 23/s |
| Before, pull, 80 ms | 4.0 | 463 | 22 % | 2 % | 385 ms | 60/s |
| After, push, 80 ms | 12.4 | 1278 | 117 % | 3 % | 110 ms | 23/s |

A still page sends nothing before or after, pulled or pushed, and Chrome takes
2 % of a core.

| WebGL | Renderer | Chrome CPU | Page draws | Pictures/s | Change shown |
| --- | --- | --- | --- | --- | --- |
| Simple, before, pull | ANGLE, AMD Radeon 780M (radeonsi), OpenGL ES 3.2 | 26 % | 60/s | 4.0 | 373 ms |
| Simple, after, pull | ANGLE, Vulkan 1.3 on SwiftShader | 352 % | 15/s | 3.7 | 357 ms |
| Simple, after, push | the same | 351 % | 16/s | 16.1 | 183 ms |
| Heavy, before, pull | ANGLE, AMD Radeon 780M (radeonsi), OpenGL ES 3.2 | 25 % | 60/s | 4.0 | 381 ms |
| Heavy, after, pull | ANGLE, Vulkan 1.3 on SwiftShader | 802 % | 7/s | 3.1 | 544 ms |
| Heavy, after, push | the same | 814 % | 8/s | 8.0 | 463 ms |

On Linux a Chrome without a GPU draws WebGL with SwiftShader: eight cores for
the heavy shader, and the page itself falls from 60 to 8 frames a second. A
viewer cannot be shown more pictures than the page draws.

## What it costs

- Drawing on the CPU at four times the pixels takes about four times the
  processor time on a plain animated page, and far more on WebGL.
- A push sends every picture the page draws, up to the pace: about six times
  the bytes of the four frames a second a poll took, at the same width.
- A still page costs what it cost.
