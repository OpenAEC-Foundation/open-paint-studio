/**
 * The `paint_*` tools for the assistant of OpenAEC SuperCloud (browser build only, `window.__OPDS_APP__`).
 *
 * The site sends a tool call through its bridge to `run(name, args)` in the frame of the app. The tools work on the
 * document of the editor through `PaintHost` (App.tsx): every change is one undo step, like an edit by hand. The image
 * commands are the ones of the ribbon (documentCommands.ts). No network, no popups, no messages to other windows.
 * A refusal is an Error with a short code; a value is plain JSON.
 */
import { z } from 'zod';
import { colorSchema, documentSchema, newDocument, operationSchema, type Operation, type PaintDocument } from '../shared/document';
import { operationBounds, transformedOperation } from '../shared/geometry';
import { filterDocument, flatten, transformDocument, type Render, type TransformAction } from './documentCommands';

export interface PaintHost {
  document(): PaintDocument;
  /** Replace the document as one undo step. */
  commit(next: PaintDocument): void;
  /** Undo the last step; false when there is none. */
  undo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  settings(): { tool: string; color: string; size: number; opacity: number; filled: boolean };
  busy(): boolean;
  render: Render;
  /** The rendered document scaled to width × height, as a PNG data URL. */
  capture(doc: PaintDocument, width: number, height: number): Promise<string>;
}
export interface SiteAppToolDefinition { name: string; description: string; inputSchema: object }
export interface SiteAppTools {
  tools(): string[];
  definitions(): Promise<SiteAppToolDefinition[]>;
  run(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

const point = z.object({ x: z.number(), y: z.number() });
const index = z.number().int().min(0);
const shape = z.object({
  soort: z.enum(['rechthoek', 'ellips', 'lijn', 'tekst', 'penseel']),
  van: point.optional().describe('rechthoek, ellips, lijn: beginpunt'),
  naar: point.optional().describe('rechthoek, ellips, lijn: eindpunt'),
  op: point.optional().describe('tekst: linkerbovenhoek'),
  tekst: z.string().min(1).max(2000).optional(),
  punten: z.array(point).min(1).max(5000).optional().describe('penseel: de lijn door deze punten'),
  kleur: colorSchema.optional().describe('#RRGGBB; standaard de kleur van de app'),
  dikte: z.number().min(1).max(200).optional().describe('lijndikte of lettergrootte in px'),
  dekking: z.number().min(0).max(1).optional(),
  gevuld: z.boolean().optional(),
  lettertype: z.enum(['sans-serif', 'serif', 'monospace']).optional(),
  vet: z.boolean().optional(),
}).strict();

const schemas = {
  paint_stand: z.object({}).strict(),
  paint_lagen: z.object({ van: index.optional(), aantal: z.number().int().min(1).max(200).optional() }).strict(),
  paint_tekenen: z.object({ vormen: z.array(shape).min(1).max(50) }).strict(),
  paint_laag_wijzigen: z.object({
    index, kleur: colorSchema.optional(), dikte: z.number().min(1).max(200).optional(), dekking: z.number().min(0).max(1).optional(),
    gevuld: z.boolean().optional(), tekst: z.string().min(1).max(2000).optional(), verschuif: point.optional().describe('verplaatsing in px'),
  }).strict(),
  paint_laag_verwijderen: z.object({ indices: z.array(index).min(1).max(2000) }).strict(),
  paint_bijsnijden: z.object({ x: z.number(), y: z.number(), breedte: z.number().min(1), hoogte: z.number().min(1) }).strict(),
  paint_schalen: z.object({ breedte: z.number().int().min(1).max(4096), hoogte: z.number().int().min(1).max(4096) }).strict(),
  paint_draaien: z.object({ richting: z.enum(['rechts', 'links', 'horizontaal_spiegelen', 'verticaal_spiegelen']) }).strict(),
  paint_filter: z.object({
    soort: z.enum(['grijswaarden', 'negatief', 'sepia', 'aanpassen']),
    helderheid: z.number().min(-100).max(100).optional(), contrast: z.number().min(-100).max(100).optional(), verzadiging: z.number().min(0).max(200).optional(),
  }).strict(),
  paint_nieuw: z.object({
    breedte: z.number().int().min(1).max(4096), hoogte: z.number().int().min(1).max(4096), naam: z.string().trim().min(1).max(120).optional(),
    achtergrond: z.union([colorSchema, z.literal('transparent')]).optional(),
  }).strict(),
  paint_undo: z.object({}).strict(),
  paint_vastleggen: z.object({ maximaal: z.number().int().min(64).max(1024).optional().describe('langste zijde in px, standaard 512') }).strict(),
};
type ToolName = keyof typeof schemas;

const descriptions: Record<ToolName, string> = {
  paint_stand: 'Stand van de tekening: naam, afmetingen, achtergrond, aantal lagen, het actieve gereedschap met kleur en dikte, en of ongedaan maken kan.',
  paint_lagen: 'De lagen van onder naar boven (elke vorm, tekst of afbeelding is een laag) met index, soort, kleur, dikte en begrenzing in px.',
  paint_tekenen: 'Teken rechthoeken, ellipsen, lijnen, tekst of penseellijnen in px (oorsprong linksboven). Elke vorm wordt een nieuwe laag; alles samen is één stap om ongedaan te maken.',
  paint_laag_wijzigen: 'Wijzig een laag: kleur, dikte, dekking, gevuld, tekst, of verschuif hem. Eén stap om ongedaan te maken.',
  paint_laag_verwijderen: 'Verwijder lagen op index (zie paint_lagen). Eén stap om ongedaan te maken.',
  paint_bijsnijden: 'Snijd de afbeelding bij tot het gebied x, y, breedte, hoogte in px.',
  paint_schalen: 'Schaal de hele afbeelding naar breedte × hoogte px (maximaal 4096, samen maximaal 8 megapixel).',
  paint_draaien: 'Draai de afbeelding een kwartslag naar rechts of links, of spiegel hem horizontaal of verticaal.',
  paint_filter: 'Pas een filter toe op de hele afbeelding: grijswaarden, negatief, sepia, of aanpassen (helderheid en contrast -100..100, verzadiging 0..200, neutraal 100). Voegt de lagen samen tot één afbeelding.',
  paint_nieuw: 'Begin een nieuwe lege tekening (vervangt de huidige; ongedaan maken brengt hem terug). Achtergrond #RRGGBB of transparent, standaard wit.',
  paint_undo: 'Maak de laatste stap ongedaan, ook een stap van de gebruiker.',
  paint_vastleggen: 'Een kleine PNG van de tekening als data-URL, om te zien wat er staat.',
};

const definitions: SiteAppToolDefinition[] = (Object.keys(schemas) as ToolName[]).map(name => {
  const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(schemas[name], { io: 'input' }) as Record<string, unknown>;
  return { name, description: descriptions[name], inputSchema };
});

const shapeTypes = { rechthoek: 'rectangle', ellips: 'ellipse', lijn: 'line' } as const;
const typeNames: Record<Operation['type'], string> = { brush: 'penseel', eraser: 'gum', fill: 'vulling', line: 'lijn', rectangle: 'rechthoek', ellipse: 'ellips', text: 'tekst', image: 'afbeelding' };
const tools: Record<string, string> = { ...typeNames, picker: 'pipet', crop: 'bijsnijden', select: 'selecteren' };
const directions: Record<z.infer<typeof schemas.paint_draaien>['richting'], TransformAction> = { rechts: 'rotate', links: 'rotateLeft', horizontaal_spiegelen: 'flip', verticaal_spiegelen: 'flipVertical' };
const filters = { grijswaarden: 'grayscale', negatief: 'invert', sepia: 'sepia', aanpassen: 'adjust' } as const;
const round = (value: number) => Math.round(value * 10) / 10;
/** A data URL bigger than this costs the model too much; the capture gets smaller until it fits. */
const MAX_CAPTURE_CHARS = 1_000_000;

function argumentError(error: z.ZodError): Error {
  const issue = error.issues[0];
  return new Error(`ongeldige_argumenten: ${issue.path.join('.') || 'argumenten'} ${issue.message}`);
}

function bounds(doc: PaintDocument, op: Operation) {
  const box = operationBounds(op.type === 'image' ? { ...op, sourceSize: op.sourceSize || { width: doc.width, height: doc.height } } : op);
  return box && { x: round(box.x), y: round(box.y), breedte: round(box.width), hoogte: round(box.height) };
}

function layer(doc: PaintDocument, op: Operation, i: number) {
  const row: Record<string, unknown> = { index: i, soort: typeNames[op.type] };
  if ('color' in op) row.kleur = op.color;
  if ('size' in op) { row.dikte = op.size; row.dekking = op.opacity; }
  if ('filled' in op && op.type !== 'line') row.gevuld = op.filled;
  if (op.type === 'text') row.tekst = op.text.length > 200 ? `${op.text.slice(0, 200)}…` : op.text;
  if (op.type === 'brush' || op.type === 'eraser') row.punten = op.points.length;
  const box = bounds(doc, op);
  if (box) row.grenzen = box;
  return row;
}

function toOperation(input: z.infer<typeof shape>, settings: ReturnType<PaintHost['settings']>, i: number): Operation {
  const style = { color: input.kleur ?? settings.color, size: input.dikte ?? settings.size, opacity: input.dekking ?? settings.opacity };
  const missing = (field: string) => new Error(`ongeldige_argumenten: vormen.${i}.${field} ontbreekt voor ${input.soort}`);
  let op: unknown;
  if (input.soort === 'tekst') {
    if (!input.op) throw missing('op');
    if (!input.tekst) throw missing('tekst');
    op = { type: 'text', at: input.op, text: input.tekst, ...style, size: input.dikte ?? Math.max(settings.size, 32), fontFamily: input.lettertype ?? 'sans-serif', bold: input.vet ?? false };
  } else if (input.soort === 'penseel') {
    if (!input.punten) throw missing('punten');
    op = { type: 'brush', points: input.punten, ...style };
  } else {
    if (!input.van) throw missing('van');
    if (!input.naar) throw missing('naar');
    op = { type: shapeTypes[input.soort], from: input.van, to: input.naar, filled: input.gevuld ?? (input.soort === 'lijn' ? false : settings.filled), ...style };
  }
  const parsed = operationSchema.safeParse(op);
  if (!parsed.success) throw new Error(`ongeldige_argumenten: vormen.${i}.${parsed.error.issues[0].path.join('.')} ${parsed.error.issues[0].message}`);
  return parsed.data;
}

function checkIndex(doc: PaintDocument, i: number) {
  if (i >= doc.operations.length) throw new Error(`laag_bestaat_niet: index ${i}, er zijn ${doc.operations.length} lagen`);
}

export function createSiteAppTools(host: PaintHost): SiteAppTools {
  const summary = () => {
    const doc = host.document(), settings = host.settings();
    return {
      naam: doc.name, breedte: doc.width, hoogte: doc.height, achtergrond: doc.background, vectorenBewaren: doc.retainVectors, lagen: doc.operations.length,
      gereedschap: { soort: tools[settings.tool] ?? settings.tool, kleur: settings.color, dikte: settings.size, dekking: settings.opacity, gevuld: settings.filled },
      kanOngedaanMaken: host.canUndo(), kanOpnieuw: host.canRedo(),
    };
  };
  const save = (next: PaintDocument) => {
    const parsed = documentSchema.safeParse(next);
    if (!parsed.success) throw new Error(`ongeldig_resultaat: ${parsed.error.issues[0].message}`);
    host.commit(parsed.data);
    return summary();
  };
  const handlers: { [K in ToolName]: (args: z.infer<(typeof schemas)[K]>) => Promise<unknown> | unknown } = {
    paint_stand: summary,
    paint_lagen: ({ van = 0, aantal = 50 }) => {
      const doc = host.document();
      return { totaal: doc.operations.length, van, lagen: doc.operations.slice(van, van + aantal).map((op, i) => layer(doc, op, van + i)) };
    },
    paint_tekenen: async ({ vormen }) => {
      const doc = host.document(), settings = host.settings();
      const added = vormen.map((input, i) => toOperation(input, settings, i));
      if (doc.operations.length + added.length > 2000) throw new Error('te_veel_lagen: maximaal 2000');
      return save(await flatten({ ...doc, operations: [...doc.operations, ...added] }, host.render));
    },
    paint_laag_wijzigen: ({ index: i, kleur, dikte, dekking, gevuld, tekst, verschuif }) => {
      const doc = host.document();
      checkIndex(doc, i);
      let op = doc.operations[i];
      const refuse = (field: string) => { throw new Error(`niet_voor_deze_laag: ${field} kan niet bij een ${typeNames[op.type]}`); };
      if (kleur !== undefined) op = 'color' in op ? { ...op, color: kleur } as Operation : refuse('kleur');
      if (dikte !== undefined) op = 'size' in op ? { ...op, size: dikte } as Operation : refuse('dikte');
      if (dekking !== undefined) op = 'opacity' in op ? { ...op, opacity: dekking } as Operation : refuse('dekking');
      if (gevuld !== undefined) op = op.type === 'rectangle' || op.type === 'ellipse' ? { ...op, filled: gevuld } : refuse('gevuld');
      if (tekst !== undefined) op = op.type === 'text' ? { ...op, text: tekst } : refuse('tekst');
      if (verschuif) op = transformedOperation(op, [1, 0, 0, 1, verschuif.x, verschuif.y], doc);
      return save({ ...doc, operations: doc.operations.map((item, j) => j === i ? op : item) });
    },
    paint_laag_verwijderen: ({ indices }) => {
      const doc = host.document(), remove = new Set(indices);
      for (const i of remove) checkIndex(doc, i);
      return save({ ...doc, operations: doc.operations.filter((_, i) => !remove.has(i)) });
    },
    paint_bijsnijden: async ({ x, y, breedte, hoogte }) => {
      const doc = host.document();
      if (Math.min(doc.width, x + breedte) - Math.max(0, x) < 1 || Math.min(doc.height, y + hoogte) - Math.max(0, y) < 1) throw new Error('buiten_afbeelding: het gebied valt niet op de afbeelding');
      return save(await transformDocument(doc, 'crop', host.render, { from: { x, y }, to: { x: x + breedte, y: y + hoogte } }));
    },
    paint_schalen: async ({ breedte, hoogte }) => {
      if (breedte * hoogte > 8_388_608) throw new Error('te_groot: maximaal 8 megapixel');
      return save(await transformDocument(host.document(), 'resize', host.render, { width: breedte, height: hoogte }));
    },
    paint_draaien: async ({ richting }) => save(await transformDocument(host.document(), directions[richting], host.render)),
    paint_filter: async ({ soort, helderheid = 0, contrast = 0, verzadiging = 100 }) =>
      save(await filterDocument(host.document(), filters[soort], host.render, { brightness: helderheid, contrast, saturation: verzadiging })),
    paint_nieuw: ({ breedte, hoogte, naam, achtergrond }) => {
      if (breedte * hoogte > 8_388_608) throw new Error('te_groot: maximaal 8 megapixel');
      const doc = host.document();
      return save({ ...newDocument(breedte, hoogte, naam ?? 'Untitled'), background: achtergrond ?? '#ffffff', retainVectors: doc.retainVectors });
    },
    paint_undo: () => {
      if (!host.undo()) throw new Error('niets_ongedaan_te_maken');
      return summary();
    },
    paint_vastleggen: async ({ maximaal = 512 }) => {
      const doc = host.document();
      let scale = Math.min(1, maximaal / Math.max(doc.width, doc.height)), image = '';
      for (let attempt = 0; attempt < 4; attempt++, scale /= 2) {
        const width = Math.max(1, Math.round(doc.width * scale)), height = Math.max(1, Math.round(doc.height * scale));
        image = await host.capture(doc, width, height);
        if (image.length <= MAX_CAPTURE_CHARS) return { afbeelding: image, breedte: width, hoogte: height, origineel: { breedte: doc.width, hoogte: doc.height } };
      }
      throw new Error('te_groot: de vastlegging past niet');
    },
  };
  // One call at a time: a call reads the document the previous one left behind.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    tools: () => definitions.map(def => def.name),
    definitions: async () => definitions,
    run(name, args = {}) {
      const call = queue.then(async () => {
        if (!Object.prototype.hasOwnProperty.call(schemas, name)) throw new Error('onbekende_tool');
        const parsed = schemas[name as ToolName].safeParse(args ?? {});
        if (!parsed.success) throw argumentError(parsed.error);
        if (host.busy() && name !== 'paint_stand') throw new Error('bezig: de app verwerkt nog een bewerking, probeer het zo opnieuw');
        return (handlers[name as ToolName] as (value: unknown) => unknown)(parsed.data);
      });
      queue = call.catch(() => undefined);
      return call;
    },
  };
}

/** Put `window.__OPDS_APP__` in place; only in the browser build, not under Tauri. Returns the cleanup. */
export function installSiteAppTools(host: PaintHost, target: Window & { __OPDS_APP__?: SiteAppTools } = window): () => void {
  if ('__TAURI_INTERNALS__' in target) return () => {};
  const app = createSiteAppTools(host);
  target.__OPDS_APP__ = app;
  return () => { if (target.__OPDS_APP__ === app) delete target.__OPDS_APP__; };
}
