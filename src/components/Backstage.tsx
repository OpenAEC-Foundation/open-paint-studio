import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

// The File page as the OpenAEC Blueprint defines it (openaec-ui widgets.rs,
// backstage_nav_with and backstage_task_tile_with): a 260 px column of 40 px
// pages with the active one marked, Settings, Return and Exit at the foot,
// and the chosen page's heading and action tiles beside it.
export type BackstagePage = 'new' | 'open' | 'save' | 'export' | 'formats' | 'about';

export type BackstageTile = { title: string; detail: string; onClick?: () => void };

export function Backstage({ page, pages, onPage, heading, lead, children, settings, back, exit }: {
  page: BackstagePage;
  pages: { task: [BackstagePage, string][]; other: [BackstagePage, string][] };
  onPage: (page: BackstagePage) => void;
  heading: string;
  lead: string;
  children: ReactNode;
  settings: [string, () => void];
  back: [string, () => void];
  exit: [string, () => void] | null;
}) {
  const entry = ([id, label]: [BackstagePage, string]) =>
    <button key={id} className={`backstage-page ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => onPage(id)}>{label}</button>;
  return <div className="file-page">
    <nav className="backstage-nav" aria-label={heading}>
      <div className="backstage-pages">
        {pages.task.map(entry)}
        <div className="backstage-rule"/>
        {pages.other.map(entry)}
      </div>
      <div className="backstage-footer">
        <div className="backstage-rule"/>
        <button className="backstage-item" onClick={settings[1]}>{settings[0]}</button>
        <button className="backstage-back" onClick={back[1]}><ArrowLeft size={14}/>{back[0]}</button>
        {exit && <><div className="backstage-rule"/><button className="backstage-item" onClick={exit[1]}>{exit[0]}</button></>}
      </div>
    </nav>
    <section className="backstage-content">
      <h2>{heading}</h2>
      <p className="backstage-lead">{lead}</p>
      {children}
    </section>
  </div>;
}

export function BackstageTiles({ tiles, caption }: { tiles: BackstageTile[]; caption?: string }) {
  return <>
    {caption && <div className="backstage-caption">{caption}</div>}
    <div className="backstage-tiles">
      {tiles.map(tile => <button key={tile.title} className="backstage-tile" disabled={!tile.onClick} onClick={tile.onClick}>
        <strong>{tile.title}</strong><span>{tile.detail}</span>
      </button>)}
    </div>
  </>;
}
