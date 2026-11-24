import { z } from 'zod';
import { transformPoint } from './geometry.js';

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const pointSchema = z.object({ x: z.number().finite().min(-8192).max(8192), y: z.number().finite().min(-8192).max(8192) });
const component = z.number().finite().min(-1_000_000).max(1_000_000);
const transform = z.tuple([component, component, component, component, component, component]).optional();
const style = { transform, color: colorSchema, size: z.number().min(1).max(200), opacity: z.number().min(0).max(1).default(1) };
export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['brush', 'eraser']), points: z.array(pointSchema).min(1).max(20000), ...style }),
  z.object({ type: z.enum(['line', 'rectangle', 'ellipse']), from: pointSchema, to: pointSchema, filled: z.boolean().default(false), ...style }),
  z.object({ type: z.literal('text'), at: pointSchema, text: z.string().min(1).max(2000), fontFamily:z.enum(['sans-serif','serif','monospace']).optional(), bold:z.boolean().optional(), ...style }),
  z.object({ type: z.literal('fill'), at: pointSchema, color: colorSchema, transform }),
  z.object({ type: z.literal('image'), data: z.string().startsWith('data:image/png;base64,').max(48_000_000), transform, sourceSize: z.object({width:z.number().int().min(1).max(4096),height:z.number().int().min(1).max(4096)}).optional() }),
]);
export type Operation = z.infer<typeof operationSchema>;
export type Point = z.infer<typeof pointSchema>;
export const documentSchema = z.object({
  format: z.literal('openaec-paint'), version: z.literal(1),
  name: z.string().trim().min(1).max(120),
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
  retainVectors: z.boolean().default(true),
  background: z.union([colorSchema, z.literal('transparent')]),
  operations: z.array(operationSchema).max(2000),
}).refine(d => d.width * d.height <= 8_388_608, 'Canvas may contain at most 8 megapixels');
export type PaintDocument = z.infer<typeof documentSchema>;
export function newDocument(width = 1200, height = 800, name = 'Untitled'): PaintDocument {
  return documentSchema.parse({ format: 'openaec-paint', version: 1, name, width, height, background: '#ffffff', operations: [] });
}

// Used by both the browser canvas and the native headless renderer.
export function drawOperation(ctx: CanvasRenderingContext2D, op: Operation) {
  if (op.type === 'image') return;
  if (op.type === 'fill') { floodFill(ctx, transformPoint(op.at, op.transform), op.color); return; }
  ctx.save();
  if (op.transform) ctx.transform(...op.transform);
  ctx.globalAlpha = op.opacity;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = op.color; ctx.fillStyle = op.color; ctx.lineWidth = op.size;
  if (op.type === 'brush' || op.type === 'eraser') {
    if (op.type === 'eraser') ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    if (op.points.length === 1) {
      ctx.arc(op.points[0].x, op.points[0].y, op.size / 2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.moveTo(op.points[0].x, op.points[0].y);
      for (let i=1;i<op.points.length-1;i++) {
        const p=op.points[i],next=op.points[i+1];
        ctx.quadraticCurveTo(p.x,p.y,(p.x+next.x)/2,(p.y+next.y)/2);
      }
      const end=op.points[op.points.length-1];ctx.lineTo(end.x,end.y);
      ctx.stroke();
    }
  } else if (op.type === 'text') {
    ctx.font = `${op.bold?'bold ':''}${op.size}px ${op.fontFamily||'sans-serif'}`; ctx.textBaseline = 'top';
    op.text.split('\n').forEach((line, i) => ctx.fillText(line, op.at.x, op.at.y + i * op.size * 1.3));
  } else if ('from' in op) {
    ctx.beginPath();
    let { from: a, to: b } = op;
    // Align straight edges to device pixels so they are crisp instead of straddling two pixels.
    const m = ctx.getTransform(), upright = m.b === 0 && m.c === 0 && m.a > 0 && m.d > 0;
    if (upright && (op.type === 'rectangle' || (op.type === 'line' && (a.x === b.x || a.y === b.y)))) {
      const fillOnly = op.type !== 'line' && op.filled, w = Math.max(1, Math.round(op.size * m.a));
      if (!fillOnly) ctx.lineWidth = w / m.a;
      const half = !fillOnly && w % 2 === 1 ? 0.5 : 0;
      const snap = (p: Point): Point => ({ x: (Math.round(m.a * p.x + m.e - half) + half - m.e) / m.a, y: (Math.round(m.d * p.y + m.f - half) + half - m.f) / m.d });
      a = snap(a); b = snap(b);
    }
    if (op.type === 'line') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    if (op.type === 'rectangle') ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    if (op.type === 'ellipse') ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    if (op.type !== 'line' && op.filled) ctx.fill(); else ctx.stroke();
  }
  ctx.restore();
}

export function floodFill(ctx: CanvasRenderingContext2D, at: Point, hex: string) {
  const { width, height } = ctx.canvas;
  const m = ctx.getTransform(); // canvas may be rendered at higher resolution than the document
  const x = Math.floor(at.x * m.a), y = Math.floor(at.y * m.d);
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const img = ctx.getImageData(0, 0, width, height), data = img.data;
  const start = (y * width + x) * 4;
  const target = Array.from(data.slice(start, start + 4));
  const replacement = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
  if (target.every((v, i) => v === replacement[i])) return;
  const match = (p: number) => target.every((v, i) => data[p * 4 + i] === v);
  const queue = new Int32Array(width * height); let read = 0, write = 1;
  queue[0] = y * width + x;
  const paint = (p: number) => { for (let i = 0; i < 4; i++) data[p * 4 + i] = replacement[i]; };
  paint(queue[0]);
  while (read < write) {
    const p = queue[read++], col = p % width;
    for (const n of [col > 0 ? p - 1 : -1, col < width - 1 ? p + 1 : -1, p - width, p + width]) {
      if (n >= 0 && n < width * height && match(n)) { paint(n); queue[write++] = n; }
    }
  }
  ctx.putImageData(img, 0, 0);
}
