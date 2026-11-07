# Spike: a GPU path for the native edition

**Throwaway.** Nothing here is product code; the programs exist to measure.

## Question

Should Open Paint Studio's native DynLex edition move its interface, canvas
and pixel operations to the GPU, and if so, how, without losing its lead
over the Rust edition in first frame (23 ms against 26 ms) and memory
(22 MB against 39 MB PSS)?

## Setup

- Machine: Ryzen 7 9700X (16 threads), GeForce RTX 5070 driving the
  screens, AMD Radeon iGPU (RADV), Ubuntu with GNOME on Wayland; X11
  programs run on XWayland (`DISPLAY=:0`). The machine was shared with
  other sessions' compiles (load average 2.5–3.4); numbers are medians of
  5–7 runs unless stated.
- Vulkan loader 1.4.341, nine installed drivers (ICDs), GLFW 3.4.
- DynLex compiler: the shared checkout at `~/dynlex-7` (read only).

Programs (all measured, none claimed):

| File | What it measures |
|---|---|
| `vk_first_frame.dl` | a DynLex window through the Vulkan runtime (`lib/graphics.dl`): time to the first present, memory |
| `vk_canvas.dl` | a 4K, 8K and 16K image decoded by the editor's codecs, uploaded as one texture, zoomed and panned for 240 frames |
| `parallel_start.c` | the CPU draws the first frame of an X11 window while a thread starts Vulkan (instance, device, a surface on the same window, a swapchain), then the window switches to the GPU |
| `cpu_filters.dl` | the CPU cost of a whole-image colour correction today |
| `measure.py` | runs a program that prints monotonic stamps; milliseconds since spawn, PSS |

## Results

### 1. First frame and memory

| | first frame | PSS |
|---|---|---|
| native CPU edition, Xvfb (`bench/first_frame.py`) | 24 ms | 21.7 MB |
| native CPU edition, XWayland on the real display | 33 ms | 21.7 MB |
| DynLex Vulkan window, NVIDIA, X11 | 250 ms | 133 MB |
| DynLex Vulkan window, NVIDIA, Wayland | 253 ms | 133 MB |
| DynLex Vulkan window, AMD iGPU | 133 ms ¹ | 29 MB |

¹ The AMD GPU does not drive the screens on this machine; its swapchain
cannot be created on this display (`VK_ERROR_INITIALIZATION_FAILED` in
`parallel_start.c`), so this frame probably never reached the screen.

In the DynLex runtime, `a new window` (GLFW window, Vulkan instance,
device, surface, swapchain, built-in pipelines) is one call on the main
thread: 236–245 ms of the 250. A GPU-only editor would start ten times
slower and use six times the memory.

### 2. Starting the CPU first and Vulkan in parallel

`parallel_start.c` on the RTX 5070 (milliseconds since the process was
spawned):

| mode | CPU frame | instance | device | swapchain | GPU frame | main thread stalled at most | PSS before / after Vulkan |
|---|---|---|---|---|---|---|---|
| parallel, all nine drivers loaded | 11.5 | 41.4 | 111.7 | 140.1 | 140.6 | 1.7 | 20.1 / 61.3 MB |
| parallel, only the NVIDIA driver | 10.6 | 27.7 | 95.0 | 123.6 | 124.1 | 1.1 | 20.0 / 47.1 MB |
| after the CPU frame, only NVIDIA | 9.7 | 35.6 | 99.4 | 128.0 | 128.5 | 1.1 | 5.6 / 47.0 MB |
| GPU only, only NVIDIA | — | 27.3 | 90.9 | 127.8 | 128.3 | — | — / 42.3 MB |

On the AMD iGPU, with only the RADV driver loaded: instance after 10 ms,
device after 13 ms (presenting: see ¹).

What this shows:

- The idea works: Vulkan can be started on a background thread while the
  CPU-drawn first frame goes out, and the same X11 window can then take a
  Vulkan surface and present through it. The main thread never stalled
  more than 1.7 ms, so the editor stays responsive during the GPU start.
- The CPU frame gets slightly later when Vulkan starts at once in parallel
  (10.6–11.5 ms against 9.7 ms when started after it): the driver's
  libraries load while the window is drawn. Starting the thread right
  after the first frame costs nothing visible and the GPU is still ready
  at about 128 ms.
- Loading only the needed driver (`VK_DRIVER_FILES`, which a program can set
  for itself before it creates the instance) saves 14 ms on the instance
  and 14 MB of memory on NVIDIA, and 35 ms on the AMD instance. The loader
  otherwise opens all nine installed drivers.
- What remains is the driver's own cost: about 65 ms to create the NVIDIA
  device, about 28 ms for the swapchain, and at least 27 MB of memory, more
  than the whole CPU edition uses (21.7 MB). The DynLex runtime's window
  holds 133 MB; why it needs so much more than the minimal program
  (42–47 MB) was not investigated.

### 3. The canvas: zooming and panning large images

| image | decode | texture upload | GPU frame while zooming and panning | PSS | CPU redraw (`bench/large.dl`) |
|---|---|---|---|---|---|
| 4K PNG | 65 ms | 10 ms | 16.4 ms mean (60 Hz), 33 ms max | 165 MB | 0.3–0.4 ms per zoom level |
| 8K PNG | 200 ms | 32 ms | 16.5 ms mean, 33 ms max | 260 MB | 0.3–0.4 ms per zoom level |
| 16K JPEG | — | — | 16.5 ms mean, 41 ms max | — | the November 5 benchmark binary crashed |

The GPU frame is the refresh rate (FIFO presentation), not the GPU's cost.
The CPU edition already redraws only the visible part of the canvas, ten
zoom levels in 3–4 ms at 4K and 8K, far under one refresh. The GPU does not
make zooming or panning faster at these sizes; it would give smoother
(filtered) scaling, at 140–240 MB more memory.

### 4. Pixel operations and compute shaders

- A colour correction (brightness, contrast, saturation) on the CPU:
  75 ms at 4K, 300 ms at 8K, on one thread. This is where a GPU would gain.
- DynLex compute shaders cannot do this yet. The runtime dispatches compute
  shaders with one storage buffer (copied in and back), but DynLex compute
  shader source has no access to that buffer or to the invocation id; the
  only compute shader that does work in DynLex's own tests is SPIR-V
  assembled by a Python script (`tests/cadkernel/gpu/generate_plane_lift.py`),
  and `docs/cadkernel-gpu-geometry.md` lists storage-buffer access as the
  next step. The runtime also builds and destroys its pipeline on every
  dispatch, and has no render-to-texture with read-back, so fragment
  shaders cannot produce pixels the editor keeps either.
- Not measured: the GPU time of such a filter. Uploading and reading back
  an 8K canvas is 133 MB each way, a few milliseconds over PCIe 5.

## Verdict

Not everything on the GPU. **Stay on the CPU for the interface and the
canvas; add the GPU later, for pixel operations only, started lazily.**

1. A GPU-only edition would lose both leads it has over the Rust edition:
   first frame 250 ms instead of 24 ms and 133 MB instead of 22 MB with the
   current DynLex runtime; even a minimal Vulkan program needs 120–130 ms
   and 42 MB on NVIDIA.
2. Starting Vulkan on a thread beside a CPU-drawn first frame (the
   suggestion this spike tested) works and keeps the first frame and the
   responsiveness, but still costs 27–40 MB from the moment it starts.
   Start it only when an operation needs it (or when the editor is idle
   after start-up), not at every start, and load only the needed driver.
3. The canvas does not need the GPU: the CPU redraw is already well under
   a millisecond per frame at 8K.
4. The gain is in whole-image operations (300 ms at 8K today). Before the
   GPU, spread them over the CPU's cores; for the GPU route, DynLex needs:
   - compute shaders with storage buffers or storage images and the
     invocation id (compiler);
   - a device and surface that can be created apart from the window, on
     any thread, for an existing X11 window (runtime);
   - pipelines cached between dispatches, and textures read back (runtime).

Missing evidence: the GPU time of a real filter (blocked on the compiler),
and presenting from the iGPU on a machine whose screens it drives.
