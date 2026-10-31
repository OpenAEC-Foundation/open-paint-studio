import { useEffect, useRef, useState, type PointerEvent } from 'react';

// The full colour choice behind the colour well: saturation and brightness
// in a field, hue in a bar, and the colour as HEX and as R, G, B.
type Hsv = { h: number; s: number; v: number };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(c => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');
}

function rgbToHsv(r: number, g: number, b: number, previousHue: number): Hsv {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = previousHue;
  if (d) h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max / 255 };
}

function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

export function ColorPicker({ color, onChange, labels }: { color: string; onChange: (hex: string) => void; labels: { hex: string; red: string; green: string; blue: string } }) {
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(...hexToRgb(color), 0));
  const [hexText, setHexText] = useState(color);
  const field = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null);
  // Follow colour changes from elsewhere (swatches, picker tool), keeping the hue of greys.
  useEffect(() => {
    if (rgbToHex(...hsvToRgb(hsv)) !== color.toLowerCase()) setHsv(previous => rgbToHsv(...hexToRgb(color), previous.h));
    setHexText(color);
  }, [color]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = (next: Hsv) => { setHsv(next); onChange(rgbToHex(...hsvToRgb(next))); };
  const drag = (target: 'field' | 'bar') => (event: PointerEvent<HTMLDivElement>) => {
    if (event.type === 'pointerdown') event.currentTarget.setPointerCapture(event.pointerId);
    else if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const box = (target === 'field' ? field : bar).current!.getBoundingClientRect();
    const x = clamp((event.clientX - box.left) / box.width, 0, 1), y = clamp((event.clientY - box.top) / box.height, 0, 1);
    apply(target === 'field' ? { ...hsv, s: x, v: 1 - y } : { ...hsv, h: x * 360 });
  };
  const rgb = hexToRgb(color);
  const setChannel = (index: number, value: string) => {
    const next = [...rgb] as [number, number, number];
    next[index] = clamp(parseInt(value, 10) || 0, 0, 255);
    onChange(rgbToHex(...next));
  };
  return <div className="color-picker">
    <div ref={field} className="color-picker-field" data-control="colorfield" style={{ background: `hsl(${hsv.h} 100% 50%)` }}
      onPointerDown={drag('field')} onPointerMove={drag('field')}>
      <span style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: color }}/>
    </div>
    <div ref={bar} className="color-picker-hue" data-control="colorhue" onPointerDown={drag('bar')} onPointerMove={drag('bar')}>
      <span style={{ left: `${hsv.h / 360 * 100}%` }}/>
    </div>
    <div className="color-picker-values">
      <span className="color-picker-preview" data-control="colorpreview" style={{ background: color }}/>
      <label>{labels.hex}<input value={hexText} maxLength={7} spellCheck={false}
        onChange={e => { setHexText(e.target.value); if (/^#?[0-9a-f]{6}$/i.test(e.target.value)) onChange(rgbToHex(...hexToRgb(e.target.value))); }}/></label>
      {[labels.red, labels.green, labels.blue].map((label, index) =>
        <label key={label}>{label}<input type="number" min="0" max="255" value={rgb[index]} onChange={e => setChannel(index, e.target.value)}/></label>)}
    </div>
  </div>;
}

// The colour well with the picker in a fixed panel below it, closing like the
// ribbon's menus: a click outside, Escape or a resized window.
export function ColorMenu({ color, onChange, title }: { color: string; onChange: (hex: string) => void; title: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = () => { if (details.current) details.current.open = false; };
    const outside = (event: globalThis.PointerEvent) => { if (details.current?.open && !details.current.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', close); };
  }, []);
  return <details ref={details} className="color-menu" onToggle={() => {
    const element = details.current;
    if (!element?.open) return;
    const box = element.querySelector('summary')!.getBoundingClientRect();
    const panel = element.querySelector<HTMLElement>('.color-menu-panel')!;
    panel.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${box.bottom + 8}px`;
  }}>
    <summary className="current-color" style={{ background: color }} title={title} aria-label={title}/>
    <div className="color-menu-panel"><ColorPicker color={color} onChange={onChange} labels={{ hex: 'HEX', red: 'R', green: 'G', blue: 'B' }}/></div>
  </details>;
}
