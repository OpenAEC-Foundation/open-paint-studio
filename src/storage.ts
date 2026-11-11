import type { PaintDocument } from '../shared/document';
import { documentSchema } from '../shared/document';
// Two databases, so that the draft's stays as earlier builds know it: the
// draft in 'openaec-paint', the files opened last in 'openaec-paint-recent'
// (their list in 'recent', each file's bytes apart in 'recentData' so that
// listing reads no images).
function database(name: string, stores: string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => { for (const store of stores) request.result.createObjectStore(store); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function draftStore(value?: PaintDocument): Promise<PaintDocument | undefined> {
  const db = await database('openaec-paint', ['drafts']);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', value ? 'readwrite' : 'readonly');
      const request = value ? tx.objectStore('drafts').put(value, 'current') : tx.objectStore('drafts').get('current');
      tx.oncomplete = () => { try { resolve(value ? value : request.result ? documentSchema.parse(request.result) : undefined); } catch (error) { reject(error); } };
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
// The files opened last, newest first. A browser gives a page no path to
// read a file again, so the list keeps each file's bytes: at most
// recentLimit files and recentBytes in all, the oldest dropped first.
export type RecentFile = { id: string; name: string; size: number; opened: number; type?: string };
const recentLimit = 8, recentBytes = 256_000_000;
async function recentTransaction<T>(mode: IDBTransactionMode, run: (list: IDBObjectStore, data: IDBObjectStore) => IDBRequest | undefined, result: (request?: IDBRequest) => T): Promise<T> {
  const db = await database('openaec-paint-recent', ['recent', 'recentData']);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['recent', 'recentData'], mode);
      const request = run(tx.objectStore('recent'), tx.objectStore('recentData'));
      tx.oncomplete = () => resolve(result(request)); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const newestFirst = (files: RecentFile[]) => files.sort((a, b) => b.opened - a.opened);
export const recentFiles = () => recentTransaction('readonly', list => list.getAll(), request => newestFirst(request!.result as RecentFile[]));
export async function rememberFile(file: File) {
  const entry: RecentFile = { id: `${file.name}|${file.size}`, name: file.name, size: file.size, opened: Date.now(), type: file.type };
  const bytes = await file.arrayBuffer();
  const kept = (await recentFiles()).filter(item => item.id !== entry.id);
  let room = recentBytes - entry.size;
  const dropped = kept.filter((item, index) => index >= recentLimit - 1 || (room -= item.size) < 0);
  await recentTransaction('readwrite', (list, data) => {
    for (const item of dropped) { list.delete(item.id); data.delete(item.id); }
    list.put(entry, entry.id); data.put(bytes, entry.id);
    return undefined;
  }, () => undefined);
}
export const recentFile = (entry: RecentFile) => recentTransaction('readonly', (_, data) => data.get(entry.id), request => request!.result ? new File([request!.result as ArrayBuffer], entry.name, { type: entry.type ?? '' }) : undefined);
export const forgetFile = (entry: RecentFile) => recentTransaction('readwrite', (list, data) => { list.delete(entry.id); data.delete(entry.id); return undefined; }, () => undefined);
export const isDesktop = () => '__TAURI_INTERNALS__' in window;
export async function saveFile(name: string, data: Blob, extension: string) {
  if (isDesktop()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: name, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (!path) return false;
    await writeFile(path, new Uint8Array(await data.arrayBuffer()));
  } else {
    const url = URL.createObjectURL(data), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}
