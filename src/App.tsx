import { useState, useEffect, useRef, useCallback, type PointerEvent, type ComponentType, type CSSProperties } from 'react';
import { Paintbrush, Eraser, PaintBucket, Pipette, Minus, Square, Circle, Type, FilePlus2, FolderOpen, Download, Save, Grid2X2, Scan, ZoomIn, ZoomOut, Trash2, Plug, Upload, ArrowDownToLine, ChevronRight, Check, Image as ImageIcon, Clock3, Crop, RotateCw, FlipHorizontal2, Scaling, RotateCcw, FlipVertical2, MousePointer2, SlidersHorizontal, Contrast, PanelRight, Maximize2, CheckCheck } from 'lucide-react';
import TitleBar from './components/TitleBar';
import { releaseVersion } from './version';
import { rasterIfcx, encodeRasterIfcx, readRasterIfcx } from '../shared/ifcx';
import Dialog from './components/Dialog';
import RibbonGroup from './components/ribbon/RibbonGroup';
import RibbonTab from './components/ribbon/RibbonTab';
import RibbonMenu from './components/ribbon/RibbonMenu';
import { documentSchema, newDocument, drawOperation, type PaintDocument, type Operation, type Point } from '../shared/document';
import { renderDocument } from './render';
import { draftStore, saveFile, isDesktop } from './storage';
import { Backstage, BackstageTiles, type BackstagePage } from './components/Backstage';
import { ColorMenu } from './components/ColorPicker';
import { labels, type Label } from './labels';
import { operationBounds, transformedOperation, type Matrix, type Bounds } from '../shared/geometry';
import { documentSvg } from '../shared/svg';
import { adjustPixels, type Adjustments } from '../shared/adjustments';
import { decodeFile, bytesToDataUrl, supportedFormats, imageFileAccept } from './images';

type Tool = Exclude<Operation['type'], 'image'> | 'picker' | 'crop' | 'select';
const tools: { id: Tool; key: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'brush', key: 'B', icon: Paintbrush }, { id: 'eraser', key: 'E', icon: Eraser }, { id: 'fill', key: 'F', icon: PaintBucket }, { id: 'picker', key: 'I', icon: Pipette },
  { id: 'line', key: 'L', icon: Minus }, { id: 'rectangle', key: 'R', icon: Square }, { id: 'ellipse', key: 'O', icon: Circle }, { id: 'text', key: 'T', icon: Type }, { id: 'crop', key: 'C', icon: Crop }, { id: 'select', key: 'V', icon: MousePointer2 },
];
const palette = ['#36363e', '#ffffff', '#a1a1aa', '#d97706', '#f59e0b', '#ea580c', '#dc2626', '#e11d48', '#9333ea', '#4f46e5', '#2563eb', '#0891b2', '#0d9488', '#16a34a', '#65a30d', '#854d0e', '#78716c', '#e7e5e4', '#fcd34d', '#fed7aa', '#fecaca', '#fbcfe8', '#e9d5ff', '#c7d2fe', '#bfdbfe', '#a5f3fc', '#99f6e4', '#bbf7d0', '#d9f99d', '#d6d3d1'];
const apiBase = 'http://127.0.0.1:47831';
type Remote = { id: string; revision: number; document: PaintDocument };

function Action({ icon: Icon, label, onClick, disabled, active }: { icon: ComponentType<{ size?: number }>; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return <button className={`action ${active ? 'selected' : ''}`} onClick={onClick} disabled={disabled}><Icon size={21}/><span>{label}</span></button>;
}

export default function App() {
  const [doc, setDoc] = useState<PaintDocument>(() => newDocument());
  const [past, setPast] = useState<PaintDocument[]>([]), [future, setFuture] = useState<PaintDocument[]>([]);
  const [tool, setTool] = useState<Tool>('brush'), [color, setColor] = useState('#36363e'), [size, setSize] = useState(8), [opacity, setOpacity] = useState(100), [filled, setFilled] = useState(false);
  const [language, setLanguage] = useState<'en' | 'nl'>(() => localStorage.getItem('paint-language') === 'en' ? 'en' : 'nl');
  const [theme, setTheme] = useState(() => localStorage.getItem('paint-theme') || 'light');
  const t = useCallback((key: Label) => labels[language][key], [language]);
  const [tab, setTab] = useState('home'), [fileOpen, setFileOpen] = useState(false), [filePage, setFilePage] = useState<BackstagePage>('new'), [modal, setModal] = useState('');
  const [zoom, setZoom] = useState(75), [grid, setGrid] = useState(false), [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [draftStatus, setDraftStatus] = useState<Label>('saving'), [loaded, setLoaded] = useState(false), [toast, setToast] = useState('');
  const [text, setText] = useState('OpenAEC'), [newWidth, setNewWidth] = useState(1200), [newHeight, setNewHeight] = useState(800), [newName, setNewName] = useState('Untitled'), [newBackground, setNewBackground] = useState('#ffffff');
  const [token, setToken] = useState(''), [remote, setRemote] = useState<{ id: string; revision: number } | null>(null), [remoteId, setRemoteId] = useState(''), [remoteList, setRemoteList] = useState<{ id: string; name: string; revision: number }[]>([]), [apiBusy, setApiBusy] = useState(false);
  const [busy,setBusy]=useState(false),[focus,setFocus]=useState(false),[inspectorOpen,setInspectorOpen]=useState(true);
  const [selection,setSelection]=useState<number|'all'|null>(null),[transient,setTransient]=useState<PaintDocument|null>(null);
  const [textBox,setTextBox]=useState<{at:Point;index?:number}|null>(null),[textFont,setTextFont]=useState<'sans-serif'|'serif'|'monospace'>('sans-serif'),[textBold,setTextBold]=useState(false);
  const [corrections,setCorrections]=useState<Adjustments>({brightness:0,contrast:0,saturation:100}),[formats,setFormats]=useState<{format:string;description:string}[]>([]);
  const objectDrag=useRef<{indices:number[];at:Point;operations:Operation[];bounds:Bounds;resize:boolean;next:Operation[]}|null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), preview = useRef<HTMLCanvasElement>(null), workspace = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null);
  const gesture = useRef<Operation | null>(null), ready = useRef(false);

  const notify = useCallback((message: string) => setToast(message), []);
  const fail = useCallback((error: unknown) => notify(error instanceof Error ? error.message : String(error)), [notify]);
  const commit = useCallback((next: PaintDocument) => {
    const parsed = documentSchema.parse(next);
    setPast(history => [...history.slice(-39), doc]); setFuture([]); setDoc(parsed);
  }, [doc]);
  const add = useCallback((op: Operation) => {
    const next={...doc,operations:[...doc.operations,op]};
    if(doc.retainVectors) {commit(next);setSelection(next.operations.length-1);}
    else {setBusy(true);renderDocument({...next,background:'transparent'}).then(image=>commit({...next,operations:[{type:'image',data:image.toDataURL('image/png'),sourceSize:{width:doc.width,height:doc.height}}]})).catch(fail).finally(()=>setBusy(false));}
  }, [commit, doc,fail]);
  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture(f => [doc, ...f]); setDoc(past[past.length - 1]); setPast(p => p.slice(0, -1));
  }, [doc, past]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast(p => [...p, doc]); setDoc(future[0]); setFuture(f => f.slice(1));
  }, [doc, future]);
  useEffect(() => {
    let active = true;
    draftStore().then(saved => { if (saved && active) setDoc(saved); }).catch(fail).finally(() => { if (active) setLoaded(true); });
    if (isDesktop()) import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().show()).catch(fail);
    return () => { active = false; };
  }, [fail]);
  const openFileHandler = useRef(openFile);
  openFileHandler.current = openFile;
  useEffect(() => {
    if (!loaded || !isDesktop()) return;
    let active = true, processing = false;
    let unlisten: (() => void) | undefined;
    Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]).then(async ([{invoke}, {listen}]) => {
      const consume = async () => {
        if (!active || processing) return;
        processing = true;
        try {
          while (active) {
            const name = await invoke<string | null>('launch_file_name');
            if (!name) break;
            const bytes = await invoke<ArrayBuffer>('read_launch_file');
            await openFileHandler.current(new File([bytes], name));
          }
        } catch (error) { fail(error); }
        finally { processing = false; }
      };
      unlisten = await listen('paint-open-files', () => void consume());
      if (!active) { unlisten(); return; }
      await consume();
    }).catch(fail);
    return () => { active = false; unlisten?.(); };
  }, [loaded, fail]);
  useEffect(() => {
    if (isDesktop()) import('@tauri-apps/api/window').then(({getCurrentWindow}) => getCurrentWindow().setTitle(`${doc.name} — OpenAEC Paint Studio`)).catch(fail);
  }, [doc.name, fail]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme; document.documentElement.lang = language;
    localStorage.setItem('paint-theme', theme); localStorage.setItem('paint-language', language);
  }, [theme, language]);
  useEffect(() => {
    if (!loaded) return;
    setDraftStatus('saving');
    const timer = setTimeout(() => { draftStore(doc).then(() => setDraftStatus('saved')).catch(() => setDraftStatus('draftFailed')); }, 500);
    return () => clearTimeout(timer);
  }, [doc, loaded]);
  useEffect(() => {
    let active = true; ready.current = false;
    renderDocument(transient??doc).then(rendered => {
      if (!active || !canvas.current) return;
      canvas.current.width = doc.width; canvas.current.height = doc.height;
      canvas.current.getContext('2d')!.drawImage(rendered, 0, 0);
      ready.current = true;
    }).catch(fail);
    return () => { active = false; };
  }, [doc, transient, fail]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);

  const save = useCallback(async () => {
    try {
      const image = await renderDocument(doc);
      const blob = await encodeRasterIfcx(rasterIfcx(doc.name,doc.width,doc.height,image.toDataURL('image/png')));
      if (await saveFile(`${doc.name}.ifcx`, blob, 'ifcx')) notify(t('projectSaved'));
    } catch (error) { fail(error); }
  }, [doc, fail, notify, t]);
  const exportPng = useCallback(async () => {
    try {
      const rendered = await renderDocument(doc);
      const blob = await new Promise<Blob>((resolve, reject) => rendered.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed')), 'image/png'));
      if (await saveFile(`${doc.name}.png`, blob, 'png')) notify(t('exportDone'));
    } catch (error) { fail(error); }
  }, [doc, fail, notify, t]);
  const fit = useCallback(() => {
    const box = workspace.current?.getBoundingClientRect();
    if (box) setZoom(Math.max(10, Math.min(400, Math.floor(Math.min((box.width - 48) / doc.width, (box.height - 112) / doc.height) * 100))));
  }, [doc.width, doc.height]);
  useEffect(() => { if (loaded) fit(); }, [loaded, fit,focus,inspectorOpen]);
  useEffect(()=>{const observer=new ResizeObserver(()=>fit());if(workspace.current)observer.observe(workspace.current);return()=>observer.disconnect();},[fit]);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      setZoom(value => Math.max(10, Math.min(400, value + (event.deltaY < 0 ? 10 : -10))));
    };
    // A non-passive listener prevents browser page zoom over the drawing area.
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const element = workspace.current?.querySelector<HTMLDivElement>('.canvas-scroll');
    if (!element) return;
    let pan: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
    const stop = () => {
      const pointerId = pan?.pointerId;
      pan = null;
      element.classList.remove('panning');
      if (pointerId !== undefined && element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    };
    const down = (event: globalThis.PointerEvent) => {
      if (event.button !== 1 || gesture.current || objectDrag.current) return;
      event.preventDefault(); event.stopPropagation();
      pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
      element.setPointerCapture(event.pointerId);
      element.classList.add('panning');
    };
    const move = (event: globalThis.PointerEvent) => {
      if (!pan || event.pointerId !== pan.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      if (!(event.buttons & 4)) { stop(); return; }
      element.scrollLeft = pan.left - (event.clientX - pan.x);
      element.scrollTop = pan.top - (event.clientY - pan.y);
    };
    const up = (event: globalThis.PointerEvent) => {
      if (!pan || event.pointerId !== pan.pointerId) return;
      event.preventDefault(); event.stopPropagation(); stop();
    };
    const auxClick = (event: MouseEvent) => { if (event.button === 1) event.preventDefault(); };
    element.addEventListener('pointerdown', down, true);
    element.addEventListener('pointermove', move, true);
    element.addEventListener('pointerup', up, true);
    element.addEventListener('pointercancel', up, true);
    element.addEventListener('lostpointercapture', stop);
    element.addEventListener('auxclick', auxClick);
    return () => {
      stop();
      element.removeEventListener('pointerdown', down, true);
      element.removeEventListener('pointermove', move, true);
      element.removeEventListener('pointerup', up, true);
      element.removeEventListener('pointercancel', up, true);
      element.removeEventListener('lostpointercapture', stop);
      element.removeEventListener('auxclick', auxClick);
    };
  }, []);
  useEffect(()=>{setSelection(index=>typeof index==='number'&&index>=doc.operations.length?null:index);},[doc.operations.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        gesture.current = null; objectDrag.current = null;
        preview.current?.getContext('2d')?.clearRect(0, 0, doc.width, doc.height);
        setTextBox(null); setTransient(null); setFileOpen(false); setModal('');
        document.querySelectorAll('details[open]').forEach(menu => (menu as HTMLDetailsElement).open = false);
        setTool('select');
        if ((e.target as HTMLElement).matches('input, textarea, select')) (e.target as HTMLElement).blur();
        return;
      }
      if ((e.target as HTMLElement).closest('input, textarea, select, dialog') || modal || busy) return;
      if(e.key==='Delete' && selection!==null && tool==='select'){e.preventDefault();commit({...doc,operations:selection==='all'?[]:doc.operations.filter((_,i)=>i!==selection)});setSelection(null);return;}
      if(e.key==='F11'){e.preventDefault();setFocus(value=>!value);return;}
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (['a', 's', 'o', 'z', 'y'].includes(key)) e.preventDefault();
        if (key === 'a') {
          window.getSelection()?.removeAllRanges();
          gesture.current = null; objectDrag.current = null; setTransient(null);
          preview.current?.getContext('2d')?.clearRect(0, 0, doc.width, doc.height);
          setTool('select'); setSelection('all');
        }
        if (key === 's') void save();
        if (key === 'o') input.current?.click();
        if (key === 'z') e.shiftKey ? redo() : undo();
        if (key === 'y') redo();
      } else {
        const selected = tools.find(item => item.key.toLowerCase() === e.key.toLowerCase());
        if (selected) {setTool(selected.id);if(selected.id==='text'&&size<24)setSize(32);}
        if (e.key === '[') setSize(s => Math.max(1, s - 1));
        if (e.key === ']') setSize(s => Math.min(200, s + 1));
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo, modal, busy, selection,tool,commit,doc,size]);

  function location(e: PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: Math.round((e.clientX - rect.left) * doc.width / rect.width), y: Math.round((e.clientY - rect.top) * doc.height / rect.height) };
  }
  function previewGesture() {
    const ctx = preview.current?.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, doc.width, doc.height);
    if (!gesture.current) return;
    if (gesture.current.type === 'eraser') drawOperation(ctx, { ...gesture.current, type: 'brush', color: doc.background === 'transparent' ? '#a1a1aa' : doc.background });
    else drawOperation(ctx, gesture.current);
  }
  function pointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if ((!ready.current&&!objectDrag.current) || busy || e.button !== 0 || gesture.current || textBox) return;
    const at = location(e); setPosition(at); e.currentTarget.setPointerCapture(e.pointerId);
    const style = { color, size, opacity: opacity / 100 };
    if(tool==='select') {
      const selectedBounds=selection==='all'?allBounds(doc):typeof selection==='number'?boundsFor(doc.operations[selection]):null;
      const nearCorner=selectedBounds&&Math.hypot(at.x-selectedBounds.x-selectedBounds.width,at.y-selectedBounds.y-selectedBounds.height)<12*100/zoom;
      const inGroup=selection==='all'&&selectedBounds&&at.x>=selectedBounds.x&&at.x<=selectedBounds.x+selectedBounds.width&&at.y>=selectedBounds.y&&at.y<=selectedBounds.y+selectedBounds.height;
      if(selection==='all'&&(inGroup||nearCorner)){
        const operations=doc.operations;
        objectDrag.current={indices:operations.map((_,i)=>i),at,operations,bounds:selectedBounds!,resize:!!nearCorner,next:operations};
        return;
      }
      const index=nearCorner&&typeof selection==='number'?selection:[...doc.operations.keys()].reverse().find(i=>{const b=boundsFor(doc.operations[i]);return b&&at.x>=b.x-5&&at.x<=b.x+b.width+5&&at.y>=b.y-5&&at.y<=b.y+b.height+5;});
      setSelection(index??null);
      if(index!==undefined){const operation=doc.operations[index],bounds=boundsFor(operation)!;objectDrag.current={indices:[index],at,operations:[operation],bounds,resize:!!nearCorner,next:[operation]};if('color' in operation)setColor(operation.color);if('size' in operation){setSize(operation.size);setOpacity(operation.opacity*100);}if('filled' in operation)setFilled(operation.filled);if(operation.type==='text'){setTextFont(operation.fontFamily||'sans-serif');setTextBold(!!operation.bold);}}
      return;
    }
    if (tool === 'picker') {
      const pixel = canvas.current!.getContext('2d')!.getImageData(Math.max(0, Math.min(doc.width - 1, at.x)), Math.max(0, Math.min(doc.height - 1, at.y)), 1, 1).data;
      setColor('#' + Array.from(pixel.slice(0, 3)).map(c => c.toString(16).padStart(2, '0')).join('')); setTool('brush'); return;
    }
    if (tool === 'fill') { add({ type: 'fill', at, color }); return; }
    if (tool === 'text') {
      const index=doc.retainVectors?[...doc.operations.keys()].reverse().find(i=>{const op=doc.operations[i],b=boundsFor(op);return op.type==='text'&&b&&at.x>=b.x&&at.x<=b.x+b.width&&at.y>=b.y&&at.y<=b.y+b.height;}):undefined;
      const existing=index!==undefined?doc.operations[index]:null;
      if(existing?.type==='text'){setText(existing.text);setSize(existing.size);setColor(existing.color);setTextFont(existing.fontFamily||'sans-serif');setTextBold(!!existing.bold);setTextBox({at:boundsFor(existing)!,index});}
      else {setText('');if(size<24)setSize(32);setTextBox({at});}
      return;
    }
    if (tool === 'brush' || tool === 'eraser') gesture.current = { type: tool, points: [at], ...style };
    else gesture.current = { type: tool === 'crop' ? 'rectangle' : tool, from: at, to: at, filled: tool === 'crop' ? false : filled, ...style, ...(tool === 'crop' ? { color: '#2563eb', size: 1, opacity: 1 } : {}) };
    previewGesture();
  }
  function pointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const at = location(e); setPosition(at);
    const drag=objectDrag.current;
    if(drag){
      const dx=at.x-drag.at.x,dy=at.y-drag.at.y,b=drag.bounds;
      let matrix:Matrix=[1,0,0,1,dx,dy];
      if(drag.resize){let sx=Math.max(.05,(b.width+dx)/b.width),sy=Math.max(.05,(b.height+dy)/b.height);if(e.shiftKey)sx=sy=Math.max(sx,sy);matrix=[sx,0,0,sy,b.x*(1-sx),b.y*(1-sy)];}
      drag.next=drag.operations.map(op=>transformedOperation(op,matrix,doc));
      setTransient({...doc,operations:doc.operations.map((op,i)=>{const index=drag.indices.indexOf(i);return index<0?op:drag.next[index];})});return;
    }
    const op = gesture.current; if (!op) return;
    if (op.type === 'brush' || op.type === 'eraser') { if (op.points.length < 20000) op.points.push(at); }
    else if ('to' in op) {
      op.to = at;
      if (e.shiftKey) {
        if (op.type === 'line') { const distance = Math.hypot(at.x - op.from.x, at.y - op.from.y); const angle = Math.round(Math.atan2(at.y - op.from.y, at.x - op.from.x) / (Math.PI / 4)) * Math.PI / 4; op.to = { x: op.from.x + Math.cos(angle) * distance, y: op.from.y + Math.sin(angle) * distance }; }
        else { const d = Math.max(Math.abs(at.x - op.from.x), Math.abs(at.y - op.from.y)); op.to = { x: op.from.x + Math.sign(at.x - op.from.x) * d, y: op.from.y + Math.sign(at.y - op.from.y) * d }; }
      }
    }
    previewGesture();
  }
  function pointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if(objectDrag.current){const drag=objectDrag.current;objectDrag.current=null;setTransient(null);if(drag.next.some((op,i)=>op!==drag.operations[i]))commit({...doc,operations:doc.operations.map((op,i)=>{const index=drag.indices.indexOf(i);return index<0?op:drag.next[index];})});}
    const op = gesture.current; gesture.current = null;
    preview.current?.getContext('2d')?.clearRect(0, 0, doc.width, doc.height);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (op) { try { if (tool === 'crop' && 'from' in op) void transform('crop', op.from, op.to); else add(op); } catch (error) { fail(error); } }
  }
  function boundsFor(op:Operation){return operationBounds(op.type==='image'?{...op,sourceSize:op.sourceSize||{width:doc.width,height:doc.height}}:op);}
  function allBounds(document:PaintDocument):Bounds {
    const bounds=document.operations.map(boundsFor).filter((value):value is Bounds=>value!==null);
    if(!bounds.length)return {x:0,y:0,width:document.width,height:document.height};
    const x=Math.min(...bounds.map(b=>b.x)),y=Math.min(...bounds.map(b=>b.y));
    return {x,y,width:Math.max(...bounds.map(b=>b.x+b.width))-x,height:Math.max(...bounds.map(b=>b.y+b.height))-y};
  }
  function applyText(){
    if(!textBox||!text.trim())return;
    const existing=textBox.index!==undefined?doc.operations[textBox.index]:null;
    const op:Operation={...(existing?.type==='text'?existing:{type:'text',at:textBox.at}),text,color,size:Math.max(1,size),opacity:opacity/100,fontFamily:textFont,bold:textBold};
    if(textBox.index!==undefined)commit({...doc,operations:doc.operations.map((operation,i)=>i===textBox.index?op:operation)});else add(op);
    setTextBox(null);
  }
  async function transform(action:'rotate'|'rotateLeft'|'flip'|'flipVertical'|'resize'|'crop',from?:Point,to?:Point){
    setBusy(true);
    try{
      const quarter=action==='rotate'||action==='rotateLeft';
      let w=quarter?doc.height:action==='resize'?newWidth:doc.width,h=quarter?doc.width:action==='resize'?newHeight:doc.height,x=0,y=0;
      if(action==='crop'&&from&&to){x=Math.max(0,Math.min(doc.width,Math.min(from.x,to.x)));y=Math.max(0,Math.min(doc.height,Math.min(from.y,to.y)));w=Math.min(doc.width,Math.max(from.x,to.x))-x;h=Math.min(doc.height,Math.max(from.y,to.y))-y;if(w<1||h<1)throw new Error('Select a crop region first');}
      newDocument(w,h,doc.name);
      const matrices:Record<typeof action,Matrix>={rotate:[0,1,-1,0,w,0],rotateLeft:[0,-1,1,0,0,h],flip:[-1,0,0,1,w,0],flipVertical:[1,0,0,-1,0,h],resize:[w/doc.width,0,0,h/doc.height,0,0],crop:[1,0,0,1,-x,-y]};
      let sourceOperations=doc.operations;
      const lastFill=doc.operations.findLastIndex(op=>op.type==='fill');
      if(action==='crop'&&lastFill>=0){const prefix=await renderDocument({...doc,background:'transparent',operations:doc.operations.slice(0,lastFill+1)});sourceOperations=[{type:'image',data:prefix.toDataURL('image/png'),sourceSize:{width:doc.width,height:doc.height}},...doc.operations.slice(lastFill+1)];}
      let operations=sourceOperations.map(op=>transformedOperation(op,matrices[action],{width:doc.width,height:doc.height}));
      if(!doc.retainVectors){const image=await renderDocument({...doc,width:w,height:h,operations,background:'transparent'});operations=[{type:'image',data:image.toDataURL('image/png'),sourceSize:{width:w,height:h}}];}
      commit({...doc,width:w,height:h,operations});setSelection(null);setModal('');if(action==='crop')setTool('brush');
    }catch(error){fail(error);}finally{setBusy(false);}
  }
  async function filterImage(kind:'adjust'|'grayscale'|'invert'|'sepia'){
    setBusy(true);try{const image=await renderDocument(doc),ctx=image.getContext('2d')!,pixels=ctx.getImageData(0,0,doc.width,doc.height);adjustPixels(pixels.data,kind==='adjust'?corrections:{brightness:0,contrast:0,saturation:100},kind);ctx.putImageData(pixels,0,0);commit({...doc,operations:[{type:'image',data:image.toDataURL('image/png'),sourceSize:{width:doc.width,height:doc.height}}]});setSelection(null);setModal('');}catch(error){fail(error);}finally{setBusy(false);}
  }
  async function exportOther(format:'svg'|'jpeg'|'webp'|'ifcx'|'ifcxb'){
    try{
      let blob:Blob;
      if(format==='ifcx'||format==='ifcxb'){
        const image=await renderDocument(doc);
        blob=await encodeRasterIfcx(rasterIfcx(doc.name,doc.width,doc.height,image.toDataURL('image/png')),format==='ifcxb');
      }else if(format==='svg'){
        let output=doc;const lastFill=doc.operations.findLastIndex(op=>op.type==='fill');
        if(lastFill>=0){const prefix=await renderDocument({...doc,background:'transparent',operations:doc.operations.slice(0,lastFill+1)});output={...doc,operations:[{type:'image',data:prefix.toDataURL('image/png'),sourceSize:{width:doc.width,height:doc.height}},...doc.operations.slice(lastFill+1)]};}
        blob=new Blob([documentSvg(output)],{type:'image/svg+xml'});
      }else {const image=await renderDocument(format==='jpeg'?{...doc,background:doc.background==='transparent'?'#ffffff':doc.background}:doc);blob=await new Promise<Blob>((resolve,reject)=>image.toBlob(value=>value?resolve(value):reject(new Error('Export failed')),`image/${format}`,.94));}
      await saveFile(`${doc.name}.${format==='jpeg'?'jpg':format}`,blob,format==='jpeg'?'jpg':format);
    }catch(error){fail(error);}
  }
  async function setVectorMode(enabled:boolean){
    if(enabled){commit({...doc,retainVectors:true});return;}
    setBusy(true);try{const image=await renderDocument({...doc,background:'transparent'});commit({...doc,retainVectors:false,operations:doc.operations.length?[{type:'image',data:image.toDataURL('image/png'),sourceSize:{width:doc.width,height:doc.height}}]:[]});setSelection(null);}catch(error){fail(error);}finally{setBusy(false);}
  }
  async function openFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 64_000_000) throw new Error('File exceeds 64 MB');
      if(/\.ifcxb?$/i.test(file.name)){
        const image=await readRasterIfcx(new Uint8Array(await file.arrayBuffer()));
        file=new File([image.bytes as BlobPart],`${image.name}.png`,{type:'image/png'});
      }
      let next: PaintDocument;
      {
        const decoded=await decodeFile(file);
        next=newDocument(decoded.width,decoded.height,file.name.replace(/\.[^.]+$/,''));
        next.background='transparent';next.retainVectors=doc.retainVectors;
        next.operations=[{type:'image',data:await bytesToDataUrl(decoded.bytes),sourceSize:{width:decoded.width,height:decoded.height}}];
        next=documentSchema.parse(next);
        if(decoded.original.width!==decoded.width||decoded.original.height!==decoded.height)notify(`${decoded.original.width} × ${decoded.original.height} → ${decoded.width} × ${decoded.height} px`);
      }
      if (doc.operations.length && !window.confirm(t('replaceConfirm'))) return;
      commit(next); setRemote(null); notify(t('opened'));
    } catch (error) { fail(error); }
    finally { setBusy(false); if (input.current) input.current.value = ''; if (projectInput.current) projectInput.current.value = ''; }
  }
  async function api(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(apiBase + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || `API ${response.status}`); return value;
  }
  async function apiAction(action: 'list' | 'push' | 'pull') {
    setApiBusy(true);
    try {
      if (action === 'list') { setRemoteList(await api('/v1/documents')); notify(t('connected')); }
      if (action === 'push') {
        const result: Remote = remote ? await api(`/v1/documents/${remote.id}`, 'PUT', { document: doc, expectedRevision: remote.revision }) : await api('/v1/documents', 'POST', doc);
        setRemote({ id: result.id, revision: result.revision }); setRemoteId(result.id); notify(`${t('push')} · ${result.id}`);
      }
      if (action === 'pull') {
        if (!/^[a-f0-9-]{36}$/.test(remoteId)) throw new Error('Select a valid document ID');
        const result: Remote = await api(`/v1/documents/${remoteId}`);
        if (doc.operations.length && !window.confirm(t('replaceConfirm'))) return;
        commit(documentSchema.parse(result.document)); setRemote({ id: result.id, revision: result.revision }); notify(t('opened'));
      }
    } catch (error) { fail(error); } finally { setApiBusy(false); }
  }
  const chooseFile = () => { input.current?.click(); setFileOpen(false); };
  const actionNew = () => { setNewWidth(doc.width); setNewHeight(doc.height); setModal('new'); setFileOpen(false); };
  const safeZoom = (value: number) => setZoom(Math.max(10, Math.min(400, value)));
  const selectedOperation=typeof selection==='number'?(transient??doc).operations[selection]:undefined;
  const selectedBounds=tool==='select'?(selection==='all'?allBounds(transient??doc):selectedOperation?boundsFor(selectedOperation):null):null;
  return <div className={`studio ${focus?'focus-mode':''} ${fileOpen?'file-open':''}`} aria-busy={busy}>
    <TitleBar name={doc.name} save={() => void save()} undo={undo} redo={redo} settings={() => setModal('settings')} canUndo={past.length > 0} canRedo={future.length > 0}/>
    <input ref={input} type="file" accept={imageFileAccept} hidden onChange={e => void openFile(e.target.files?.[0])}/>
    <input ref={projectInput} type="file" accept=".ifcx,.ifcxb" hidden onChange={e => void openFile(e.target.files?.[0])}/>
    <nav className="ribbon-tabs" aria-label="Ribbon">
      <RibbonTab label={t('file')} isFileTab onClick={() => setFileOpen(!fileOpen)}/>
      {(['home'] as const).map(id => <RibbonTab key={id} label={t(id)} isActive={tab === id} onClick={() => { setTab(id); setFileOpen(false); }}/>) }
      <span className="ribbon-hint">{t('about')}</span>
    </nav>
    <section className={`paint-ribbon ${tab==='home'?'home-ribbon':''}`} aria-label={t(tab as 'home' | 'image' | 'view' | 'automation')}>
      {tab === 'home' && <>
        <RibbonGroup label={t('project')}>
          <Action icon={FolderOpen} label={t('open')} onClick={chooseFile}/>
          <RibbonMenu icon={Download} label={language==='nl'?'Exporteren':'Export'}>
            <button onClick={()=>void exportPng()}>PNG</button><button onClick={()=>void exportOther('jpeg')}>JPEG</button><button onClick={()=>void exportOther('webp')}>WebP</button><button onClick={()=>void exportOther('svg')}>SVG</button><hr/><button onClick={()=>void exportOther('ifcx')}>IFCX (raster)</button><button onClick={()=>void exportOther('ifcxb')}>IFCXB (raster)</button>
            <hr/><button onClick={()=>void save()}><Save size={15}/>{t('save')}</button><button onClick={actionNew}><FilePlus2 size={15}/>{t('new')}</button>
          </RibbonMenu>
        </RibbonGroup>
        <RibbonGroup label={t('tools')}><div className="tool-options"><div className="ribbon-tools">{tools.filter(item=>item.id!=='crop').map(({id,icon:Icon,key})=><button key={id} className={tool===id?'selected':''} onClick={()=>{setTool(id);if(id==='text'&&size<24)setSize(32);}} title={`${t(id)} (${key})`} aria-label={t(id)} aria-pressed={tool===id}><Icon size={19}/></button>)}</div>
          <label className="vector-toggle" title={t('vectorHint')}><input type="checkbox" checked={doc.retainVectors} onChange={e=>void setVectorMode(e.target.checked)}/>{t('retainVectors')}</label>
        </div></RibbonGroup>
        <RibbonGroup label={t('properties')}><div className="brush-settings">
          <label>{t('size')}<input aria-label={t('size')} type="number" min="1" max="200" disabled={['fill','picker','crop'].includes(tool)} value={size} onChange={e=>setSize(Math.max(1,Math.min(200,Number(e.target.value)||1)))}/><span>px</span></label>
          <label htmlFor="opacity">{t('opacity')}<input id="opacity" type="range" min="1" max="100" value={opacity} disabled={['fill','picker','crop'].includes(tool)} onChange={e=>setOpacity(+e.target.value)}/><span>{opacity}%</span></label>
          {(tool==='rectangle'||tool==='ellipse')&&<label className="shape-filled"><input type="checkbox" checked={filled} onChange={e=>setFilled(e.target.checked)}/>{t('filled')}</label>}
          {tool==='text'&&<div className="text-settings"><select aria-label="Font" value={textFont} onChange={e=>setTextFont(e.target.value as typeof textFont)}><option value="sans-serif">Sans serif</option><option value="serif">Serif</option><option value="monospace">Monospace</option></select><label><input type="checkbox" checked={textBold} onChange={e=>setTextBold(e.target.checked)}/>{language==='nl'?'Vet':'Bold'}</label></div>}
          {tool==='select'&&typeof selection==='number'&&<RibbonMenu icon={MousePointer2} label="Object">          {selectedOperation?.type==='text'&&<div className="text-settings"><select aria-label="Font" value={textFont} onChange={e=>setTextFont(e.target.value as typeof textFont)}><option value="sans-serif">Sans serif</option><option value="serif">Serif</option><option value="monospace">Monospace</option></select><label><input type="checkbox" checked={textBold} onChange={e=>setTextBold(e.target.checked)}/>{language==='nl'?'Vet':'Bold'}</label></div>}{selectedOperation&&'filled' in selectedOperation&&<label><input type="checkbox" checked={filled} onChange={e=>setFilled(e.target.checked)}/>{t('filled')}</label>}          {tool==='select'&&selection!==null&&selectedOperation&&<div className="object-actions"><button className="ribbon-small-button" disabled={!('color' in selectedOperation)} onClick={()=>{if(!('color' in selectedOperation))return;const op={...selectedOperation,color,...('size' in selectedOperation?{size,opacity:opacity/100}:{}),...(selectedOperation.type==='text'?{fontFamily:textFont,bold:textBold}:{}),...('filled' in selectedOperation?{filled}: {})};commit({...doc,operations:doc.operations.map((item,i)=>i===selection?op:item)});}}>{t('objectApply')}</button><button className="ribbon-small-button" onClick={()=>{commit({...doc,operations:doc.operations.filter((_,i)=>i!==selection)});setSelection(null);}}><Trash2 size={13}/>{t('deleteObject')}</button></div>}</RibbonMenu>}
        </div></RibbonGroup>
        <RibbonGroup label={t('colors')}><div className="color-control"><ColorMenu color={color} onChange={setColor} title={t('color')}/><div className="palette">{palette.map(c => <button key={c} style={{ background: c }} className={c === color ? 'color-active' : ''} title={c} aria-label={c} onClick={() => setColor(c)}/>)}</div></div></RibbonGroup>
        <RibbonGroup label={t('image')}><div className="image-commands">
          <button onClick={()=>{setTool('crop');notify(t('cropHint'));}}><Crop size={16}/>{t('crop')}</button>
          <button onClick={()=>{setNewWidth(doc.width);setNewHeight(doc.height);setModal('resize');}}><Scaling size={16}/>{t('resize')}</button>
          <RibbonMenu icon={RotateCw} label={language==='nl'?'Draaien / spiegelen':'Rotate / flip'}>
            <button onClick={()=>void transform('rotate')}><RotateCw size={16}/>{t('rotate')}</button><button onClick={()=>void transform('rotateLeft')}><RotateCcw size={16}/>{t('rotateLeft')}</button><hr/>
            <button onClick={()=>void transform('flip')}><FlipHorizontal2 size={16}/>{t('flip')}</button><button onClick={()=>void transform('flipVertical')}><FlipVertical2 size={16}/>{t('flipVertical')}</button>
          </RibbonMenu>
        </div><div className="image-commands">
          <button onClick={()=>{setCorrections({brightness:0,contrast:0,saturation:100});setModal('adjust');}}><SlidersHorizontal size={16}/>{t('adjustments')}</button>
          <RibbonMenu icon={Contrast} label={language==='nl'?'Filters':'Filters'}><button onClick={()=>void filterImage('grayscale')}>{t('grayscale')}</button><button onClick={()=>void filterImage('invert')}>{t('invert')}</button><button onClick={()=>void filterImage('sepia')}>{t('sepia')}</button></RibbonMenu>
          <RibbonMenu icon={ImageIcon} label={t('canvas')}><label>{t('background')}<select aria-label={t('background')} value={doc.background} onChange={e=>commit({...doc,background:e.target.value})}><option value="#ffffff">{t('white')}</option><option value="transparent">{t('transparent')}</option></select></label><button disabled={!doc.operations.length} onClick={()=>{if(window.confirm(t('clearConfirm')))commit({...doc,operations:[]});}}><Trash2 size={15}/>{t('clear')}</button></RibbonMenu>
        </div></RibbonGroup>
        <RibbonGroup label={t('view')}><div className="view-commands"><button onClick={fit}><Scan size={16}/>{t('fit')}</button>
          <RibbonMenu icon={Grid2X2} label={t('view')}><button onClick={()=>setGrid(!grid)} aria-pressed={grid}><Grid2X2 size={16}/>{t('grid')}{grid&&<Check size={14}/>}</button><button onClick={()=>setZoom(100)}>{t('actual')}</button><button onClick={()=>safeZoom(zoom-25)}><ZoomOut size={16}/>−</button><button onClick={()=>safeZoom(zoom+25)}><ZoomIn size={16}/>+</button><hr/><button onClick={()=>setInspectorOpen(!inspectorOpen)}><PanelRight size={16}/>{t('properties')}</button><button onClick={()=>setFocus(!focus)}><Maximize2 size={16}/>{t('fullscreen')}</button><button onClick={()=>setModal('settings')}>{t('settings')}</button></RibbonMenu>
          <button onClick={()=>setFocus(!focus)}><Maximize2 size={16}/>{t('fullscreen')}</button>
        </div><div className="icon-commands">
          <button onClick={()=>safeZoom(zoom-25)} title={t('zoomOut')} aria-label={t('zoomOut')}><ZoomOut size={16}/></button>
          <button onClick={()=>safeZoom(zoom+25)} title={t('zoomIn')} aria-label={t('zoomIn')}><ZoomIn size={16}/></button>
          <button onClick={()=>setZoom(100)} title={t('actual')} aria-label={t('actual')}><ImageIcon size={16}/></button>
        </div></RibbonGroup>
        <RibbonGroup label="API"><div className="icon-commands">
          <button onClick={()=>setModal('api')} title={t('connect')} aria-label={t('connect')}><Plug size={16}/></button>
          <button onClick={()=>token ? void apiAction('push') : setModal('api')} disabled={apiBusy} title={t('push')} aria-label={t('push')}><Upload size={16}/></button>
          <button onClick={()=>setModal('api')} title={t('pull')} aria-label={t('pull')}><ArrowDownToLine size={16}/></button>
        </div></RibbonGroup>
      </>}
    </section>
    {fileOpen && (() => {
      const close = () => setFileOpen(false);
      const then = (action: () => void) => () => { close(); action(); };
      const titles: Record<BackstagePage, string> = { new: t('fileNew'), open: t('open'), save: t('fileSave'), export: t('fileExport'), formats: t('fileFormats'), about: t('fileAbout') };
      const leads: Record<BackstagePage, string> = { new: t('newLead'), open: t('openLead'), save: t('saveLead'), export: t('exportLead'), formats: t('formatsLead'), about: t('aboutLead') };
      return <Backstage page={filePage} onPage={page => { setFilePage(page); if (page === 'formats' && !formats.length) void supportedFormats().then(list => setFormats(list.formats)).catch(fail); }}
        pages={{ task: [['new', titles.new], ['open', titles.open], ['save', titles.save], ['export', titles.export]], other: [['formats', titles.formats], ['about', titles.about]] }}
        heading={titles[filePage]} lead={leads[filePage]}
        settings={[t('fileSettings'), then(() => setModal('settings'))]} back={[t('fileBack'), close]}
        exit={isDesktop() ? [t('fileExit'), () => void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close()).catch(fail)] : null}>
        {filePage === 'new' && <BackstageTiles tiles={[{ title: t('new') + '…', detail: t('newCanvasDetail'), onClick: actionNew }]}/>}
        {filePage === 'open' && <BackstageTiles tiles={[{ title: t('openImage'), detail: t('openImageDetail'), onClick: chooseFile }, { title: t('openProject'), detail: t('openProjectDetail'), onClick: then(() => projectInput.current?.click()) }]}/>}
        {filePage === 'save' && <BackstageTiles tiles={[{ title: t('save'), detail: t('saveDetail'), onClick: then(() => void save()) }]}/>}
        {filePage === 'export' && <BackstageTiles tiles={[
          { title: 'PNG', detail: t('exportPngDetail'), onClick: then(() => void exportPng()) },
          { title: 'JPEG', detail: t('exportJpegDetail'), onClick: then(() => void exportOther('jpeg')) },
          { title: 'WebP', detail: t('exportWebpDetail'), onClick: then(() => void exportOther('webp')) },
          { title: 'SVG', detail: t('exportSvgDetail'), onClick: then(() => void exportOther('svg')) },
          { title: 'IFCX (raster)', detail: t('exportRasterDetail'), onClick: then(() => void exportOther('ifcx')) },
          { title: 'IFCXB (raster)', detail: t('exportRasterDetail'), onClick: then(() => void exportOther('ifcxb')) },
        ]}/>}
        {filePage === 'formats' && <div className="format-list backstage-formats">{formats.map(item => <span key={item.format} title={item.description}>{item.format}</span>)}</div>}
        {filePage === 'about' && <div className="backstage-about"><strong>OpenAEC Paint Studio · {releaseVersion}</strong><p>{t('about')}</p><a href="https://github.com/OpenAEC-Foundation/OpenAEC-style-book" target="_blank" rel="noreferrer">OpenAEC style book · CC BY-SA 4.0</a></div>}
      </Backstage>;
    })()}
    <div className="document-bar"><div className="document-tab"><ImageIcon size={14}/><span>{doc.name}.ifcx</span><span className="tab-dot" title={t(draftStatus)}/></div><button onClick={actionNew} title={t('new')} aria-label={t('new')}>+</button><span className="workspace-label">{t('local')}</span></div>
    <div className="work-area">

      <main ref={workspace} className="canvas-workspace">
        <div className="workspace-topline"><span>{t('canvas')} <ChevronRight size={12}/> {doc.name}</span><div className="canvas-view-controls"><span>{doc.width} × {doc.height} px</span><button onClick={()=>setFocus(!focus)} aria-label={t('fullscreen')} title={t('fullscreen')}><Maximize2 size={15}/><span>{t('fullscreen')}</span></button></div></div>
        <div className="canvas-scroll"><div className="canvas-margin"><div className="artboard" style={{ width: doc.width * zoom / 100, height: doc.height * zoom / 100 } as CSSProperties}>
          <canvas ref={canvas} className="drawing" aria-label={t('canvas')} width={doc.width} height={doc.height}/>
          {grid && <div className="grid-overlay" style={{ backgroundSize: `${20 * zoom / 100}px ${20 * zoom / 100}px` }}/>}
          <canvas ref={preview} className={`drawing input-canvas tool-${tool}`} width={doc.width} height={doc.height} aria-label="Drawing surface" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { gesture.current = null; objectDrag.current=null;setTransient(null);previewGesture(); }}/>
          {selectedBounds&&<div className="selection-outline" style={{left:selectedBounds.x*zoom/100,top:selectedBounds.y*zoom/100,width:selectedBounds.width*zoom/100,height:selectedBounds.height*zoom/100}}><i/><i/><i/><i/></div>}
          {textBox&&<div className="inline-text-editor" style={{left:Math.min(textBox.at.x*zoom/100,Math.max(0,doc.width*zoom/100-250)),top:textBox.at.y*zoom/100}}><textarea autoFocus aria-label={t('textInput')} placeholder={t('textInput')} maxLength={2000} rows={3} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();applyText();}}} style={{fontFamily:textFont,fontWeight:textBold?'bold':'normal',fontSize:Math.max(14,size*zoom/100),color}}/><div><button onClick={applyText}><CheckCheck size={14}/>{t('textDone')}</button><button onClick={()=>setTextBox(null)}>{t('cancel')}</button></div></div>}
          <span className="canvas-corner"/>
        </div><div className="canvas-caption">{doc.width} × {doc.height} <span>PX</span></div></div></div>
        <div className="workspace-tip">{tool === 'text' ? t('textHint') : tool === 'crop' ? t('cropHint') : t('help')}</div>
      </main>
      {inspectorOpen&&<aside className="inspector"><div className="panel-heading">{t('properties')}<span>01</span></div>
        <section className="inspector-section"><h3>{t('canvas')}</h3><div className="dimension-pair"><div><small>{t('width')}</small><strong>{doc.width} <em>px</em></strong></div><span>×</span><div><small>{t('height')}</small><strong>{doc.height} <em>px</em></strong></div></div></section>
        <div className="panel-heading history-heading"><span><Clock3 size={14}/>{t('history')}</span><b>{doc.operations.length}</b></div><div className="history-list">{!doc.operations.length ? <div className="empty-history"><Paintbrush size={26}/><strong>{t('noHistory')}</strong><p>{t('historyHint')}</p></div> : [...doc.operations].reverse().slice(0, 40).map((op, i) => <div className={`history-item ${i === 0 ? 'latest' : ''}`} key={`${doc.operations.length - i}-${op.type}`}><span className="history-number">{String(doc.operations.length - i).padStart(2, '0')}</span><span>{op.type === 'image' ? t('image') : t(op.type)}</span>{i === 0 && <Check size={13}/>}</div>)}</div>
        <footer className="inspector-footer"><img src="/brand/openaec-symbol-transparent.svg" alt=""/><span>Own your tools.<small>OpenAEC Foundation</small></span></footer>
      </aside>}
    </div>
    <footer className="statusbar"><span className="status-dot"/><span title={t(draftStatus)}>{t(draftStatus)}</span><span className="status-divider"/><span>{Math.max(0, position.x)}, {Math.max(0, position.y)} px</span><span className="status-spacer"/><span>{t(tool)}</span><span className="status-divider"/><button onClick={fit} title={t('fit')} aria-label={t('fit')}><Scan size={14}/></button><button onClick={() => safeZoom(zoom - 10)} aria-label="Zoom out">−</button><input type="range" aria-label={t('zoom')} min="10" max="400" value={zoom} onChange={e => setZoom(+e.target.value)}/><button onClick={() => safeZoom(zoom + 10)} aria-label="Zoom in">+</button><button className="zoom-number" onClick={() => setZoom(100)}>{zoom}%</button></footer>
    {busy&&<div className="processing-indicator" role="status"><span/>{t('processing')}</div>}
    {toast && <div role="status" className="toast">{toast}<button onClick={() => setToast('')} aria-label="Dismiss">×</button></div>}
    <Dialog title={t('new')} open={modal === 'new'} close={() => setModal('')}><form onSubmit={e => { e.preventDefault(); try { if (doc.operations.length && !window.confirm(t('replaceConfirm'))) return; commit({ ...newDocument(newWidth, newHeight, newName), background: newBackground }); setRemote(null); setModal(''); } catch (error) { fail(error); } }}><label>{t('name')}<input required maxLength={120} value={newName} onChange={e => setNewName(e.target.value)}/></label><div className="form-row"><label>{t('width')}<input required type="number" min="1" max="4096" value={newWidth} onChange={e => setNewWidth(+e.target.value)}/></label><label>{t('height')}<input required type="number" min="1" max="4096" value={newHeight} onChange={e => setNewHeight(+e.target.value)}/></label></div><div className="presets">{[[1200, 800], [1920, 1080], [1024, 1024], [800, 600]].map(([w, h]) => <button type="button" key={w} onClick={() => { setNewWidth(w); setNewHeight(h); }}>{w} × {h}</button>)}</div><label>{t('background')}<select value={newBackground} onChange={e => setNewBackground(e.target.value)}><option value="#ffffff">{t('white')}</option><option value="transparent">{t('transparent')}</option></select></label><button className="primary" type="submit">{t('create')}</button></form></Dialog>
    <Dialog title={t('resize')} open={modal === 'resize'} close={() => setModal('')}><form onSubmit={e => { e.preventDefault(); void transform('resize'); }}><div className="form-row"><label>{t('width')}<input required type="number" min="1" max="4096" value={newWidth} onChange={e => setNewWidth(+e.target.value)}/></label><label>{t('height')}<input required type="number" min="1" max="4096" value={newHeight} onChange={e => setNewHeight(+e.target.value)}/></label></div><button className="primary" type="submit">{t('apply')}</button></form></Dialog>
    <Dialog title={t('adjustments')} open={modal==='adjust'} close={()=>setModal('')}><p>{t('vectorHint')}</p>{(['brightness','contrast','saturation'] as const).map(key=><label key={key}>{t(key==='contrast'?'contrastValue':key)} <span>{corrections[key]}</span><input type="range" min={key==='saturation'?0:-100} max={key==='saturation'?200:100} value={corrections[key]} onChange={e=>setCorrections(value=>({...value,[key]:+e.target.value}))}/></label>)}<button className="primary" onClick={()=>void filterImage('adjust')}>{t('apply')}</button></Dialog>
    <Dialog title={t('settings')} open={modal === 'settings'} close={() => setModal('')}><label>{t('theme')}<select aria-label={t('theme')} value={theme} onChange={e => setTheme(e.target.value)}>{(['light', 'forge', 'openaec', 'blueprint', 'contrast'] as const).map(id => <option key={id} value={id}>{t(id)}</option>)}</select></label><label>{t('language')}<select aria-label={t('language')} value={language} onChange={e => setLanguage(e.target.value as 'en' | 'nl')}><option value="nl">Nederlands</option><option value="en">English</option></select></label><h3>{t('shortcuts')}</h3><p>{t('help')}</p><p>Ctrl+S · Ctrl+O · Ctrl+Z · Ctrl+Shift+Z<br/>Shift: 45° / 1:1 · [ / ]: {t('size')}</p><div className="about-note"><strong>OpenAEC Paint Studio · {releaseVersion}</strong><p>{t('about')}</p><a href="https://github.com/OpenAEC-Foundation/OpenAEC-style-book" target="_blank" rel="noreferrer">OpenAEC style book · CC BY-SA 4.0</a></div></Dialog>
    <Dialog title="API · MCP" open={modal === 'api'} close={() => setModal('')}><p>{t('apiHint')}</p><code>{apiBase}</code><label>{t('token')}<input type="password" autoComplete="off" value={token} onChange={e => { setToken(e.target.value); setRemote(null); }}/></label><div className="form-row"><button className="wide-button" disabled={apiBusy || !token} onClick={() => void apiAction('list')}>{t('connect')}</button><button className="primary" disabled={apiBusy || !token} onClick={() => void apiAction('push')}>{t('push')}</button></div><label>{t('documentId')}<input value={remoteId} onChange={e => setRemoteId(e.target.value)}/></label>{remoteList.length > 0 && <select aria-label={t('project')} onChange={e => setRemoteId(e.target.value)} value={remoteId}><option value="">—</option>{remoteList.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select>}<button className="wide-button" disabled={apiBusy || !token || !remoteId} onClick={() => void apiAction('pull')}>{t('pull')}</button>{remote && <small>{remote.id} · revision {remote.revision}</small>}</Dialog>
  </div>;
}
