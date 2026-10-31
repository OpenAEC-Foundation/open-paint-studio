#!/usr/bin/env python3
"""Times the browser editor's own image opening in WebKitGTK, the engine of
its desktop build, for the comparison with the native edition.

Runs src/images.ts's decodeFile path verbatim in the built editor's page:
the native decoder up to 64 megapixels, scaled to at most 4096 px a side and
8.4 megapixels and re-encoded as PNG, and above that the editor's own
ImageMagick WebAssembly worker (its 40-second timeout included); then loads
the result into a canvas as the editor does and times redraws at ten zoom
levels. Prints one line of key=value pairs per image with the web process's
peak memory.

    (dist/__large -> dynlex/build/images/large, served at URL)
    DISPLAY=:97 python3 dynlex/bench/webkit_decode.py http://localhost:4173/ 4k.jpg 8k.jpg ...
"""
import json, sys, glob, os
import gi
gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

url, names = sys.argv[1], sys.argv[2:]
worker = "/assets/" + os.path.basename(glob.glob(os.path.join(os.path.dirname(__file__), "..", "..", "dist", "assets", "image.worker-*.js"))[0])
script = """
window.__bench = async (name) => {
  const t0 = performance.now();
  const blob = await (await fetch('/__large/' + name)).blob();
  const file = new File([blob], name);
  const t1 = performance.now();
  let result = null, path = 'native';
  if (/\\.(png|jpe?g|jfif|gif|webp|bmp|svg|avif|ico)$/i.test(file.name)) {
    const url = URL.createObjectURL(file), image = new Image();
    try {
      image.src = url; await image.decode();
      const original = { width: image.naturalWidth, height: image.naturalHeight };
      if (original.width * original.height > 64_000_000) throw new Error('Image exceeds 64 megapixels');
      const scale = Math.min(1, 4096 / original.width, 4096 / original.height, Math.sqrt(8_388_608 / (original.width * original.height)));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(original.width * scale)); canvas.height = Math.max(1, Math.floor(original.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image conversion failed')), 'image/png'));
      result = { bytes: new Uint8Array(await png.arrayBuffer()), width: canvas.width, height: canvas.height, original };
    } catch (e) { } finally { URL.revokeObjectURL(url); }
  }
  if (!result) {
    path = 'wasm';
    const bytes = await file.arrayBuffer();
    result = await new Promise((resolve, reject) => {
      const w = new Worker('WORKER', { type: 'module' });
      const timer = setTimeout(() => { w.terminate(); reject(new Error('Image processing timed out. Try a smaller file.')); }, 40000);
      w.onmessage = ({ data }) => { clearTimeout(timer); w.terminate(); data.error ? reject(new Error(data.error)) : resolve(data); };
      w.onerror = event => { clearTimeout(timer); w.terminate(); reject(new Error(event.message || 'Image decoder failed')); };
      w.postMessage({ type: 'decode', bytes, hint: name.split('.').pop() }, [bytes]);
    });
  }
  const t2 = performance.now();
  const bitmap = await createImageBitmap(new Blob([result.bytes], { type: 'image/png' }));
  const doc = document.createElement('canvas'); doc.width = result.width; doc.height = result.height;
  doc.getContext('2d').drawImage(bitmap, 0, 0); doc.getContext('2d').getImageData(0, 0, 1, 1);
  doc.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;image-rendering:auto';
  document.body.appendChild(doc);
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await frame();
  const t3 = performance.now();
  for (let step = 1; step <= 10; step++) { doc.style.width = (result.width * step / 10) + 'px'; doc.style.height = (result.height * step / 10) + 'px'; await frame(); }
  const t4 = performance.now();
  doc.remove();
  return { path, width: result.width, height: result.height, original: result.original.width + 'x' + result.original.height,
           decode_ms: Math.round(t2 - t1), first_frame_ms: Math.round(t3 - t2), zoom_frame_ms: Math.round((t4 - t3) / 10) };
};
'ready'
""".replace("WORKER", worker)

context = WebKit2.WebContext.new_ephemeral()
manager = WebKit2.UserContentManager()
manager.add_script(WebKit2.UserScript.new(script, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
view = WebKit2.WebView(user_content_manager=manager, web_context=context)
window = Gtk.Window(); window.add(view); window.set_default_size(1440, 940); window.show_all()
state = {"index": 0, "peak": 0}

def web_rss():
    total = 0
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            try:
                cmd = open(f"/proc/{pid}/cmdline", "rb").read()
                if b"WebKitWebProcess" in cmd and str(os.getpid()).encode() in open(f"/proc/{pid}/status", "rb").read().split(b"PPid:")[1][:16]:
                    total = max(total, int(open(f"/proc/{pid}/status").read().split("VmHWM:")[1].split()[0]))
            except Exception:
                pass
    return total

def run(code, done):
    view.evaluate_javascript(code, -1, None, None, None, lambda v, r: done(v.evaluate_javascript_finish(r).to_string()))

def poll():
    run("window.__result === undefined ? '' : window.__result", collect)
    return False

def collect(text):
    if not text:
        GLib.timeout_add(200, poll); return
    data = json.loads(text)
    name = names[state["index"]]
    print(name + ": " + " ".join(f"{k}={v}" for k, v in data.items()) + f" web_rss_kb={web_rss()}", flush=True)
    state["index"] += 1
    GLib.idle_add(start)

def start():
    if state["index"] >= len(names):
        Gtk.main_quit(); return False
    name = names[state["index"]]
    run(f"delete window.__result; window.__bench({json.dumps(name)}).then(r => window.__result = JSON.stringify(r), e => window.__result = JSON.stringify({{error: String(e)}})); 'started'", lambda _: GLib.timeout_add(300, poll))
    return False

view.connect("load-changed", lambda v, e: e == WebKit2.LoadEvent.FINISHED and GLib.timeout_add(1500, start))
view.load_uri(url)
GLib.timeout_add(600000, Gtk.main_quit)
Gtk.main()
