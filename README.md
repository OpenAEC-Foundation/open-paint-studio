# OpenAEC Paint Studio

A small image editor inspired by MS Paint, using the OpenAEC application style. Runs as a browser app or a Tauri 2 desktop application.

[Download installers](https://github.com/OpenAEC-Foundation/open-paint-studio/releases/latest) · [Watch the demo preview (MP4, 55 seconds)](docs/demo/OpenAEC-Paint-Studio-2026.43.1-demo-preview.mp4)

## Screenshots

The editor with an example floor plan, drawing tools, colors and image commands in the Home ribbon.

![OpenAEC Paint Studio editor with an annotated floor plan](docs/screenshots/paint-studio-overview.png)

Inline text editing while retaining editable vector objects.

![Inline text editor with font and size controls](docs/screenshots/paint-studio-text-editing.png)

The Forge dark theme with all objects selected using Ctrl+A.

![Forge dark theme with the whole document selected](docs/screenshots/paint-studio-dark-theme.png)

## Editor

- Smooth brush strokes, eraser, flood fill, eyedropper, lines, rectangles, ellipses and inline text editing.
- Brush size, opacity, filled/outlined shapes and a color palette.
- Crop, resize, rotate left/right and flip horizontally/vertically. The Home ribbon brings drawing tools, text/object properties, image operations, view controls and canvas settings together. Focus mode enlarges the drawing workspace.
- Optional **Keep vector objects**: select, move, resize and restyle drawn shapes/text. Geometry transforms preserve these objects. Export editable SVG.
- Brightness, contrast, saturation, grayscale, invert and sepia. Raster corrections flatten the image; undo restores the original objects.
- Open PNG, JPEG, WebP, GIF, BMP, TIFF, HEIC/HEIF, AVIF, PSD, SVG, ICO, TGA, JPEG 2000, JPEG XL and supported camera RAW variants, plus IFCX/IFCXB raster documents.
- Native browser decoders handle common images; a bundled ImageMagick WebAssembly worker handles additional formats locally. See [format support and limits](docs/IMAGE-FORMATS.md).
- Export PNG, JPEG, WebP or SVG; save the raster image embedded in IFCX or IFCXB.
- Undo/redo (40 recent document states), Ctrl+wheel zoom, middle-button drag to pan, pixel grid and local draft recovery using IndexedDB.
- Ctrl+A selects all objects together for moving, resizing or deleting; text fields retain normal text selection.
- Dutch and English; light, Forge, OpenAEC, Blueprint and high contrast themes. Fonts are bundled for offline use.

## Run

Use Node.js 22+ and pnpm 11.25.0. The desktop app additionally needs Rust stable and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install --frozen-lockfile
pnpm dev                 # http://127.0.0.1:3020
pnpm tauri dev           # native desktop window
pnpm build               # dist/ + dist-services/
pnpm test                # renderer, formats, vectors, API, MCP and signing tests
pnpm exec playwright install chromium
pnpm test:ui             # browser integration tests
pnpm tauri build --bundles deb,appimage  # Linux
```

Other native targets: `--bundles nsis` on Windows, `--bundles app,dmg` on macOS. Installers are written to `src-tauri/target/release/bundle/`. The API/MCP are separate Node processes and are not automatically started by the desktop installer.

## API and MCP

```sh
pnpm api                 # loopback only: http://127.0.0.1:47831
pnpm mcp                 # MCP stdio; normally launched by your MCP host
```

The API generates a private token at `.paint-data/token`. Enter this token in **Automation → Connect API**. Send the current image to the API or load an API document by ID. UI changes are exchanged explicitly: this is not live synchronization. Revision checks prevent one client from silently overwriting another's edits.

After building, the services also run with `node dist-services/services/api.js` and `node dist-services/services/mcp.js` (install production dependencies first).

See [API](docs/API.md), [MCP](docs/MCP.md), and [builds and signing](docs/RELEASING.md).

## Style provenance

Adapted from [OpenAEC-Foundation/OpenAEC-style-book](https://github.com/OpenAEC-Foundation/OpenAEC-style-book), local revision `dfdcd415b26604081b1699560621d3e9ae7ea6bf`. Reuses the theme definitions, ribbon components and OpenAEC logo; the Paint shell follows its desktop workspace structure. No BIM/reporting modules from the template are included.

OpenAEC brand assets and template-derived components remain **CC BY-SA 4.0**. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). New editor and service code is MIT licensed.

### Linux user installation

Build a DEB with `pnpm tauri build --bundles deb`, then run `node scripts/install-linux.mjs "path/to/OpenAEC Paint Studio_2026.43.0_amd64.deb"`. The installer checks system libraries, installs under `~/.local/share/openaec-paint-studio`, creates a launcher and menu entry, and associates supported image types; IFCX/IFCXB are offered as supported document types for the current user. Previous MIME defaults are saved under `~/.local/state/openaec-paint-studio`. No administrator password is needed. Opening an associated file imports it into the editor; each Linux launch opens its own window.
