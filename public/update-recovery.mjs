const windowKey = "remote-codex-window-id";
const storage = window.chrome?.webview || document.querySelector('meta[name="bridge-platform"]')?.content === "android" ? localStorage : sessionStorage;
export const windowId = storage.getItem(windowKey) || crypto.randomUUID();
storage.setItem(windowKey, windowId);
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("remote-codex-update-recovery", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("windows");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("windows", mode),
        request = operation(tx.objectStore("windows"));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
// Serialize snapshots in invocation order; a slow older IDB open must not
// overwrite a later clear. Clone now, before mutable composer objects change.
let writes = Promise.resolve();
const write = operation => {
  const result = writes.catch(() => {}).then(() => transaction("readwrite", operation));
  writes = result;
  return result;
};
export const saveRecovery = data => {
  const snapshot = structuredClone(data);
  return write(store => store.put(snapshot, windowId));
};
export const readRecovery = () => writes.catch(() => {}).then(() => transaction("readonly", store => store.get(windowId)));
export const clearRecovery = () => write(store => store.delete(windowId));
