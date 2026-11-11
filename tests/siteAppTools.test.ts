import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { newDocument, type PaintDocument } from '../shared/document.js';
import { renderPng } from '../services/renderer.js';
import type { RenderedCanvas } from '../src/documentCommands.js';
import { createSiteAppTools, installSiteAppTools, type PaintHost } from '../src/siteAppTools.js';

async function render(doc: PaintDocument) {
  const canvas = createCanvas(doc.width, doc.height); canvas.getContext('2d').drawImage(await loadImage(await renderPng(doc)), 0, 0);
  return canvas as unknown as RenderedCanvas;
}
function setup(start = newDocument(64, 48, 'Proef')) {
  const state = { doc: start, past: [] as PaintDocument[], future: [] as PaintDocument[], busy: false };
  const host: PaintHost = {
    document: () => state.doc,
    commit(next) { state.past.push(state.doc); state.future = []; state.doc = next; },
    undo() { const previous = state.past.pop(); if (!previous) return false; state.future.unshift(state.doc); state.doc = previous; return true; },
    canUndo: () => state.past.length > 0, canRedo: () => state.future.length > 0,
    settings: () => ({ tool: 'brush', color: '#36363e', size: 8, opacity: 1, filled: false }),
    busy: () => state.busy, render,
    async capture(doc, width, height) {
      const canvas = createCanvas(width, height); canvas.getContext('2d').drawImage(await loadImage(await renderPng(doc)), 0, 0, width, height);
      return canvas.toDataURL('image/png');
    },
  };
  return { state, app: createSiteAppTools(host) };
}
async function pixel(doc: PaintDocument, x: number, y: number) {
  return Array.from((await render(doc)).getContext('2d')!.getImageData(x, y, 1, 1).data);
}

test('definitions: 6–12 paint_ tools with a Dutch description and an object schema', async () => {
  const { app } = setup();
  const definitions = await app.definitions();
  assert.ok(definitions.length >= 6 && definitions.length <= 12);
  assert.deepEqual(app.tools(), definitions.map(def => def.name));
  for (const def of definitions) {
    assert.match(def.name, /^paint_[a-z_]+$/);
    assert.ok(def.description.length > 10);
    assert.equal((def.inputSchema as { type: string }).type, 'object');
    assert.equal(JSON.stringify(def.inputSchema).includes('$schema'), false);
  }
  assert.ok(app.tools().includes('paint_vastleggen') && app.tools().includes('paint_undo') && app.tools().includes('paint_stand'));
});

test('errors are short codes', async () => {
  const { app, state } = setup();
  await assert.rejects(app.run('paint_nope'), /^Error: onbekende_tool$/);
  await assert.rejects(app.run('paint_tekenen', { vormen: [] }), /ongeldige_argumenten: vormen/);
  await assert.rejects(app.run('paint_tekenen', { vormen: [{ soort: 'rechthoek', van: { x: 1, y: 1 } }] }), /ongeldige_argumenten: vormen.0.naar/);
  await assert.rejects(app.run('paint_stand', { extra: 1 }), /ongeldige_argumenten/);
  await assert.rejects(app.run('paint_undo'), /niets_ongedaan_te_maken/);
  await assert.rejects(app.run('paint_laag_verwijderen', { indices: [0] }), /laag_bestaat_niet/);
  await assert.rejects(app.run('paint_bijsnijden', { x: 100, y: 100, breedte: 10, hoogte: 10 }), /buiten_afbeelding/);
  state.busy = true;
  await assert.rejects(app.run('paint_tekenen', { vormen: [{ soort: 'lijn', van: { x: 0, y: 0 }, naar: { x: 5, y: 5 } }] }), /^Error: bezig/);
  assert.equal((await app.run('paint_stand') as { lagen: number }).lagen, 0);
});

test('stand, drawing as one undo step, and reading layers', async () => {
  const { app, state } = setup();
  const before = await app.run('paint_stand') as Record<string, unknown>;
  assert.deepEqual(before, { naam: 'Proef', breedte: 64, hoogte: 48, achtergrond: '#ffffff', vectorenBewaren: true, lagen: 0,
    gereedschap: { soort: 'penseel', kleur: '#36363e', dikte: 8, dekking: 1, gevuld: false }, kanOngedaanMaken: false, kanOpnieuw: false });
  const after = await app.run('paint_tekenen', { vormen: [
    { soort: 'rechthoek', van: { x: 4, y: 4 }, naar: { x: 30, y: 30 }, kleur: '#dc2626', gevuld: true },
    { soort: 'ellips', van: { x: 34, y: 4 }, naar: { x: 60, y: 30 }, kleur: '#2563eb', dikte: 3 },
    { soort: 'lijn', van: { x: 0, y: 40 }, naar: { x: 63, y: 40 }, kleur: '#16a34a', dikte: 2 },
    { soort: 'tekst', op: { x: 2, y: 42 }, tekst: 'AEC', kleur: '#000000', dikte: 5, vet: true },
    { soort: 'penseel', punten: [{ x: 50, y: 44 }, { x: 60, y: 46 }] },
  ] }) as { lagen: number; kanOngedaanMaken: boolean };
  assert.equal(after.lagen, 5); assert.equal(after.kanOngedaanMaken, true); assert.equal(state.past.length, 1);
  assert.deepEqual(await pixel(state.doc, 15, 15), [220, 38, 38, 255]);
  const layers = await app.run('paint_lagen', { van: 1, aantal: 3 }) as { totaal: number; lagen: Record<string, unknown>[] };
  assert.equal(layers.totaal, 5);
  assert.deepEqual(layers.lagen.map(row => [row.index, row.soort]), [[1, 'ellips'], [2, 'lijn'], [3, 'tekst']]);
  assert.deepEqual(layers.lagen[0], { index: 1, soort: 'ellips', kleur: '#2563eb', dikte: 3, dekking: 1, gevuld: false, grenzen: { x: 34, y: 4, breedte: 26, hoogte: 26 } });
  assert.equal(layers.lagen[2].tekst, 'AEC');
  await app.run('paint_undo');
  assert.equal(state.doc.operations.length, 0);
});

test('changing, moving and deleting layers', async () => {
  const { app, state } = setup();
  await app.run('paint_tekenen', { vormen: [{ soort: 'rechthoek', van: { x: 0, y: 0 }, naar: { x: 10, y: 10 }, gevuld: true, kleur: '#000000' }, { soort: 'tekst', op: { x: 20, y: 20 }, tekst: 'a' }] });
  await app.run('paint_laag_wijzigen', { index: 0, kleur: '#2563eb', verschuif: { x: 20, y: 5 } });
  assert.deepEqual(await pixel(state.doc, 25, 10), [37, 99, 235, 255]);
  assert.deepEqual(await pixel(state.doc, 2, 2), [255, 255, 255, 255]);
  await app.run('paint_laag_wijzigen', { index: 1, tekst: 'b' });
  assert.equal(state.doc.operations[1].type === 'text' && state.doc.operations[1].text, 'b');
  await assert.rejects(app.run('paint_laag_wijzigen', { index: 0, tekst: 'x' }), /niet_voor_deze_laag/);
  await app.run('paint_laag_verwijderen', { indices: [0] });
  assert.deepEqual(state.doc.operations.map(op => op.type), ['text']);
  await app.run('paint_undo');
  assert.equal(state.doc.operations.length, 2);
});

test('crop, scale, rotate, filter and a new canvas', async () => {
  const { app, state } = setup();
  await app.run('paint_tekenen', { vormen: [{ soort: 'rechthoek', van: { x: 0, y: 0 }, naar: { x: 32, y: 48 }, gevuld: true, kleur: '#dc2626' }] });
  let out = await app.run('paint_draaien', { richting: 'rechts' }) as { breedte: number; hoogte: number };
  assert.deepEqual([out.breedte, out.hoogte], [48, 64]);
  assert.deepEqual(await pixel(state.doc, 24, 10), [220, 38, 38, 255]);
  out = await app.run('paint_schalen', { breedte: 24, hoogte: 32 }) as typeof out;
  assert.deepEqual([out.breedte, out.hoogte], [24, 32]);
  out = await app.run('paint_bijsnijden', { x: 0, y: 0, breedte: 24, hoogte: 16 }) as typeof out;
  assert.deepEqual([out.breedte, out.hoogte], [24, 16]);
  await app.run('paint_filter', { soort: 'grijswaarden' });
  const [r, g, b] = await pixel(state.doc, 12, 4);
  assert.ok(r === g && g === b);
  assert.deepEqual(state.doc.operations.map(op => op.type), ['image']);
  await app.run('paint_filter', { soort: 'aanpassen', helderheid: 100 });
  assert.deepEqual(await pixel(state.doc, 12, 4), [255, 255, 255, 255]);
  await app.run('paint_nieuw', { breedte: 20, hoogte: 10, naam: 'Leeg', achtergrond: 'transparent' });
  assert.deepEqual([state.doc.name, state.doc.width, state.doc.background, state.doc.operations.length], ['Leeg', 20, 'transparent', 0]);
  await assert.rejects(app.run('paint_schalen', { breedte: 4096, hoogte: 4096 }), /te_groot/);
  for (let i = 0; i < 6; i++) await app.run('paint_undo');
  assert.deepEqual([state.doc.width, state.doc.height, state.doc.operations.length], [64, 48, 1]);
});

test('without retained vectors a drawing becomes one image layer', async () => {
  const { app, state } = setup({ ...newDocument(32, 32), retainVectors: false });
  await app.run('paint_tekenen', { vormen: [{ soort: 'lijn', van: { x: 0, y: 16 }, naar: { x: 31, y: 16 }, kleur: '#2563eb', dikte: 4 }] });
  assert.deepEqual(state.doc.operations.map(op => op.type), ['image']);
  assert.deepEqual(await pixel(state.doc, 16, 16), [37, 99, 235, 255]);
});

test('capture is a small PNG data URL', async () => {
  const { app } = setup(newDocument(1200, 800));
  const shot = await app.run('paint_vastleggen', { maximaal: 300 }) as { afbeelding: string; breedte: number; hoogte: number; origineel: object };
  assert.match(shot.afbeelding, /^data:image\/png;base64,/);
  assert.deepEqual([shot.breedte, shot.hoogte, shot.origineel], [300, 200, { breedte: 1200, hoogte: 800 }]);
  const decoded = await loadImage(Buffer.from(shot.afbeelding.split(',')[1], 'base64'));
  assert.deepEqual([decoded.width, decoded.height], [300, 200]);
  assert.equal(JSON.parse(JSON.stringify(shot)).breedte, 300);
});

test('calls run one after the other', async () => {
  const { app, state } = setup();
  await Promise.all([1, 2, 3].map(i => app.run('paint_tekenen', { vormen: [{ soort: 'lijn', van: { x: i, y: 0 }, naar: { x: i, y: 5 } }] })));
  assert.equal(state.doc.operations.length, 3); assert.equal(state.past.length, 3);
});

test('installs on a browser window, not under Tauri', () => {
  const { app } = setup(); void app;
  const host = {} as PaintHost;
  const browser = {} as Window & { __OPDS_APP__?: unknown };
  const remove = installSiteAppTools(host, browser as never);
  assert.equal(typeof (browser.__OPDS_APP__ as { run: unknown }).run, 'function');
  remove(); assert.equal(browser.__OPDS_APP__, undefined);
  const tauri = { __TAURI_INTERNALS__: {} } as unknown as Window & { __OPDS_APP__?: unknown };
  installSiteAppTools(host, tauri as never);
  assert.equal(tauri.__OPDS_APP__, undefined);
});
