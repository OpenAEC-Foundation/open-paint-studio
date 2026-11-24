import { drawOperation, type PaintDocument } from '../shared/document';
// `scale` > 1 renders at higher resolution for sharp on-screen display; exports use 1.
export async function renderDocument(doc: PaintDocument, target?: HTMLCanvasElement, scale = 1) {
  const pw = Math.max(1, Math.round(doc.width * scale)), ph = Math.max(1, Math.round(doc.height * scale));
  const ink = document.createElement('canvas'); ink.width = pw; ink.height = ph;
  const ctx = ink.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(pw / doc.width, ph / doc.height);
  for (const op of doc.operations) {
    if (op.type === 'image') {
      const img = new Image(); img.src = op.data; await img.decode();
      ctx.save(); if (op.transform) ctx.transform(...op.transform);
      ctx.drawImage(img, 0, 0, op.sourceSize?.width ?? doc.width, op.sourceSize?.height ?? doc.height); ctx.restore();
    } else drawOperation(ctx, op);
  }
  const output = target ?? document.createElement('canvas'); output.width = pw; output.height = ph;
  const out = output.getContext('2d')!;
  if (doc.background !== 'transparent') { out.fillStyle = doc.background; out.fillRect(0, 0, pw, ph); }
  out.drawImage(ink, 0, 0);
  return output;
}
