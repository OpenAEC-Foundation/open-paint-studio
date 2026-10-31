#!/usr/bin/env python3
"""Turns the measured browser editor into the native shell's skin.

measure.js, run in the browser editor (with the desktop title bar), writes one
JSON file per state and window size into measurements/: every visible box,
text line, icon and control with its exact rectangle and computed style. This
script compares the states and sizes and writes rust/src/skin_data.rs:

  - the elements in paint order, each with the condition under which it shows
    (ribbon tab, open menu, empty or filled history, selected tool or colour);
  - per element how its rectangle follows the window, derived from the three
    measured sizes (1440 x 940, 1200 x 940, 1440 x 800);
  - boxes with radius, border or shadow, and the Lucide icons, as SVG that the
    shell rasterises once through gdk-pixbuf;
  - text with font, weight, size, colour and letter spacing, its changing
    parts as fields ({name}, {w}, {zoom}, ...);
  - click regions with the action each starts;
  - the history list's row templates.

    python3 rust/tools/make_skin.py

Taken from the DynLex edition (dynlex/tools/shell/make_skin.py on the
dynlex/native-port branch); only the tabs, the paths and the output (Rust
instead of DynLex) differ.
"""
import json, math, re, sys
from pathlib import Path

here = Path(__file__).resolve().parent
measured = here / "measurements"
target = here.parent / "src" / "skin_data.rs"
W0, H0, W1, H1 = 1440, 940, 1200, 800
TABS = ["Start", "Afbeelding", "Beeld", "Automatisering"]

def load(name):
    return json.load(open(measured / f"{name}.json"))["items"]

def color(text):
    m = re.match(r"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)", text or "")
    if not m:
        return None
    a = float(m.group(4)) if m.group(4) is not None else 1.0
    return (int(float(m.group(1))), int(float(m.group(2))), int(float(m.group(3))), round(a * 255))

def hexa(c):
    return "%02x%02x%02x%02x" % c

def css(c):
    return f"rgb({c[0]},{c[1]},{c[2]})", c[3] / 255

def px(text, size=0.0):
    text = (text or "0").strip()
    if text.endswith("%"):
        return float(text[:-1]) / 100 * size
    return float(text.replace("px", "") or 0) if text not in ("normal", "auto") else 0.0

# --- The elements of the canvas area are drawn by the shell itself. ---
def is_canvas_area(item):
    """The canvas, its shadow, corner handle and size label follow the zoom."""
    return re.search(r"/main:\d+/div:1/", item["p"]) is not None

# --- Fields: texts that change with the document and the view. ---
FIELD_TEXTS = {"Untitled": "{name}", ".ifcx": "{ext}", "1200": "{w}", "800": "{h}", "Penseel": "{tool}",
               "Concept opgeslagen op dit apparaat": "{status}", "Concept opslaan\u2026": "{status}"}

def field_of(text, item, run_index, runs):
    p = item["p"]
    if text in FIELD_TEXTS and not (text == "Penseel" and "aside" in p):
        return FIELD_TEXTS[text]
    if "footer" in p and re.fullmatch(r"-?\d+", text) and len(runs) >= 3:
        return "{mx}" if run_index == 0 else "{my}"
    if "footer" in p and re.fullmatch(r"\d+", text) and runs[-1]["t"] == "%":
        return "{zoom}"
    if item["tag"] == "b" and "aside" in p and re.fullmatch(r"\d+", text):
        return "{count}"
    if re.fullmatch(r"\d+", text) and len(runs) == 2 and runs[1]["t"] == "%" and "label" in p:
        return "{opacity}"
    return text

# --- Rectangles and how they follow the window. ---
def snap(v):
    """WebKit snaps half pixels up; Python's round() would take them to even."""
    return math.floor(v + 0.5)

def snapped(r):
    x0, y0 = snap(r[0]), snap(r[1])
    return x0, y0, snap(r[0] + r[2]) - x0, snap(r[1] + r[3]) - y0

def anchor(r0, rw, rh):
    """x, w follow the width by kx, kw; y, h follow the height by ky, kh."""
    k = lambda a, b, d: round((a - b) / d, 3)
    kx = k(r0[0], rw[0], W0 - W1) if rw else 0
    kw = k(r0[2], rw[2], W0 - W1) if rw else 0
    ky = k(r0[1], rh[1], H0 - H1) if rh else 0
    kh = k(r0[3], rh[3], H0 - H1) if rh else 0
    return f"{kx:g},{kw:g},{ky:g},{kh:g}"

class Sizes:
    """Rectangles of one state at the other two window sizes, by path."""
    def __init__(self, name, fallback=None):
        self.w = self.index(f"{W1}x{H0}-{name}") or (fallback.w if fallback else {})
        self.h = self.index(f"{W0}x{H1}-{name}") or (fallback.h if fallback else {})
    @staticmethod
    def index(name):
        try:
            items = load(name)
        except FileNotFoundError:
            return None
        out = {}
        for it in items:
            out[it["p"]] = it["r"]
            for ri, run in enumerate(it.get("text", {}).get("runs", [])):
                for li, line in enumerate(run["lines"]):
                    out[f"{it['p']}#{ri}.{li}"] = line["r"]
        return out
    def of(self, key):
        def find(index):
            k = key
            while k:
                if k in index:
                    return index[k], k == key
                k = k.rsplit("/", 1)[0] if "/" in k else ""
            return None, False
        rw, exact_w = find(self.w)
        rh, exact_h = find(self.h)
        return rw, rh, exact_w and exact_h

# --- SVG for boxes that are more than a plain rectangle. ---
def corner_radii(b, w, h):
    rad = [px(r.split()[0], min(w, h)) for r in b["rad"]]
    return [min(r, w / 2, h / 2) for r in rad]

def rounded_path(x, y, w, h, r):
    tl, tr, br, bl = r
    return (f"M{x+tl},{y}H{x+w-tr}" + (f"A{tr},{tr} 0 0 1 {x+w},{y+tr}" if tr else "") +
            f"V{y+h-br}" + (f"A{br},{br} 0 0 1 {x+w-br},{y+h}" if br else "") +
            f"H{x+bl}" + (f"A{bl},{bl} 0 0 1 {x},{y+h-bl}" if bl else "") +
            f"V{y+tl}" + (f"A{tl},{tl} 0 0 1 {x+tl},{y}" if tl else "") + "Z")

def shadows(text):
    out = []
    for part in re.findall(r"(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?", text or ""):
        out.append((color(part[0]), float(part[1]), float(part[2]), float(part[3]), float(part[4] or 0)))
    return out

def box_svg(b, w, h):
    """The SVG of a box of w x h and the margin around it the SVG needs."""
    r = corner_radii(b, w, h)
    bw = b["bw"]; bc = [color(c) for c in b["bc"]]
    shs = shadows(b["sh"])
    ol = b.get("ol")
    margin = 0
    for c, ox, oy, blur, spread in shs:
        margin = max(margin, int(blur + abs(ox) + abs(oy) + abs(spread) + 2))
    if ol:
        margin = max(margin, int(px(ol[0]) + px(ol[2]) + 2))
    m = margin
    parts = []
    defs = []
    for i, (c, ox, oy, blur, spread) in enumerate(reversed(shs)):
        fill, op = css(c)
        defs.append(f'<filter id="s{i}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="{blur/2:g}"/></filter>')
        sr = [max(0, v + spread) for v in r]
        parts.append(f'<path d="{rounded_path(m+ox-spread, m+oy-spread, w+2*spread, h+2*spread, sr)}" fill="{fill}" fill-opacity="{op:g}" filter="url(#s{i})"/>')
    bg = color(b["bg"])
    uniform = len(set(bw)) == 1 and len(set(b["bc"])) == 1 and bw[0] > 0 and bc[0][3] > 0
    if bg and bg[3] > 0:
        fill, op = css(bg)
        parts.append(f'<path d="{rounded_path(m, m, w, h, r)}" fill="{fill}" fill-opacity="{op:g}"/>')
    if uniform:
        s = bw[0]; stroke, op = css(bc[0])
        parts.append(f'<path d="{rounded_path(m+s/2, m+s/2, w-s, h-s, [max(0, v-s/2) for v in r])}" fill="none" stroke="{stroke}" stroke-opacity="{op:g}" stroke-width="{s:g}"/>')
    elif any(v > 0 for v in bw):
        # Sides of differing width or colour: each a band clipped to the shape.
        defs.append(f'<clipPath id="c"><path d="{rounded_path(m, m, w, h, r)}"/></clipPath>')
        bands = [(m, m, w, bw[0]), (m+w-bw[1], m, bw[1], h), (m, m+h-bw[2], w, bw[2]), (m, m, bw[3], h)]
        for (x, y, bwid, bhei), c, width in zip(bands, bc, bw):
            if width > 0 and c and c[3] > 0:
                fill, op = css(c)
                parts.append(f'<rect x="{x:g}" y="{y:g}" width="{bwid:g}" height="{bhei:g}" fill="{fill}" fill-opacity="{op:g}" clip-path="url(#c)"/>')
    if ol:
        ow, oc, off = px(ol[0]), color(ol[1]), px(ol[2])
        stroke, op = css(oc)
        e = off + ow / 2
        parts.append(f'<path d="{rounded_path(m-e, m-e, w+2*e, h+2*e, [v+e if v else 0 for v in r])}" fill="none" stroke="{stroke}" stroke-opacity="{op:g}" stroke-width="{ow:g}"/>')
    if not parts:
        return None, 0
    W, H = w + 2 * m, h + 2 * m
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + (f"<defs>{''.join(defs)}</defs>" if defs else "") + "".join(parts) + "</svg>"
    return svg, m

def plain_box(b):
    return all(px(r.split()[0], 10) == 0 for r in b["rad"]) and not b["sh"] and not b["img"] and not b.get("ol") and not b.get("bi")

def border_image(b, w, h):
    """A border-image of a linear gradient (the title bar's amber line): the
    border bands filled with the gradient, as SVG; None for anything else."""
    m = re.match(r"linear-gradient\((\d+)deg,\s*(.*)\)$", b.get("bi") or "")
    if not m or m.group(1) != "90":
        return None
    stops = []
    for part in re.findall(r"(rgba?\([^)]*\))\s*([\d.]+%)?", m.group(2)):
        stops.append((color(part[0]), part[1]))
    for i, (c, at) in enumerate(stops):
        if not at:
            stops[i] = (c, "0%" if i == 0 else ("100%" if i == len(stops) - 1 else None))
    # Stops without a position lie halfway between their neighbours.
    for i, (c, at) in enumerate(stops):
        if at is None:
            before = float(stops[i - 1][1][:-1]); after = next(float(s[1][:-1]) for s in stops[i + 1:] if s[1])
            stops[i] = (c, f"{(before + after) / 2:g}%")
    grad = "".join(f'<stop offset="{at}" stop-color="rgb({c[0]},{c[1]},{c[2]})" stop-opacity="{c[3] / 255:g}"/>' for c, at in stops)
    bw = b["bw"]
    bands = [(0, 0, w, bw[0]), (w - bw[1], 0, bw[1], h), (0, h - bw[2], w, bw[2]), (0, 0, bw[3], h)]
    rects = "".join(f'<rect x="{x:g}" y="{y:g}" width="{bw_:g}" height="{bh:g}" fill="url(#g)"/>' for x, y, bw_, bh in bands if bw_ > 0 and bh > 0)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" preserveAspectRatio="none">'
            f'<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{w}" y2="0">{grad}</linearGradient></defs>{rects}</svg>')

def icon_svg(item, w, h, opacity):
    svg = item["svg"]
    c = color(item["color"]) or (0, 0, 0, 255)
    fill, op = css(c)
    svg = svg.replace('stroke="currentColor"', f'stroke="{fill}" stroke-opacity="{op * opacity:g}"')
    svg = svg.replace('fill="currentColor"', f'fill="{fill}" fill-opacity="{op * opacity:g}"')
    sw = item.get("sw", "").replace("px", "")
    if sw:
        svg = re.sub(r'stroke-width="[^"]*"', f'stroke-width="{sw}"', svg, count=1)
    svg = re.sub(r'\swidth="[^"]*"', f' width="{w}"', svg, count=1)
    svg = re.sub(r'\sheight="[^"]*"', f' height="{h}"', svg, count=1)
    svg = re.sub(r'\sclass="[^"]*"', "", svg)
    if "xmlns=" not in svg:
        svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
    return svg

# --- Fonts as the browser picks them: the nearest loaded face. ---
INTER_LATIN = set(range(0x00, 0x100)) | {0x131, 0x152, 0x153, 0x2bb, 0x2bc, 0x2c6, 0x2da, 0x2dc, 0x304, 0x308, 0x329, 0x20ac, 0x2122, 0x2191, 0x2193, 0x2212, 0x2215, 0xfeff, 0xfffd} | set(range(0x2000, 0x2070))

def face(family, weight, text=""):
    f = family.split(",")[0].strip().strip('"').lower()
    if any(ord(ch) not in INTER_LATIN for ch in text):
        return "fallback"
    if "grotesk" in f:
        return "grotesk"
    if "mono" in f:
        return "mono"
    w = int(weight)
    return "inter400" if w < 450 else ("inter500" if w < 550 else "inter600")

# --- Actions of the click regions. ---
TOOLS = {"Penseel": "brush", "Gum": "eraser", "Vullen": "fill", "Pipet": "picker", "Lijn": "line",
         "Rechthoek": "rectangle", "Ellips": "ellipse", "Tekst": "text", "Objecten selecteren": "select"}

def action(item, details):
    c = item["click"]
    label, title, text = c["label"], c["title"], c["text"].split("\n")[0].strip()
    if item["tag"] == "summary":
        return f"toggle:{details.index(item['det'])}"
    if text in TABS and "nav" in item["p"]:
        return f"tab:{text}"
    if text == "Bestand":
        return "file"
    if label in TOOLS:
        return f"tool:{TOOLS[label]}"
    if re.fullmatch(r"#[0-9a-f]{6}", label):
        return f"color:{label}"
    if item["tag"] == "input":
        kind = item["input"]["type"]
        return {"checkbox": "vector", "number": "size", "color": "pick", "range": "zoomslider" if "footer" in item["p"] else "opacity"}.get(kind, "")
    if item["tag"] == "label":
        return "pick" if label == "Kleur" else ""
    if item["tag"] == "select":
        return "background"
    name = label or title or text
    if re.fullmatch(r"\d+%", name):
        name = "actual"
    return ("menu:" if item.get("det") else "cmd:") + name if name else ""

# --- Paint-order entries of one state. ---
def opacity_of(item, by_path):
    op = 1.0
    p = item["p"]
    while p:
        it = by_path.get(p)
        if it:
            op *= float(it.get("op", 1))
        p = p.rsplit("/", 1)[0] if "/" in p else ""
    return op

class Out(list):
    """Entries with the element path each came from, kept beside them."""
    def __init__(self):
        super().__init__(); self.paths = []; self._p = ""
    def append(self, e):
        super().append(e); self.paths.append(self._p)

def entries(state, sizes, details):
    items = load(f"{W0}x{H0}-{state}")
    by_path = {it["p"]: it for it in items}
    out = Out()
    for it in items:
        out._p = it["p"]
        if is_canvas_area(it):
            continue
        op = opacity_of(it, by_path)
        rw, rh, _ = sizes.of(it["p"])
        r = it["r"]
        x, y, w, h = snapped(r)
        a = anchor(r, rw, rh)
        if it.get("box"):
            b = it["box"]
            if plain_box(b):
                bg = color(b["bg"])
                if bg and bg[3] > 0:
                    out.append(("rect", a, x, y, w, h, hexa(bg[:3] + (round(bg[3] * op),))))
                bands = [(x, y, w, b["bw"][0]), (x + w - b["bw"][1], y, b["bw"][1], h), (x, y + h - b["bw"][2], w, b["bw"][2]), (x, y, b["bw"][3], h)]
                for (bx, by, bwid, bhei), cc, width in zip(bands, b["bc"], b["bw"]):
                    c = color(cc)
                    if width > 0 and c and c[3] > 0:
                        out.append(("rect", a, snap(bx), snap(by), snap(bwid), snap(bhei), hexa(c[:3] + (round(c[3] * op),))))
            if not plain_box(b):
                svg, m = box_svg(b, w, h)
                if svg:
                    if op < 1:
                        svg = svg.replace("<svg ", f'<svg opacity="{op:g}" ', 1)
                    out.append(("image", a, x - m, y - m, w + 2 * m, h + 2 * m, svg))
            if b.get("bi") and border_image(b, w, h):
                out.append(("image", a, x, y, w, h, border_image(b, w, h)))
        if it.get("svg"):
            out.append(("image", a, x, y, w, h, icon_svg(it, w, h, op)))
        if it.get("img"):
            src = here.parents[1] / "public" / it["img"]["src"].lstrip("/")
            if src.exists():
                markup = src.read_text()
                markup = re.sub(r"<\?xml[^>]*>", "", markup).strip()
                markup = re.sub(r"<svg([^>]*?)\swidth=\"[^\"]*\"", r"<svg\1", markup, count=1)
                markup = re.sub(r"<svg([^>]*?)\sheight=\"[^\"]*\"", r"<svg\1", markup, count=1)
                markup = markup.replace("<svg", f'<svg width="{w}" height="{h}"', 1)
                out.append(("image", a, x, y, w, h, " ".join(markup.split())))
        if it.get("input"):
            out.append(("control", a, x, y, w, h, it["input"]["type"]))
        if it.get("text"):
            t = it["text"]
            c = color(t["color"])
            c = c[:3] + (round(c[3] * op),)
            ls = px(t["ls"])
            runs = t["runs"]
            gaps = [runs[k]["lines"][0]["r"][0] - (runs[k - 1]["lines"][0]["r"][0] + runs[k - 1]["lines"][0]["r"][2]) for k in range(1, len(runs))] if all(len(r["lines"]) == 1 for r in runs) else [99]
            if len(runs) > 1 and max(gaps) < 6 and len(set(round(r["lines"][0]["r"][1]) for r in runs)) == 1:
                # One line in several text nodes ("0", ",", "0", "px"): one text,
                # its fields inside, spaces where the browser left a gap.
                parts = []
                end = None
                for ri, run in enumerate(runs):
                    lr = run["lines"][0]["r"]
                    if end is not None and lr[0] - end > 1.5:
                        parts.append(" ")
                    parts.append(field_of(run["t"], it, ri, runs))
                    end = lr[0] + lr[2]
                first = runs[0]["lines"][0]["r"]
                lr = [first[0], first[1], end - first[0], first[3]]
                value = "".join(parts)
                align = "l"
                if "{" in value and t["align"] == "center":
                    align = "c"
                    lr = it["r"]
                elif value.startswith("{tool}"):
                    align = "r"
                ra = anchor(lr, *sizes.of(f"{it['p']}#0.0")[:2])
                out.append(("text", ra, lr[0], lr[1], lr[2], lr[3], face(t["font"], t["weight"], value), px(t["size"]), hexa(c), ls, align, value))
                runs = []
            for ri, run in enumerate(runs):
                value = field_of(run["t"], it, ri, runs)
                if t["tt"] == "uppercase":
                    value = value.upper()
                lines = run["lines"]
                if len(lines) > 1:
                    # Wrapped: one entry that wraps to the element's width.
                    lr = lines[0]["r"]
                    pitch = lines[1]["r"][1] - lines[0]["r"][1]
                    # Centred lines centre in the element, not after the first line's start.
                    x = it["r"][0] if t["align"] == "center" else lr[0]
                    out.append(("text", anchor(lr, *sizes.of(f"{it['p']}#{ri}.0")[:2]), x, lr[1], it["r"][2], pitch, face(t["font"], t["weight"], value), px(t["size"]), hexa(c), ls, "wrap", value))
                    continue
                lr = lines[0]["r"]
                align = "l"
                if value.startswith("{") and t["align"] == "center":
                    align = "c"
                    lr = it["r"]
                elif value in ("{tool}",):
                    align = "r"
                ra = anchor(lr, *sizes.of(f"{it['p']}#{ri}.0")[:2])
                out.append(("text", ra, lr[0], lr[1], lr[2], lr[3], face(t["font"], t["weight"], value), px(t["size"]), hexa(c), ls, align, value))
        if it.get("click"):
            act = action(it, details)
            if act:
                out.append(("hit", a, x, y, w, h, act))
    return out

def key(e):
    if e[0] == "text" and e[10] == "follow":
        e = e[:2] + e[3:4] + e[5:]
    return tuple(str(v) for v in e)

def with_followers(es):
    """A text that starts right after a field on the same line moves with it:
    it becomes "follow", its gap to the field's measured end kept in w."""
    out = Out()
    prev = None
    for e, p in zip(es, es.paths):
        if e[0] == "text" and prev is not None and prev[0] == "text" and prev[10] in ("l", "follow") and \
                ("{" in prev[11] or prev[10] == "follow") and abs(e[3] - prev[3]) < 8 and 0 <= e[2] - (prev[2] + prev[4]) < 14:
            gap = e[2] - (prev[2] + prev[4])
            e = e[:4] + (gap,) + e[5:10] + ("follow",) + e[11:]
        out._p = p
        out.append(e)
        if e[0] == "text":
            prev = e
    return out

# --- Rust output ---
FACES = {"inter400": 0, "inter500": 1, "inter600": 2, "grotesk": 3, "mono": 4, "fallback": 5}
KINDS = {"rect": "Rect", "image": "Image", "text": "Text", "hit": "Hit", "control": "Control"}
ALIGN = {"l": 0, "c": 1, "r": 2, "wrap": 3, "follow": 4}

def num(v):
    return repr(float(v))

def rs_string(text):
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'

class Cond:
    def __init__(self, tab=-1, opened=-1, closed=0, history=-1, tool="", swatch="", row=-1):
        self.tab, self.opened, self.closed, self.history, self.tool, self.swatch, self.row = tab, opened, closed, history, tool, swatch, row

def main():
    details = []
    for it in load(f"{W0}x{H0}-Start"):
        if it["tag"] == "summary" and it.get("det") and it["det"] not in details:
            details.append(it["det"])
    per_tab = {t: with_followers(entries(t, Sizes(t), details)) for t in TABS}
    base = per_tab["Start"]
    common = set(key(e) for e in base)
    for t in TABS[1:]:
        common &= set(key(e) for e in per_tab[t])
    hist = with_followers(entries("history", Sizes("history", Sizes("Start")), details))
    hist_keys = set(key(e) for e in hist)
    opened = {i: entries(f"Start-open{i}", Sizes(f"Start-open{i}"), details) for i in range(len(details))}
    opened_keys = {i: set(key(e) for e in es) for i, es in opened.items()}
    out = []   # (Cond, entry, path)
    for e, p in zip(base, base.paths):
        k = key(e)
        tab = -1 if k in common else 0
        c = Cond(tab=tab)
        if k not in hist_keys:
            c.history = 0
        for i, ks in opened_keys.items():
            if k not in ks:
                c.closed |= 1 << i
        out.append((c, e, p))
    def placeless(e):
        return tuple(str(v) for k, v in enumerate(e) if k != 1)
    hist_placeless = set(placeless(e) for e in hist)
    empty_only = set(key(e) for e in base if key(e) not in hist_keys)
    for ti, t in enumerate(TABS[1:], 1):
        for e, p in zip(per_tab[t], per_tab[t].paths):
            if key(e) not in common:
                out.append((Cond(tab=ti, history=0 if (key(e) in empty_only or (e[2] >= 1204 and 426 < e[3] < 845 and placeless(e) not in hist_placeless)) else -1), e, p))
    base_keys = set(key(e) for e in base)
    # History: the rows become templates; anything else it adds shows when filled.
    row_re = re.compile(r"(aside:\d+/div:\d+)/div:(\d+)")
    rows = {}
    for e, p in zip(hist, hist.paths):
        if key(e) in base_keys:
            continue
        m = row_re.search(p)
        if m and "/div:3" in m.group(1):
            rows.setdefault(int(m.group(2)), []).append(e)
        else:
            out.append((Cond(tab=-1, history=1), e, p))
    tops = {}
    for k, es in rows.items():
        tops[k] = min(e[3] for e in es if e[0] in ("text",)) if any(e[0] == "text" for e in es) else 0
    pitch = tops[1] - tops[0] if 1 in tops else 33
    for k in (0, 1):
        for e in rows.get(k, []):
            e = list(e)
            e[3] = e[3] - (tops[k] - tops[0])
            if e[0] == "text":
                if re.fullmatch(r"\d\d", e[-1]):
                    e[-1] = "{step}"
                else:
                    e[-1] = "{stepname}"
            out.append((Cond(tab=-1, history=1, row=k), tuple(e), ""))
    # The file panel over any tab.
    try:
        back = entries("backstage", Sizes("backstage"), details)
        for e, p in zip(back, back.paths):
            if key(e) not in base_keys:
                out.append((Cond(opened=9), e, p))
    except FileNotFoundError:
        pass
    # Open menus on top.
    for i, es in opened.items():
        for e, p in zip(es, es.paths):
            if key(e) not in base_keys:
                out.append((Cond(tab=0, opened=i), e, p))
    # Tools: the selected tool's box at every tool button.
    hits = {e[-1]: e for c, e, p in out if e[0] == "hit"}
    tool_box = next(((c, e, p) for c, e, p in out if e[0] == "image" and hits.get("tool:brush") and (e[2], e[3]) == (hits["tool:brush"][2], hits["tool:brush"][3]) and "lucide" not in e[-1]), None)
    if tool_box:
        out.remove(tool_box)
        idx = next(n for n, (c, e, p) in enumerate(out) if e[0] == "hit" and e[-1] == "tool:brush")
        for name in TOOLS.values():
            h = hits.get(f"tool:{name}")
            if h:
                e = list(tool_box[1]); e[1], e[2], e[3] = h[1], h[2], h[3]
                out.insert(idx, (Cond(tab=0, tool=name), tuple(e), ""))
    # Swatches: plain everywhere, the outlined one only for the current colour.
    active = None
    for n, (c, e, p) in enumerate(out):
        if e[0] == "image" and "stroke-width=\"2\"" in e[-1] and "rgb(217,119,6)" in e[-1] and hits.get("color:#36363e") and abs(e[2] - hits["color:#36363e"][2]) <= 6 and abs(e[3] - hits["color:#36363e"][3]) <= 6:
            active = (n, c, e)
    if active:
        n, c, e = active
        h0 = hits["color:#36363e"]
        plain = next(((cc, ee, pp) for cc, ee, pp in out if ee[0] == "image" and ee[2:6] == hits["color:#ffffff"][2:6]), None)
        out.pop(n)
        swatches = [(cc, ee, pp) for cc, ee, pp in out if ee[0] == "hit" and ee[-1].startswith("color:")]
        for cc, ee, pp in swatches:
            hexcol = ee[-1][6:]
            rgb = "rgb(%d,%d,%d)" % tuple(int(hexcol[i:i + 2], 16) for i in (1, 3, 5))
            pos = next(m for m, x in enumerate(out) if x[1] is ee)
            # The outlined variant: the measured active swatch, recoloured and moved.
            ae = list(e); ae[2] = e[2] + (ee[2] - h0[2]); ae[3] = e[3] + (ee[3] - h0[3])
            ae[-1] = re.sub(r'fill="rgb\(54,54,62\)"', f'fill="{rgb}"', e[-1])
            out.insert(pos, (Cond(tab=0, swatch=hexcol), tuple(ae), ""))
        # Plain variants stay as measured but hide for the current colour.
        for m, (cc, ee, pp) in enumerate(out):
            if ee[0] == "image" and any(ee[2:6] == hh[2:6] for hh in [x[1] for x in swatches]):
                hexcol = next(x[1][-1][6:] for x in swatches if x[1][2:6] == ee[2:6])
                cc.swatch = "!" + hexcol
        h0plain = [x for x in out if x[1][0] == "image" and x[1][2:6] == h0[2:6]]
        if not h0plain and plain:
            pe = list(plain[1]); pe[1:6] = h0[1:6]
            pe[-1] = plain[1][-1].replace("rgb(255,255,255)", "rgb(54,54,62)")
            pos = next(m for m, x in enumerate(out) if x[1] is h0)
            out.insert(pos, (Cond(tab=0, swatch="!#36363e"), tuple(pe), ""))
    # The colour well shows the current colour.
    for n, (c, e, p) in enumerate(out):
        if e[0] == "image" and hits.get("pick") is None and "rgb(54,54,62)" in e[-1] and e[4] == 36 and e[5] in (50, 52):
            e = list(e); e[-1] = e[-1].replace('fill="rgb(54,54,62)"', 'fill="{color}"', 1); out[n] = (c, tuple(e), p)
    # Emit.
    svgs = {}
    lines = []
    for c, e, p in out:
        kind = e[0]
        kx, kw, ky, kh = (float(v) for v in e[1].split(","))
        x, y, w, h = e[2:6]
        image, faceno, size, colour, spacing, align, text, act = -1, 0, 0, "00000000", 0, 0, "", ""
        if kind == "rect":
            colour = e[6]
        elif kind == "image":
            if e[6] not in svgs:
                svgs[e[6]] = len(svgs)
            image = svgs[e[6]]
        elif kind == "text":
            faceno, size, colour, spacing, align, text = FACES[e[6]], int(round(e[7])), e[8], int(round(e[9] * 64)), ALIGN[e[10]], e[11]
        elif kind in ("hit", "control"):
            act = e[6]
        rgba = ", ".join(str(int(colour[n:n + 2], 16)) for n in (0, 2, 4, 6))
        lines.append(f"    E {{ kind: K::{KINDS[kind]}, tab: {c.tab}, opened: {c.opened}, closed: {c.closed}, history: {c.history}, row: {c.row}, tool: {rs_string(c.tool)}, swatch: {rs_string(c.swatch)}, "
                     f"k: [{num(kx)}, {num(kw)}, {num(ky)}, {num(kh)}], r: [{num(x)}, {num(y)}, {num(w)}, {num(h)}], image: {image}, face: {faceno}, size: {size}, color: [{rgba}], spacing: {spacing}, align: {align}, text: {rs_string(text)}, action: {rs_string(act)} }},")
    with open(target, "w") as f:
        f.write("// Generated by rust/tools/make_skin.py from the measured browser editor;\n")
        f.write("// do not edit. The shell's elements in paint order: see src/skin.rs.\n")
        f.write("use crate::skin::{Entry as E, Kind as K};\n\n")
        f.write(f"pub const HISTORY_PITCH: f64 = {float(pitch)!r};\n\n")
        f.write("pub static SVGS: &[&str] = &[\n")
        for svg, n in sorted(svgs.items(), key=lambda kv: kv[1]):
            f.write(f"    {rs_string(svg)},\n")
        f.write("];\n\npub static ENTRIES: &[E] = &[\n")
        for line in lines:
            f.write(line + "\n")
        f.write("];\n")
    print(f"{len(lines)} entries, {len(svgs)} SVG images, history pitch {pitch:g} -> {target}")

if __name__ == "__main__":
    main()
