const windowKey = "remote-codex-window-id";
export const windowId =
  sessionStorage.getItem(windowKey) || crypto.randomUUID();
sessionStorage.setItem(windowKey, windowId);
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
export const saveRecovery = (data) =>
  transaction("readwrite", (store) => store.put(data, windowId));
export const readRecovery = () =>
  transaction("readonly", (store) => store.get(windowId));
export const clearRecovery = () =>
  transaction("readwrite", (store) => store.delete(windowId));
