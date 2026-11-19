/*
 * Passing a picture from one tool to another (an image tool's result → the Pro photo editor)
 * without uploading it anywhere: it's parked in this browser's IndexedDB, the next page picks it up
 * once and deletes it.
 */

const DB = "dwyl-handoff";
const STORE = "items";
export const PRO_EDITOR_HREF = "/tools/pro-photo-editor";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** Parks the picture for the Pro editor and returns where to go (the caller navigates with its router). */
export async function handOffToProEditor(blob: Blob, name: string): Promise<string> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ blob, name, at: Date.now() }, "pro-editor");
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return `${PRO_EDITOR_HREF}?open=handoff`;
  } catch {
    return PRO_EDITOR_HREF;
  }
}

/** Takes the parked picture (once). Anything older than ten minutes is ignored. */
export async function takeHandoff(): Promise<{ blob: Blob; name: string } | null> {
  try {
    const db = await open();
    const item = await new Promise<{ blob: Blob; name: string; at: number } | undefined>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const r = store.get("pro-editor");
      r.onsuccess = () => {
        store.delete("pro-editor");
        res(r.result);
      };
      r.onerror = () => rej(r.error);
    });
    db.close();
    return item && Date.now() - item.at < 10 * 60_000 ? { blob: item.blob, name: item.name } : null;
  } catch {
    return null;
  }
}
