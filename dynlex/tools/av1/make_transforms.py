#!/usr/bin/env python3
"""Writes dynlex/paint/av1_transforms.dl: AV1's one-dimensional inverse
transforms (DCT 4 to 64, ADST 4 to 16) translated from rav1e 0.8.1's
src/transform/inverse.rs (BSD 2-Clause; bit-exact ports of libaom's
av1_inv_txfm1d.c).

The Rust functions are straight-line code: stage arrays become scalar
locals, nested calls to the smaller DCT are inlined with renamed locals, and
every expression is written out fully parenthesised. half_btf rounds by 12
bits; clamp_value clamps to the range the caller passes as low and high.
Run: python3 dynlex/tools/av1/make_transforms.py
"""
import ast, glob, re, sys
from pathlib import Path

here = Path(__file__).resolve().parent
target = here.parents[1] / "paint" / "av1_transforms.dl"
found = sorted(glob.glob(str(Path.home() / ".cargo/registry/src/*/rav1e-0.8.1")))
if not found:
    sys.exit("rav1e-0.8.1 is not in the Cargo registry")
source = (Path(found[0]) / "src/transform/inverse.rs").read_text()
source = re.sub(r"//[^\n]*", "", source)

def constant_array(name):
    m = re.search(r"static " + name + r": \[i32; \d+\] = \[(.*?)\];", source, re.S)
    return [int(v) for v in re.findall(r"-?\d+", m.group(1))]
COSPI = constant_array("COSPI_INV")
SINPI = constant_array("SINPI_INV")

def body_of(name):
    m = re.search(r"fn " + name + r"\(input: &\[i32\], output: &mut \[i32\], _?range: usize\) \{", source)
    i = m.end(); depth = 1
    while depth:
        if source[i] == "{": depth += 1
        elif source[i] == "}": depth -= 1
        i += 1
    return source[m.end():i - 1]

def statements(body):
    out, depth, start = [], 0, 0
    for i, ch in enumerate(body):
        if ch in "([{": depth += 1
        elif ch in ")]}": depth -= 1
        elif ch == ";" and depth == 0:
            out.append(body[start:i].strip()); start = i + 1
    return [s for s in out if s]

class Emitter:
    def __init__(self):
        self.lines = []
        self.counter = 0

    def expression(self, node, scope):
        if isinstance(node, ast.Constant):
            v = node.value
            return str(v) if v >= 0 else f"(0 - {-v})"
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            inner = self.expression(node.operand, scope)
            return f"(0 - {inner})"
        if isinstance(node, ast.BinOp):
            ops = {ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.RShift: ">>", ast.LShift: "<<"}
            return f"({self.expression(node.left, scope)} {ops[type(node.op)]} {self.expression(node.right, scope)})"
        if isinstance(node, ast.Subscript):
            base = node.value.id
            index = node.slice.value
            if base == "COSPI_INV":
                return str(COSPI[index])
            if base == "SINPI_INV":
                return str(SINPI[index])
            return scope["array"](base, index)
        if isinstance(node, ast.Name):
            if node.id == "INV_COS_BIT":
                return "12"
            return scope["scalar"](node.id)
        if isinstance(node, ast.Call):
            name = node.func.id
            args = [self.expression(a, scope) for a in node.args]
            if name == "half_btf":
                return f"(av1 half btf {args[0]} {args[1]} {args[2]} {args[3]})"
            if name == "clamp_value":
                return f"({args[0]} clamped between low and high)"
            if name == "round_shift":
                return f"(av1 round {args[0]} by {args[1]})"
        raise ValueError(ast.dump(node))

    def function(self, name, input_of, output_to, prefix):
        """Emits the body of rav1e function name; input_of(k) gives the
        expression of input k, output_to(k, e) the statement storing output k."""
        arrays, scalars = {}, {}
        def array(base, index):
            if base == "input":
                return input_of(index)
            return f"{prefix}{base}x{index}"
        def scalar(base):
            if base in ("range", "bit"):
                return {"range": "range", "bit": "12"}[base]
            return f"{prefix}{base}"
        scope = {"array": array, "scalar": scalar}
        for statement in statements(body_of(name)):
            if statement.startswith("assert"):
                continue
            m = re.match(r"let (mut )?(\w+)(: \[i32; (\d+)\])? = \[0; \d+\]$", statement)
            if m:
                for k in range(int(m.group(4))):
                    self.lines.append(f"        set {prefix}{m.group(2)}x{k} to 0")
                continue
            m = re.match(r"let (mut )?(\w+) = \[(.*)\]$", statement, re.S)
            if m:
                items = ast.parse("[" + m.group(3) + "]", mode="eval").body.elts
                values = [self.expression(item, scope) for item in items]
                for k, value in enumerate(values):
                    self.lines.append(f"        set {prefix}{m.group(2)}x{k} to {value}")
                continue
            m = re.match(r"let (\w+) = (.*)$", statement, re.S)
            if m:
                if m.group(1) == "bit":
                    continue
                value = self.expression(ast.parse(m.group(2), mode="eval").body, scope)
                self.lines.append(f"        set {prefix}{m.group(1)} to {value}")
                continue
            m = re.match(r"output\[(\d+)\] = (.*)$", statement, re.S)
            if m:
                value = self.expression(ast.parse(m.group(2), mode="eval").body, scope)
                self.lines.append(output_to(int(m.group(1)), value))
                continue
            m = re.match(r"(av1_\w+)\(&(\w+), &mut (\w+), range\)$", statement)
            if m:
                self.counter += 1
                inner = f"{prefix}n{self.counter}"
                source_array, target_array = m.group(2), m.group(3)
                self.function(m.group(1),
                              lambda k, a=source_array: f"{prefix}{a}x{k}",
                              lambda k, e, a=target_array: f"        set {prefix}{a}x{k} to {e}",
                              inner)
                continue
            raise ValueError(statement)

lines = ["# Generated by dynlex/tools/av1/make_transforms.py from rav1e 0.8.1's inverse",
         "# transforms (BSD 2-Clause, Copyright (c) 2018-2022 the rav1e contributors;",
         "# ports of libaom's av1_inv_txfm1d.c). Do not edit.",
         "import lib/std.dl", "",
         "function av1 half btf {integer:w0} {integer:in0} {integer:w1} {integer:in1}:",
         "    execute:",
         "        set sum to ((w0 as a C long integer) * (in0 as a C long integer)) + ((w1 as a C long integer) * (in1 as a C long integer))",
         "        return ((sum + (2048 as a C long integer)) >> 12) as an integer", "",
         "function av1 round {integer:value} by {integer:bits}:",
         "    execute:",
         "        return (value + (1 << (bits - 1))) >> bits", ""]
for name, label in [("av1_idct4", "idct4"), ("av1_idct8", "idct8"), ("av1_idct16", "idct16"), ("av1_idct32", "idct32"),
                    ("av1_idct64", "idct64"), ("av1_iadst4", "iadst4"), ("av1_iadst8", "iadst8"), ("av1_iadst16", "iadst16")]:
    emitter = Emitter()
    emitter.function(name, lambda k: f"(the item at {k} in input)", lambda k, e: f"        store {e} at (output + {k})", "t")
    lines.append(f"# rav1e {name}.")
    lines.append(f"function av1 {label} from {{a pointer to an integer:input}} into {{a pointer to an integer:output}} within {{integer:low}} {{integer:high}}:")
    lines.append("    execute:")
    lines += emitter.lines
    lines.append("")
target.write_text("\n".join(lines))
print(f"wrote {target}: {len(lines)} lines")
