import type { ComponentType, ReactNode } from 'react';
import { ArrowLeft, FileImage } from 'lucide-react';

// The File screen as the OpenAEC Blueprint draws it (openaec-ui design::tiles
// file_nav_row, task_tile and icon_tile; ui04's backstage_view): Back first,
// then a 260 px column of 40 px rows with a 16 px icon, the active one with a
// 3 px bar and the selection tint, and beside it the chosen page's heading
// and task tiles (a 40 px icon tile, title and description) in a column of at
// most 620 px. Under the Open page's tiles the files opened last
// (design::tiles recent_files): one frame of 40 px rows with a line between
// them, each an 18 px icon, the name, a detail that takes the room left and
// the date in the monospace face.
export type BackstagePage = 'new' | 'open' | 'save' | 'export' | 'formats' | 'about';

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;

export type BackstageEntry = { page?: BackstagePage; label: string; icon: Icon; onClick?: () => void };

export type BackstageTile = { title: string; detail: string; icon: Icon; onClick?: () => void };

export type BackstageRecentFile = { key: string; name: string; detail: string; date: string; onClick: () => void };

export function Backstage({ page, groups, onPage, heading, lead, children, back }: {
  page: BackstagePage;
  groups: BackstageEntry[][];
  onPage: (page: BackstagePage) => void;
  heading: string;
  lead: string;
  children: ReactNode;
  back: [string, () => void];
}) {
  const row = (entry: BackstageEntry) => {
    const active = entry.page === page;
    const Glyph = entry.icon;
    return <button key={entry.label} className={`${entry.page ? 'backstage-page' : 'backstage-item'} ${active ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined} onClick={entry.page ? () => onPage(entry.page!) : entry.onClick}>
      <Glyph size={16} strokeWidth={1.75}/><span>{entry.label}</span>
    </button>;
  };
  return <div className="file-page">
    <nav className="backstage-nav" aria-label={heading}>
      <button className="backstage-back" onClick={back[1]}><ArrowLeft size={16} strokeWidth={1.75}/><span>{back[0]}</span></button>
      {groups.map((group, index) => <div key={index} className="backstage-group">{group.map(row)}</div>)}
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
      {tiles.map(tile => {
        const Glyph = tile.icon;
        return <button key={tile.title} className="backstage-tile" disabled={!tile.onClick} onClick={tile.onClick}>
          <span className="backstage-tile-icon"><Glyph size={22} strokeWidth={1.75}/></span>
          <span className="backstage-tile-text"><strong>{tile.title}</strong><span>{tile.detail}</span></span>
        </button>;
      })}
    </div>
  </>;
}

export function BackstageRecent({ caption, empty, files }: { caption: string; empty: string; files: BackstageRecentFile[] }) {
  return <>
    <div className="backstage-caption">{caption}</div>
    {files.length ? <div className="backstage-recent">
      {files.map(file => <button key={file.key} className="backstage-recent-row" onClick={file.onClick}>
        <FileImage size={18} strokeWidth={1.75}/><strong>{file.name}</strong><span>{file.detail}</span><time>{file.date}</time>
      </button>)}
    </div> : <p className="backstage-recent-empty">{empty}</p>}
  </>;
}
