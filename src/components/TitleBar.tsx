import { Minus, Square, X, Undo2, Redo2, Save, Settings } from 'lucide-react';
import { isDesktop } from '../storage';
import { releaseVersion } from '../version';
export default function TitleBar({ name, save, undo, redo, settings, canUndo, canRedo }: { name: string; save: () => void; undo: () => void; redo: () => void; settings: () => void; canUndo: boolean; canRedo: boolean }) {
  async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow()[action]();
  }
  return <header className="titlebar">
    <div className="brand"><img src="/app-icon.svg" alt="Open Paint Studio"/><span>Open<span className="brand-aec">AEC</span> <b>Paint Studio</b></span></div>
    <span className="titlebar-separator"/>
    <button onClick={save} title="Save (Ctrl+S)" aria-label="Save"><Save size={16}/></button>
    <button onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo}><Undo2 size={16}/></button>
    <button onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo}><Redo2 size={16}/></button>
    <div className="titlebar-drag" data-tauri-drag-region>{name}</div>
    <span className="version">{releaseVersion}</span><button onClick={settings} title="Settings" aria-label="Settings"><Settings size={16}/></button>
    {isDesktop() && <div className="window-controls"><button aria-label="Minimize" onClick={() => void windowAction('minimize')}><Minus size={14}/></button><button aria-label="Maximize" onClick={() => void windowAction('toggleMaximize')}><Square size={12}/></button><button aria-label="Close window" onClick={() => void windowAction('close')}><X size={16}/></button></div>}
  </header>;
}
