import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { newDocument, documentSchema, type Operation } from '../shared/document.js';
import { renderPng } from '../services/renderer.js';
import { createApi } from '../services/api.js';

async function pixels(operations: Operation[], background = '#ffffff') {
  const png = await renderPng({ ...newDocument(64, 64), background, operations });
  const canvas = createCanvas(64, 64), ctx = canvas.getContext('2d'); ctx.drawImage(await loadImage(png), 0, 0);
  return (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
}
test('fill stays inside a closed shape and eraser reveals the background', async () => {
  const shape: Operation = { type: 'rectangle', from: { x: 8, y: 8 }, to: { x: 56, y: 56 }, color: '#36363e', size: 4, opacity: 1, filled: false };
  const at = await pixels([shape, { type: 'fill', at: { x: 20, y: 20 }, color: '#d97706' }, { type: 'eraser', points: [{ x: 32, y: 32 }], color: '#000000', size: 10, opacity: 1 }]);
  assert.deepEqual(at(20, 20), [217, 119, 6, 255]); assert.deepEqual(at(1, 1), [255, 255, 255, 255]); assert.deepEqual(at(32, 32), [255, 255, 255, 255]);
});
test('transparent export and single brush dots preserve alpha', async () => {
  const at = await pixels([{ type: 'brush', points: [{ x: 20, y: 20 }], color: '#dc2626', size: 8, opacity: 1 }], 'transparent');
  assert.deepEqual(at(20, 20), [220, 38, 38, 255]); assert.equal(at(1, 1)[3], 0);
});
test('document limits reject oversized or malformed input', () => {
  assert.throws(() => newDocument(4096, 4096)); assert.throws(() => newDocument(-1, 100));
  assert.equal(documentSchema.safeParse({ ...newDocument(), operations: [{ type: 'fill', at: { x: NaN, y: 0 }, color: 'red' }] }).success, false);
});
test('API enforces auth, origins, validation, persistence and revision conflicts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'paint-api-')), token = 'test-token-with-at-least-32-characters';
  const server = createApi({ directory, token });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const call = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await fetch(base + '/health')).status, 401);
    assert.equal((await fetch(base + '/health', { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}` } })).status, 403);
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(base + '/health', { headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await call('/v1/documents', 'POST', { ...newDocument(), width: 99999 })).status, 400);
    const created = await (await call('/v1/documents', 'POST', newDocument(64, 64, 'API test'))).json();
    const shape = { type: 'rectangle', from: { x: 5, y: 5 }, to: { x: 55, y: 55 }, color: '#d97706', size: 2, filled: true };
    const concurrent = await Promise.all([call(`/v1/documents/${created.id}/operations`, 'POST', { operations: [shape], expectedRevision: 1 }), call(`/v1/documents/${created.id}/operations`, 'POST', { operations: [shape], expectedRevision: 1 })]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    const fetched = await (await call(`/v1/documents/${created.id}`)).json(); assert.equal(fetched.revision, 2); assert.equal(fetched.document.operations.length, 1);
    const png = await call(`/v1/documents/${created.id}/export.png`); assert.equal(png.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const undone = await (await call(`/v1/documents/${created.id}/undo`, 'POST', { expectedRevision: 2 })).json(); assert.equal(undone.document.operations.length, 0);
    const list = await (await call('/v1/documents')).json(); assert.equal(list[0].name, 'API test');
    const { DocumentStore } = await import('../services/store.js'); assert.equal(new DocumentStore(join(directory, 'documents')).get(created.id).revision, 3);
  } finally { await new Promise<void>(r => server.close(() => r())); rmSync(directory, { recursive: true, force: true }); }
});
test('rectangle and straight line edges are pixel-aligned with no partial alpha for odd line widths', async () => {
  const rect: Operation = { type: 'rectangle', from: { x: 8, y: 8 }, to: { x: 50, y: 50 }, color: '#000000', size: 5, opacity: 1, filled: false };
  const line: Operation = { type: 'line', from: { x: 10, y: 60 }, to: { x: 50, y: 60 }, color: '#000000', size: 3, opacity: 1, filled: false };
  const at = await pixels([rect, line]);
  const solid = (x: number, y: number) => { const p = at(x, y); return p[0] === 0 && p[3] === 255; };
  const blank = (x: number, y: number) => at(x, y).slice(0, 3).every(v => v === 255);
  assert.ok(blank(5, 30) && solid(6, 30) && solid(10, 30) && blank(11, 30), 'vertical rectangle edge covers whole pixels');
  assert.ok(blank(30, 5) && solid(30, 6) && solid(30, 10) && blank(30, 11), 'horizontal rectangle edge covers whole pixels');
  assert.ok(blank(30, 58) && solid(30, 59) && solid(30, 61) && blank(30, 62), 'straight line covers whole pixels');
});
