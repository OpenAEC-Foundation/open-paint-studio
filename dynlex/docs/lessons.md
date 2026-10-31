# Lessons from the native port

What porting OpenAEC Paint Studio to DynLex taught, in the order it cost time.
Each item comes with the evidence. The language and runtime items are filed
upstream as [dynlex#17](https://github.com/OpenAEC-Foundation/dynlex/issues/17) and
[dynlex#18](https://github.com/OpenAEC-Foundation/dynlex/issues/18).

## Matching an interface pixel for pixel

1. **Measure in the engine you match.** The first measurements came from a
   Chromium-based browser. WebKitGTK lays text out with other widths, which
   left "Automatisering" 9 pixels further right in the Tauri build. Measuring in
   WebKitGTK itself (`tools/shell/measure_webkit.py`, through PyGObject) removed
   all layout drift.
2. **Use the font files the browser actually loads.** Fontsource ships WOFF2 and
   WOFF with *different hinting*. With the WOFF files every advance came out
   wrong: "Openen" at 10 px was 43 pixels wide, where WebKit has 39. With
   WOFF2 every measured advance matched, "O" = 9, "n" = 7, "Bijsnijden" = 49.
3. **WebKitGTK hints fully and advances by whole pixels.** Light hinting with
   fractional pen positions looked soft and wide. FreeType's normal target plus
   HarfBuzz with hinted advances (`hb_ft_font_set_load_flags(font, 0)`) gives
   the same glyph images.
4. **Browsers blend in sRGB.** Drawing the interface with GPU blending on an
   sRGB swapchain blends in linear light: text and translucent borders look
   different. Composing the frame on the CPU in sRGB matched; only the upload
   path still costs 1–3 levels (dynlex#17).
5. **Glyphs missing from a subset fall back.** Inter's Latin subset has no
   "⌄". The browser takes it from DejaVu Sans, as fontconfig says
   (`fc-match 'Inter:charset=2304'`).
6. **Responsive layout from three measurements.** Measuring at 1440 × 940,
   1200 × 940 and 1440 × 800 gives, per element, how x, width, y and height
   follow the window. That is exact within a CSS breakpoint range.

## Speed and memory

7. **A texture per glyph per frame is the most expensive mistake.**
   `lib/font.dl` replaces its texture for every glyph drawn. That cost 8.3 ms
   per frame and 82 % CPU at idle; a glyph atlas cost 0.3 ms.
8. **Wait for input; don't poll.** `glfwWaitEventsTimeout` instead of sleeping
   8 ms took idle CPU from 82 % to 0.4 %. After that, skip recomposing and
   presenting unchanged frames. But do present the first frames and those after
   a resize: Wayland may drop a frame sent before the window is configured.
   That was the white window on the first desktop run.
9. **Cache by signature.** The chrome only changes with state: tab, menu,
   tool, colour, history, sizes, zoom. Comparing a signature string and
   reusing the composed layer brought a frame from 49 ms to 0.26 ms. While
   drawing, only the canvas layer is redrawn (6 ms).
10. **Never size a buffer by the image.** The canvas shadow was an SVG as large
    as the displayed canvas. At 16K that meant 2.6 s per redraw and 10.5 GB of
    memory. Nine slices of a 288-pixel shadow made redraws 8–10 ms at any size.
11. **Undo by rectangle.** Shrinking each undo snapshot to the rectangle the
    change touched makes a brush stroke cost its own size, not the canvas.

16. **A dock icon needs an identity, not just a .desktop file.** GNOME matches a
    running window to its menu entry through the Wayland app id or the X11
    WM_CLASS. The runtime creates every window as "DynLex" and resets GLFW's
    hints, so the app creates its window with its own title, through XWayland.

17. **Measure dialogs and pages as states too.** The dialogs (`<dialog>` with
    its `::backdrop`, which is no element), the File pages and every field came
    from the same measuring script: open the state as a user would, record it,
    close it. A control's kind and name (`number:new.width`,
    `range:adjust.brightness:-100:100`) is all the shell needs to make it work.

## Comparing fairly

12. **Run the original's own code path.** The browser editor's `decodeFile`
    scales everything to at most 8.4 megapixels, re-encodes it as PNG, and
    refuses more than 64 megapixels. Timing a plain `createImageBitmap`
    instead would have flattered it.
13. **Make the benchmark read its results.** At `-O2`, work whose result is
    never read is removed, which gave timings of 0 ms. Summing a sample of
    every result into a printed checksum kept the work in.

14a. **Test with input the way a user gives it, and keep test windows contained.**
    On Xvfb without a window manager, keys go to the window under the pointer.
    And GTK4 dialogs (zenity) open through the desktop portal, so they appear on
    the real desktop unless `GDK_DEBUG=no-portals` keeps them on the test display.

## The language

14. **Implicit parameter promotion.** A body variable that shares a word with
    the function's pattern (`face`, `width`, `pixels`, `image`, `last`, `text`)
    becomes a parameter, and the error appears at the call site.
15. **Parenthesise possessive arguments.** `the item at i in typeface's coverage`
    groups as `(… in typeface)'s coverage` and read the wrong memory.

## Making it faster and smaller than the Rust edition

18. **For a CPU-composed frame, the GPU is overhead.** Vulkan through
    lavapipe cost 70 of 98 MB (driver memory, libLLVM) to show one texture.
    Xlib plus a MIT-SHM image, called directly: 25 MB, idle 0.0 %, and a
    mouse move costs 68 µs because only the changed rectangle is composed and
    put on the window.
19. **Dirty rectangles everywhere.** The editor records the rectangle each
    change touches; the shell redraws only that part of the canvas, and the
    undo state is cut from the stroke's base instead of a whole-canvas copy.
20. **`the function named` plus pthreads is enough for parallel work.** The
    canvas sampler and the JPEG decoder's inverse DCT run over all cores. The
    worker must be defined before the reference and must not touch lists: give
    threads plain arrays.
21. **Member names are pattern words.** A record member called `left`, `text`
    or `event` makes calls whose words include it fail to resolve, or the
    whole module report "Cycle detected in precedence declarations"
    ([dynlex#19](https://github.com/OpenAEC-Foundation/dynlex/issues/19)).
22. **Keep a bit buffer below the sign bit.** The inflater held up to 64 bits
    in a signed 64-bit integer; every stream longer than a few bytes failed
    until it stopped at 56.
