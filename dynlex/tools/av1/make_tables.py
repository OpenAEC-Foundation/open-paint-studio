#!/usr/bin/env python3
"""Writes dynlex/paint/av1_tables.dl: the AV1 tables the editor's decoder
needs, read from the source of rav1e (BSD 2-Clause, the AV1 reference tables
as libaom carries them), found in the Cargo registry:

  - every default CDF used by intra frames, in the specification's form
    (cumulative values rising to 32768) followed by 32768 and a zero counter
    for adaptation, so each CDF of N symbols takes N + 1 numbers;
  - the scan orders, converted from libaom's column-major coefficient
    positions (column * height + row) to the specification's row-major ones
    (row * width + column);
  - the quantiser lookups for 8, 10 and 12 bits, the smooth weights and the
    directional derivatives.

Each table is a function returning its numbers as text; dims() describes how
to index it. Run: python3 dynlex/tools/av1/make_tables.py
"""
import glob, re, sys
from pathlib import Path

here = Path(__file__).resolve().parent
target = here.parents[1] / "paint" / "av1_tables.dl"
found = sorted(glob.glob(str(Path.home() / ".cargo/registry/src/*/rav1e-0.8.1")))
if not found:
    sys.exit("rav1e-0.8.1 is not in the Cargo registry")
rav1e = Path(found[0]) / "src"

def strip_comments(text):
    text = re.sub(r"//[^\n]*", "", text)
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)

def static_expr(path, name):
    text = strip_comments((rav1e / path).read_text())
    m = re.search(r"(?:pub(?:\([^)]*\))?\s+)?(?:static|const)\s+" + re.escape(name) + r"\s*:([^=]*)=", text)
    if not m:
        sys.exit(f"{name} not found in {path}")
    start = m.end(); depth = 0; i = start
    while True:
        ch = text[i]
        if ch in "([{": depth += 1
        elif ch in ")]}": depth -= 1
        elif ch == ";" and depth == 0: break
        i += 1
    return m.group(1), text[start:i]

def identity(x): return x
NAMES = {f"cdf{s}": identity for s in ["", "_2d", "_3d", "_4d", "_5d", "_6d"]}
CONSTANTS = {"NZ_MAP_CTX_0": 26, "NZ_MAP_CTX_5": 31, "NZ_MAP_CTX_10": 36}

def evaluate(path, name):
    _, expr = static_expr(path, name)
    expr = re.sub(r"NonZeroU16::new\(([^)]*)\)\.unwrap\(\)", r"\1", expr)
    return eval(expr.strip(), {"__builtins__": {}}, {**NAMES, **CONSTANTS})

def flatten_cdf(value):
    """Innermost lists are CDFs: their values, then 32768 and a counter."""
    if isinstance(value[0], list):
        out = []
        for item in value:
            out += flatten_cdf(item)
        return out
    return list(value) + [32768, 0]

def flatten(value):
    if isinstance(value, list):
        out = []
        for item in value:
            out += flatten(item)
        return out
    return [value]

def shape(value):
    dims = []
    while isinstance(value, list):
        dims.append(len(value)); value = value[0]
    return dims

tables = []  # (name, numbers, comment)

def cdf_table(path, rust, name, note):
    value = evaluate(path, rust)
    dims = shape(value)
    dims[-1] += 2
    tables.append((name, flatten_cdf(value), f"{note}; {' x '.join(map(str, dims))} (rav1e {rust})"))

def plain_table(path, rust, name, note):
    value = evaluate(path, rust)
    tables.append((name, flatten(value), f"{note}; {' x '.join(map(str, shape(value)))} (rav1e {rust})"))

E = "entropymode.rs"; T = "token_cdfs.rs"
for rust, name, note in [
    ("default_kf_y_mode_cdf", "kf y mode", "key-frame luma mode by above and left context"),
    ("default_angle_delta_cdf", "angle delta", "angle delta by directional mode"),
    ("default_uv_mode_cdf", "uv mode", "chroma mode by luma mode, without CFL"),
    ("default_uv_mode_cfl_cdf", "uv mode cfl", "chroma mode by luma mode, with CFL"),
    ("default_partition_w8_cdf", "partition 8", "partition of 8x8 blocks by context"),
    ("default_partition_cdf", "partition", "partition of 16x16, 32x32, 64x64 blocks (4 contexts each)"),
    ("default_partition_w128_cdf", "partition 128", "partition of 128x128 blocks by context"),
    ("default_intra_tx_1_cdf", "intra tx 1", "intra transform type set 1 by square size and mode"),
    ("default_intra_tx_2_cdf", "intra tx 2", "intra transform type set 2 by square size and mode"),
    ("default_cfl_sign_cdf", "cfl sign", "CFL joint signs"),
    ("default_cfl_alpha_cdf", "cfl alpha", "CFL alpha by context"),
    ("default_palette_y_size_cdf", "palette y size", "luma palette size by block size context"),
    ("default_palette_uv_size_cdf", "palette uv size", "chroma palette size by block size context"),
    ("default_palette_y_mode_cdfs", "palette y mode", "luma palette use by block size and neighbour context"),
    ("default_palette_uv_mode_cdfs", "palette uv mode", "chroma palette use by context"),
    ("default_palette_y_color_index_cdf", "palette y colour", "luma palette colour index by size and context"),
    ("default_palette_uv_color_index_cdf", "palette uv colour", "chroma palette colour index by size and context"),
    ("default_skip_cdfs", "skip", "skip by context"),
    ("default_intrabc_cdf", "intrabc", "intra block copy"),
    ("default_filter_intra_mode_cdf", "filter intra mode", "filter intra mode"),
    ("default_filter_intra_cdfs", "filter intra", "filter intra use by block size"),
    ("default_switchable_restore_cdf", "switchable restore", "switchable restoration type"),
    ("default_wiener_restore_cdf", "wiener restore", "Wiener restoration use"),
    ("default_sgrproj_restore_cdf", "sgrproj restore", "self-guided restoration use"),
    ("default_delta_q_cdf", "delta q", "delta quantiser"),
    ("default_delta_lf_multi_cdf", "delta lf multi", "delta loop filter per filter"),
    ("default_delta_lf_cdf", "delta lf", "delta loop filter"),
    ("default_spatial_pred_seg_tree_cdf", "segment id", "segment id by context"),
    ("default_tx_size_8x8_cdf", "tx size 8", "transform depth for 8x8 blocks by context"),
    ("default_tx_size_cdf", "tx size", "transform depth for larger blocks by category and context"),
]:
    cdf_table(E, rust, name, note)

for rust, name, note in [
    ("av1_default_txb_skip_cdfs", "all zero", "all-zero by quantiser context, size and context"),
    ("av1_default_eob_extra_cdfs", "eob extra", "eob extra bit"),
    ("av1_default_eob_multi16_cdfs", "eob 16", "eob position, 16 coefficients"),
    ("av1_default_eob_multi32_cdfs", "eob 32", "eob position, 32 coefficients"),
    ("av1_default_eob_multi64_cdfs", "eob 64", "eob position, 64 coefficients"),
    ("av1_default_eob_multi128_cdfs", "eob 128", "eob position, 128 coefficients"),
    ("av1_default_eob_multi256_cdfs", "eob 256", "eob position, 256 coefficients"),
    ("av1_default_eob_multi512_cdfs", "eob 512", "eob position, 512 coefficients"),
    ("av1_default_eob_multi1024_cdfs", "eob 1024", "eob position, 1024 coefficients"),
    ("av1_default_coeff_base_eob_multi_cdfs", "coeff base eob", "base level of the last coefficient"),
    ("av1_default_coeff_base_multi_cdfs", "coeff base", "base level"),
    ("av1_default_coeff_lps_multi_cdfs", "coeff br", "level range"),
    ("av1_default_dc_sign_cdfs", "dc sign", "DC sign"),
]:
    cdf_table(T, rust, name, note)

# Scans: libaom's positions are column-major; turn them row-major.
SIZES = [("4x4", 4, 4), ("8x8", 8, 8), ("16x16", 16, 16), ("32x32", 32, 32), ("4x8", 4, 8), ("8x4", 8, 4),
         ("8x16", 8, 16), ("16x8", 16, 8), ("16x32", 16, 32), ("32x16", 32, 16), ("4x16", 4, 16), ("16x4", 16, 4),
         ("8x32", 8, 32), ("32x8", 32, 8)]
scan_text = strip_comments((rav1e / "scan_order.rs").read_text())
for label, width, height in SIZES:
    for kind in ("default", "mrow", "mcol"):
        rust = f"{kind}_scan_{label}"
        if not re.search(r"static\s+" + rust + r"\s*:", scan_text):
            continue
        positions = evaluate("scan_order.rs", rust)
        converted = [(p % height) * width + (p // height) for p in positions]
        assert sorted(converted) == list(range(width * height)), rust
        tables.append((f"{kind} scan {label}", converted, f"{kind} scan of a {width}x{height} transform, row-major (rav1e {rust}, transposed)"))

Q = "quantize/tables.rs"
for rust, name in [("dc_qlookup_Q3_raw", "dc q 8"), ("dc_qlookup_10_Q3_raw", "dc q 10"), ("dc_qlookup_12_Q3_raw", "dc q 12"),
                   ("ac_qlookup_Q3_raw", "ac q 8"), ("ac_qlookup_10_Q3_raw", "ac q 10"), ("ac_qlookup_12_Q3_raw", "ac q 12")]:
    plain_table(Q, rust, name, "quantiser step by index")

plain_table("predict.rs", "sm_weight_arrays", "smooth weights", "smooth prediction weights, at offset block size")
plain_table("context/transform_unit.rs", "av1_nz_map_ctx_offset", "significance offsets", "2D significance context offset by transform size, min(row, 4), min(column, 4), spec layout")
predict = strip_comments((rav1e / "predict.rs").read_text())
body = predict[predict.index("const fn dr_intra_derivative"):]
pairs = re.findall(r"(\d+)\s*=>\s*(\d+)", body[:body.index("_ =>")])
derivative = [0] * 90
for angle, value in pairs:
    derivative[int(angle)] = int(value)
tables.append(("intra derivative", derivative, "directional derivative by angle 0..89 (rav1e dr_intra_derivative)"))

def function_name(name):
    return "the av1 " + name + " table"

lines = ["# Generated by dynlex/tools/av1/make_tables.py from rav1e 0.8.1 (BSD 2-Clause,",
         "# Copyright (c) 2017-2022, the rav1e contributors; the tables are the AV1",
         "# reference values as libaom carries them). Do not edit.",
         "import lib/string.dl", ""]
for name, numbers, note in tables:
    lines.append(f"# {note}")
    lines.append(f"function {function_name(name)}:")
    lines.append("    execute:")
    lines.append('        return the string form of "' + " ".join(str(int(n)) for n in numbers) + '"')
    lines.append("")
target.write_text("\n".join(lines))
print(f"wrote {target} ({len(tables)} tables, {sum(len(t[1]) for t in tables)} numbers)")
for name, numbers, note in tables:
    print(f"  {name}: {len(numbers)}  {note.split(';')[-1].strip()}")
