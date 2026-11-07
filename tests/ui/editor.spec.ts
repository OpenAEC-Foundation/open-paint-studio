import { test, expect } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { ImageMagick,MagickColors,MagickFormat } from '@imagemagick/magick-wasm';
import { initializeDecoder } from '../../shared/image-decoder';
import { readFileSync } from 'node:fs';
import { newDocument } from '../../shared/document';
test('draw, undo/redo, export, transform and restore a local draft', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Concept opgeslagen op dit apparaat', { exact: true })).toBeVisible();
  const surface = page.getByLabel('Drawing surface', { exact: true }); const box = await surface.boundingBox(); expect(box).not.toBeNull();
  await page.getByRole('button', { name: 'Rechthoek', exact: true }).click();
  await page.mouse.move(box!.x + 35, box!.y + 35); await page.mouse.down(); await page.mouse.move(box!.x + 200, box!.y + 150, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.history-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.locator('.history-item')).toHaveCount(1);
  await page.locator('.home-ribbon summary').filter({hasText:'Exporteren'}).click(); const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'PNG', exact: true }).click();
  const download = await downloadEvent; expect(download.suggestedFilename()).toBe('Untitled.png'); expect(await download.failure()).toBeNull();
  await page.getByRole('button', { name: 'Afbeelding', exact: true }).click(); await page.getByRole('button', { name: '90° draaien', exact: true }).click();
  await expect(page.locator('.dimension-pair')).toContainText('800');
  await expect(page.locator('.dimension-pair > div').first()).toContainText('800');
  await expect(page.getByText('Concept opgeslagen op dit apparaat', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.locator('.dimension-pair > div').first()).toContainText('800'); await expect(page.locator('.history-item')).toHaveCount(1);
});
test('settings switch language and theme', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Thema', { exact: true }).selectOption('forge'); await dialog.getByLabel('Taal', { exact: true }).selectOption('en');
  await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeVisible(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'forge');
});
test('open an image, resize it and crop a region', async ({ page }) => {
  const sample = createCanvas(100, 80), ctx = sample.getContext('2d');
  ctx.fillStyle = '#2563eb'; ctx.fillRect(0, 0, 100, 80);
  await page.goto('/'); await expect(page.getByText('Concept opgeslagen op dit apparaat', { exact: true })).toBeVisible();
  await page.locator('input[type=file][accept^="image/"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: sample.toBuffer('image/png') });
  await expect(page.locator('.dimension-pair > div').first()).toContainText('100',{timeout:25000});
  await page.getByRole('button', { name: 'Afbeelding', exact: true }).click(); await page.getByRole('button', { name: 'Formaat wijzigen', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Breedte', { exact: true }).fill('120'); await dialog.getByLabel('Hoogte', { exact: true }).fill('100'); await dialog.getByRole('button', { name: 'Toepassen', exact: true }).click();
  await expect(page.locator('.dimension-pair > div').first()).toContainText('120');
  await page.getByRole('button', { name: 'Bijsnijden', exact: true }).click();
  const surface = page.getByLabel('Drawing surface', { exact: true }); const box = await surface.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * .2, box!.y + box!.height * .2); await page.mouse.down(); await page.mouse.move(box!.x + box!.width * .8, box!.y + box!.height * .8, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.dimension-pair > div').first()).toContainText('72'); await expect(page.locator('.dimension-pair > div').last()).toContainText('60');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.dimension-pair > div').first()).toContainText('120');
});
test('Start exposes image controls, inline text and retained SVG objects',async({page})=>{
  await page.goto('/');await expect(page.getByText('Concept opgeslagen op dit apparaat',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Formaat wijzigen',exact:true})).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'Vectorobjecten behouden',exact:true})).toBeChecked();
  const surface=page.getByLabel('Drawing surface',{exact:true}),box=await surface.boundingBox();expect(box).not.toBeNull();
  await page.getByRole('button',{name:'Tekst',exact:true}).click();await surface.click({position:{x:60,y:60}});
  await page.getByLabel('Tekstinhoud',{exact:true}).fill('Editable vector');await page.getByRole('button',{name:'Tekst toepassen',exact:true}).click();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.getByRole('button',{name:'Objecten selecteren',exact:true}).click();
  await surface.click({position:{x:65,y:65}});await expect(page.locator('.selection-outline')).toBeVisible();
  await page.mouse.move(box!.x+65,box!.y+65);await page.mouse.down();await page.mouse.move(box!.x+120,box!.y+110,{steps:5});await page.mouse.up();
  await page.locator('.home-ribbon summary').filter({hasText:'Exporteren'}).click();const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'SVG',exact:true}).click();
  const downloaded=await downloadEvent;const path=await downloaded.path();expect(path).not.toBeNull();const svg=readFileSync(path!,'utf8');expect(svg).toContain('<text');expect(svg).toContain('Editable vector');expect(svg).not.toContain('<image');
  await page.getByRole('button',{name:'Focusmodus',exact:true}).first().click();await expect(page.locator('.paint-ribbon')).not.toBeVisible();await page.getByRole('button',{name:'Focusmodus',exact:true}).first().click();await expect(page.locator('.paint-ribbon')).toBeVisible();
});
test('browser worker decodes a TIFF without a backend',async({page})=>{
  await initializeDecoder(readFileSync(new URL(import.meta.resolve('@imagemagick/magick-wasm/magick.wasm'))));
  const bytes=ImageMagick.read(MagickColors.Blue,80,64,image=>image.write(MagickFormat.Tiff,data=>Buffer.from(data)));
  await page.goto('/');await expect(page.getByText('Concept opgeslagen op dit apparaat',{exact:true})).toBeVisible();
  await page.locator('input[type=file][accept^="image/"]').setInputFiles({name:'scan.tiff',mimeType:'image/tiff',buffer:bytes});
  await expect(page.locator('.dimension-pair > div').first()).toContainText('80',{timeout:25000});await expect(page.locator('.dimension-pair > div').last()).toContainText('64');
  await expect(page.locator('.history-item')).toHaveCount(1);
});
test('SVG import uses the browser renderer',async({page})=>{
  await page.goto('/');await expect(page.getByText('Concept opgeslagen op dit apparaat',{exact:true})).toBeVisible();
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="#d97706"/></svg>';
  await page.locator('input[type=file][accept^="image/"]').setInputFiles({name:'drawing.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
  await expect(page.locator('.dimension-pair > div').first()).toContainText('96');await expect(page.locator('.dimension-pair > div').last()).toContainText('64');
});
test('cropping retains a fill when its original seed lies outside the crop',async({page})=>{
  await page.goto('/');await expect(page.getByText('Concept opgeslagen op dit apparaat',{exact:true})).toBeVisible();
  const doc={...newDocument(64,64),operations:[{type:'fill',at:{x:5,y:5},color:'#d97706'}]};
  await page.evaluate(async value=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('openaec-paint',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(value,'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
  },doc);
  await page.reload();
  await expect(page.locator('.dimension-pair > div').first()).toContainText('64');
  await page.getByRole('button',{name:'Bijsnijden',exact:true}).click();
  const surface=page.getByLabel('Drawing surface',{exact:true}),box=await surface.boundingBox();expect(box).not.toBeNull();
  await page.mouse.move(box!.x+box!.width*.25,box!.y+box!.height*.25);await page.mouse.down();await page.mouse.move(box!.x+box!.width*.75,box!.y+box!.height*.75,{steps:4});await page.mouse.up();
  await expect(page.locator('.dimension-pair > div').first()).toContainText('32');
  await expect.poll(()=>page.locator('canvas.drawing').first().evaluate(canvas=>Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(1,1,1,1).data))).toEqual([217,119,6,255]);
});
test('desktop file launch imports binary image data once and updates the window title', async ({page}) => {
  const image=createCanvas(73,41);image.getContext('2d').fillRect(0,0,73,41);
  await page.addInitScript((bytes:number[])=>{
    let pending=true;
    const bridge={reads:0,title:''};
    Object.assign(window,{
      paintLaunchCheck:bridge,
      __TAURI_EVENT_PLUGIN_INTERNALS__:{unregisterListener:()=>{}},
      __TAURI_INTERNALS__:{
        metadata:{currentWindow:{label:'main'}},transformCallback:()=>1,
        invoke:async(command:string,args?:{value?:string})=>{
          if(command==='launch_file_name')return pending?'Launch image.png':null;
          if(command==='read_launch_file'){pending=false;bridge.reads++;return Uint8Array.from(bytes).buffer;}
          if(command==='plugin:window|set_title')bridge.title=args?.value||'';
          return 1;
        },
      },
    });
  },Array.from(image.toBuffer('image/png')));
  await page.goto('/');
  await expect(page.locator('.document-tab')).toContainText('Launch image.ifcx');
  await expect(page.locator('.dimension-pair > div').first()).toContainText('73');
  await expect(page.locator('.dimension-pair > div').last()).toContainText('41');
  await expect.poll(()=>page.evaluate(()=>Reflect.get(window,'paintLaunchCheck'))).toEqual({reads:1,title:'Launch image — OpenAEC Paint Studio'});
});

test('Escape cancels drawing and inline text and returns to selection', async ({page}) => {
  await page.goto('/');
  await expect(page.getByText('Concept opgeslagen op dit apparaat',{exact:true})).toBeVisible();
  const surface=page.getByLabel('Drawing surface',{exact:true});
  const box=(await surface.boundingBox())!;
  await page.mouse.move(box.x+25,box.y+25);await page.mouse.down();await page.mouse.move(box.x+90,box.y+70);
  await page.keyboard.press('Escape');await page.mouse.up();
  const selection=page.getByRole('button',{name:'Objecten selecteren',exact:true});
  await expect(selection).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.history-item')).toHaveCount(0);
  await page.getByRole('button',{name:'Tekst',exact:true}).click();await surface.click({position:{x:60,y:60}});
  const text=page.getByLabel('Tekstinhoud',{exact:true});await text.fill('Annuleren');await text.press('Escape');
  await expect(text).not.toBeVisible();await expect(selection).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.history-item')).toHaveCount(0);
});

test('Open filters image files and offers a separate project picker', async ({page}) => {
  await page.goto('/');
  const event=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Openen',exact:true}).click();
  const picker=await event;
  const accepted=await picker.element().getAttribute('accept');
  expect(accepted).toContain('image/*');expect(accepted).toContain('.psd');expect(accepted).toContain('.heic');
  expect(accepted).not.toContain('.oapaint');expect(accepted).not.toContain('.pdf');await picker.setFiles([]);
  await page.getByRole('button',{name:'Bestand',exact:true}).click();
  const projectEvent=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'IFCX openen',exact:true}).click();
  const projectPicker=await projectEvent;
  expect(await projectPicker.element().getAttribute('accept')).toBe('.ifcx,.ifcimageb,.ifcxb');await projectPicker.setFiles([]);
});

test('IFCX raster exports include the image and reopen as a raster',async({page})=>{
  await page.goto('/');await expect(page.getByText('Concept opgeslagen op dit apparaat',{exact:true})).toBeVisible();
  const surface=page.getByLabel('Drawing surface',{exact:true});
  await surface.click({position:{x:60,y:60}});
  await expect(page.locator('.history-item')).toHaveCount(1);
  let binaryPath='';
  for(const [format,button] of [['ifcx','IFCX (raster)'],['ifcimageb','IfcImageB']]){
    await page.locator('.home-ribbon summary').filter({hasText:'Exporteren'}).click();
    const event=page.waitForEvent('download');await page.getByRole('button',{name:button,exact:true}).click();
    const file=await event;expect(file.suggestedFilename()).toBe(`Untitled.${format}`);
    const path=(await file.path())!;
    const {readRasterIfcx}=await import('../../shared/ifcx');
    const image=await readRasterIfcx(new Uint8Array(readFileSync(path)));
    expect(image.width).toBe(1200);expect(image.height).toBe(800);expect(image.uri).toMatch(/^data:image\/png;base64,/);
    if(format==='ifcimageb')binaryPath=path;
    await expect(page.locator('.history-item')).toHaveCount(1);
  }
  page.on('dialog',dialog=>void dialog.accept());
  await page.locator('input[accept^=".ifcx"]').setInputFiles({name:'raster.ifcimageb',mimeType:'application/octet-stream',buffer:readFileSync(binaryPath)});
  await expect(page.locator('.history-item')).toContainText('Afbeelding');
});

test('Save uses IFCX with an embedded PNG',async({page})=>{
  await page.goto('/');await expect(page.getByText('Concept opgeslagen op dit apparaat',{exact:true})).toBeVisible();
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Save',exact:true}).click();
  const file=await event;expect(file.suggestedFilename()).toBe('Untitled.ifcx');
  const {readRasterIfcx}=await import('../../shared/ifcx');
  const image=await readRasterIfcx(new Uint8Array(readFileSync((await file.path())!)));
  expect(image.width).toBe(1200);expect(image.height).toBe(800);
});

test('Ctrl + wheel zooms the canvas while ordinary wheel keeps the zoom level', async ({page}) => {
  await page.goto('/');
  await expect(page.getByText('Concept opgeslagen op dit apparaat', {exact:true})).toBeVisible();
  const zoom = page.locator('.statusbar input[type=range]');
  const initial = Number(await zoom.inputValue());
  await page.getByLabel('Drawing surface', {exact:true}).hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await expect(zoom).toHaveValue(String(initial + 10));
  await page.mouse.wheel(0, 100);
  await expect(zoom).toHaveValue(String(initial));
  await page.keyboard.up('Control');
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(150);
  await expect(zoom).toHaveValue(String(initial));
  for (const [key, delta, limit] of [['End', -100, '400'], ['Home', 100, '10']] as const) {
    await zoom.focus();
    await page.keyboard.press(key);
    await expect(zoom).toHaveValue(limit);
    const bounds = await page.locator('.canvas-workspace').boundingBox();
    await page.mouse.move(bounds!.x + 20, bounds!.y + 60);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, delta);
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await expect(zoom).toHaveValue(limit);
  }
});

test('holding the middle mouse button pans without drawing and releases outside the canvas', async ({page}) => {
  await page.goto('/');
  await expect(page.getByText('Concept opgeslagen op dit apparaat', {exact:true})).toBeVisible();
  const zoom = page.locator('.statusbar input[type=range]');
  await zoom.focus(); await page.keyboard.press('End');
  const scroll = page.locator('.canvas-scroll');
  await scroll.evaluate(element => { element.scrollLeft = 250; element.scrollTop = 250; });
  const box = (await scroll.boundingBox())!;
  const x = box.x + 200, y = box.y + 200;
  await page.mouse.move(x, y);
  await page.mouse.down({button:'middle'});
  await page.mouse.move(x + 80, y + 60, {steps:4});
  await expect(scroll).toHaveClass(/panning/);
  await expect.poll(() => scroll.evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual([170, 190]);
  await page.mouse.move(x, box.y - 20, {steps:4});
  await page.mouse.up({button:'middle'});
  await expect(scroll).not.toHaveClass(/panning/);
  await expect(page.locator('.history-item')).toHaveCount(0);
  const after = await scroll.evaluate(element => [element.scrollLeft, element.scrollTop]);
  await page.mouse.move(x + 20, y + 20);
  expect(await scroll.evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual(after);
  await page.mouse.down(); await page.mouse.move(x + 50, y + 50, {steps:3}); await page.mouse.up();
  await expect(page.locator('.history-item')).toHaveCount(1);
});

test('Ctrl+A selects all objects without selecting page text and preserves text editing', async ({page}) => {
  await page.goto('/');
  await expect(page.getByText('Concept opgeslagen op dit apparaat', {exact:true})).toBeVisible();
  const surface=page.getByLabel('Drawing surface',{exact:true});
  await page.getByRole('button',{name:'Rechthoek',exact:true}).click();
  const box=(await surface.boundingBox())!;
  for(const offset of [35,150]) {
    await page.mouse.move(box.x+offset,box.y+40);await page.mouse.down();
    await page.mouse.move(box.x+offset+50,box.y+90,{steps:3});await page.mouse.up();
  }
  await expect(page.locator('.history-item')).toHaveCount(2);
  await page.keyboard.press('Control+a');
  await expect(surface).toHaveClass(/tool-select/);
  await expect(page.locator('.selection-outline')).toBeVisible();
  expect(await page.evaluate(()=>window.getSelection()?.toString())).toBe('');
  const outline=(await page.locator('.selection-outline').boundingBox())!;
  expect(outline.width).toBeCloseTo(165, 0);
  await page.mouse.move(box.x+60,box.y+60);await page.mouse.down();
  await page.mouse.move(box.x+80,box.y+80,{steps:3});await page.mouse.up();
  const moved=(await page.locator('.selection-outline').boundingBox())!;
  expect(moved.x-outline.x).toBeCloseTo(20,0);
  expect(moved.width).toBeCloseTo(outline.width,0);
  await page.keyboard.press('Delete');await expect(page.locator('.history-item')).toHaveCount(0);
  await page.keyboard.press('Control+z');await expect(page.locator('.history-item')).toHaveCount(2);
  await page.getByRole('button',{name:'Tekst',exact:true}).click();
  await surface.click({position:{x:60,y:60}});
  const text=page.getByLabel('Tekstinhoud',{exact:true});
  await text.fill('Een tekst');await text.press('Control+a');await text.press('Backspace');
  await expect(text).toHaveValue('');
});
