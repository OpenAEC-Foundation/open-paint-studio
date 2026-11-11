import { newDocument, type PaintDocument, type Point } from '../shared/document';
import { transformedOperation, type Matrix } from '../shared/geometry';
import { adjustPixels, type Adjustments } from '../shared/adjustments';

// The image commands of the ribbon, shared by the editor and the assistant tools (siteAppTools.ts).
// `render` is renderDocument in the browser; tests pass a renderer on @napi-rs/canvas.
export type RenderedCanvas = {
  toDataURL(type: 'image/png'): string;
  getContext(id: '2d'): { getImageData(x: number, y: number, w: number, h: number): ImageData; putImageData(data: ImageData, x: number, y: number): void } | null;
};
export type Render = (doc: PaintDocument) => Promise<RenderedCanvas>;
export type TransformAction = 'rotate' | 'rotateLeft' | 'flip' | 'flipVertical' | 'resize' | 'crop';
export type FilterKind = 'adjust' | 'grayscale' | 'invert' | 'sepia';
const neutral: Adjustments = { brightness: 0, contrast: 0, saturation: 100 };

/** Without retained vectors every edit becomes one image operation. */
export async function flatten(doc: PaintDocument, render: Render): Promise<PaintDocument> {
  if (doc.retainVectors || !doc.operations.length) return doc;
  const image = await render({ ...doc, background: 'transparent' });
  return { ...doc, operations: [{ type: 'image', data: image.toDataURL('image/png'), sourceSize: { width: doc.width, height: doc.height } }] };
}

export async function transformDocument(doc: PaintDocument, action: TransformAction, render: Render, options: { width?: number; height?: number; from?: Point; to?: Point } = {}): Promise<PaintDocument> {
  const quarter = action === 'rotate' || action === 'rotateLeft';
  let w = quarter ? doc.height : action === 'resize' ? options.width ?? doc.width : doc.width, h = quarter ? doc.width : action === 'resize' ? options.height ?? doc.height : doc.height, x = 0, y = 0;
  const { from, to } = options;
  if (action === 'crop') {
    if (!from || !to) throw new Error('Select a crop region first');
    x = Math.max(0, Math.min(doc.width, Math.min(from.x, to.x))); y = Math.max(0, Math.min(doc.height, Math.min(from.y, to.y)));
    w = Math.min(doc.width, Math.max(from.x, to.x)) - x; h = Math.min(doc.height, Math.max(from.y, to.y)) - y;
    if (w < 1 || h < 1) throw new Error('Select a crop region first');
  }
  newDocument(w, h, doc.name);
  const matrices: Record<TransformAction, Matrix> = { rotate: [0, 1, -1, 0, w, 0], rotateLeft: [0, -1, 1, 0, 0, h], flip: [-1, 0, 0, 1, w, 0], flipVertical: [1, 0, 0, -1, 0, h], resize: [w / doc.width, 0, 0, h / doc.height, 0, 0], crop: [1, 0, 0, 1, -x, -y] };
  let sourceOperations = doc.operations;
  const lastFill = doc.operations.findLastIndex(op => op.type === 'fill');
  if (action === 'crop' && lastFill >= 0) { const prefix = await render({ ...doc, background: 'transparent', operations: doc.operations.slice(0, lastFill + 1) }); sourceOperations = [{ type: 'image', data: prefix.toDataURL('image/png'), sourceSize: { width: doc.width, height: doc.height } }, ...doc.operations.slice(lastFill + 1)]; }
  const operations = sourceOperations.map(op => transformedOperation(op, matrices[action], { width: doc.width, height: doc.height }));
  return flatten({ ...doc, width: w, height: h, operations }, render);
}

export async function filterDocument(doc: PaintDocument, kind: FilterKind, render: Render, corrections: Adjustments = neutral): Promise<PaintDocument> {
  const image = await render(doc), ctx = image.getContext('2d')!, pixels = ctx.getImageData(0, 0, doc.width, doc.height);
  adjustPixels(pixels.data, kind === 'adjust' ? corrections : neutral, kind); ctx.putImageData(pixels, 0, 0);
  return { ...doc, operations: [{ type: 'image', data: image.toDataURL('image/png'), sourceSize: { width: doc.width, height: doc.height } }] };
}
