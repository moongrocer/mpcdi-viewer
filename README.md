# MPCDI Viewer

A browser-based tool for loading, inspecting, and validating MPCDI (Multiple Projection Common Data Interchange) packages. Built for projection engineers and AV integrators who need to verify warp and blend map interpretation before committing to a production pipeline.

This is a **viewer / transform / validation tool**, not a media server.

## What it does

- Loads `.mpcdi` packages (ZIP archives containing XML manifest + PFM warp maps + PNG blend maps)
- Parses the XML manifest and enumerates all buffers and regions
- Loads PFM warp maps (Portable Float Map — the standard MPCDI geometry format)
- Loads PNG alpha/blend/black-level correction maps
- Applies warp + blend in real time using WebGL2 fragment shaders
- Provides debug visualization modes to validate coordinate interpretation
- Supports still images and video as source content

## Quick start (Windows)

Double-click **`start.bat`**. It installs dependencies on first run, starts the dev server, and opens the browser.

## Install

```bash
npm install
```

Requires Node.js 20.19+ / 22.12+ (Vite 8).

## Run

```bash
npm run dev
```

Opens at `http://localhost:3000`.

## Build for production

```bash
npm run build
npm run preview
```

## Usage

1. Click **Load .mpcdi** and select an MPCDI package file (`.mpcdi` or `.zip`)
2. Click **Load media** and select a source image or video
3. Select the desired buffer/region from the dropdown
4. Use the debug mode buttons and warp interpretation controls to inspect the result

## MPCDI package layout

The tool expects a standard MPCDI package — a ZIP file containing:

```
mpcdi.xml                    # XML manifest (required)
<buffer_id>/<region_id>.pfm  # Warp map (PFM format)
<buffer_id>/<region_id>.png  # Blend alpha map (optional)
```

The XML manifest follows the MPCDI 2.0 schema:

```xml
<MPCDI profile="2d" version="2.0">
  <display>
    <buffer id="buf1" xResolution="1920" yResolution="1080">
      <region id="reg1" x="0" y="0" xSize="1" ySize="1"
              xResolution="1920" yResolution="1080">
        <frustum>
          <yaw>0</yaw>
          <pitch>0</pitch>
          <roll>0</roll>
          ...
        </frustum>
        <geometryWarpFile>
          <path>buf1/reg1.pfm</path>
        </geometryWarpFile>
        <alphaMap>
          <path>buf1/reg1.png</path>
        </alphaMap>
      </region>
    </buffer>
  </display>
</MPCDI>
```

The parser is lenient about path resolution — it will search for files by name if direct paths don't match.

## Warp map format (PFM)

PFM files encode a 2D grid of floating-point values:

- **3-channel (PF)**: R = x coordinate, G = y coordinate, B = intensity/mask
- **1-channel (Pf)**: single value (expanded to 3-channel internally)
- Row order: bottom-to-top in the file (flipped to top-to-top on load)
- Endianness: determined by the sign of the scale factor on line 3

## Debug modes

| Mode | What it shows |
|------|--------------|
| **Final** | Full composited output with warp + blend |
| **Source** | Source image/video with no warp applied |
| **UV** | Visualizes the computed source UV coordinates as R=U, G=V |
| **Checker** | Checkerboard pattern through the warp — reveals distortion and out-of-bounds regions (shown in red) |
| **Warp Viz** | Raw warp map texture values as RGB |

## Warp interpretation controls

These are critical for validating MPCDI files from different vendors:

- **Coordinate Space**: Whether warp map values are normalized [0,1] or absolute pixel coordinates
- **Flip Y**: Inverts the Y axis of warp coordinates (some producers use bottom-left origin)
- **Inverse mapping**: Toggles between interpreting the map as screen→source (standard) vs source→screen

## Browser requirements

- **WebGL2** — required (Chrome 56+, Firefox 51+, Safari 15+, Edge 79+)
- **EXT_color_buffer_float** — needed for float texture rendering (warp maps)
- **OES_texture_float_linear** — recommended for smooth warp interpolation
- **WebCodecs** — optional, for future enhanced video decode

Tested on Chrome and Firefox on macOS/Windows/Linux.

## Current limitations

- `.procalib` files are **not supported** — MPCDI only
- Video playback uses `HTMLVideoElement` (v0.1) — frame-accurate WebCodecs decode is a future enhancement
- Forward warp map inversion (source→screen) is not implemented at the GPU level — the tool flags this mode but treats the map as passthrough. Real forward→inverse conversion requires a scatter-to-gather preprocess.
- Only single-region rendering at a time — multi-region compositing is a future feature
- No export/bake — the architecture supports adding an offline backend but it's not implemented yet

## Architecture

```
src/
  main.ts           # Entry point
  app/
    App.ts          # Bootstrap, render loop, orchestration
    state.ts        # Observable application state
  model/
    types.ts        # All shared TypeScript types
  parser/
    mpcdi.ts        # MPCDI ZIP/XML parser
    pfm.ts          # PFM file parser
    png.ts          # PNG → float blend map loader
  media/
    image.ts        # Still image loading
    video.ts        # Video loading + transport controls
  render/
    context.ts      # WebGL2 context + shader compilation
    renderer.ts     # Main renderer class
    shaders.ts      # GLSL vertex + fragment shaders
    textures.ts     # Texture upload helpers
  ui/
    controls.ts     # DOM ↔ state bindings
```

## Future extension points

- **Offline bake/export**: The `Renderer` can be pointed at an offscreen framebuffer to render frames for export. Add a `BakeEngine` that iterates frames and writes to canvas → blob → download.
- **WebCodecs video**: Replace `HTMLVideoElement` with `VideoDecoder` for frame-accurate decode and custom frame queue.
- **Multi-region compositing**: Render each region to an FBO, then composite into a single output matching the full buffer resolution.
- **WebGPU path**: The shader logic is simple enough to port to WGSL. The `Renderer` class can be subclassed or swapped.
- **Warp map editing**: Upload modified PFM data back to the GPU for interactive correction.
- **Network streaming**: Accept media from NDI, RTSP, or WebRTC sources instead of local files.

## Dependencies

- **jszip** — for reading the MPCDI ZIP archive in the browser
- **vite** — development server and bundler
- **typescript** — type checking

No runtime frameworks. No three.js. No React. Pure DOM + WebGL2.
