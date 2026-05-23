/* =================================================================
   DIAGNOSTICS SIDECAR STORAGE (Session 14).

   A diagnostic bundle (js/jingle/diagnostics.js) is bulky — full prompts, every
   stage's artifact, the realized tracks — and only a few guests are ever inspected
   at a time. Storing it INLINE on each jingle would bloat the main guest store
   (read+rewritten on every guest mutation: play, page, reroll, delete). So bundles
   live in a SEPARATE namespace, keyed by jingle id, loaded only when a download
   asks for one. The jingle's stored record carries just a lightweight
   `diagnosticsRef: <jingleId>` pointer (set when a bundle is saved).

   ONE BUNDLE PER JINGLE. The ref IS the jingle's own id — there is no separate
   diagnostic id. A jingle has at most one bundle.

   SHAPE. The store is a single JSON object `{ [jingleId]: bundle }` under
   DIAGNOSTICS_STORAGE_KEY, read/written through the same env.js storageBackend the
   main guest store uses (so it works in both runtime contexts). The whole map is
   read-modify-written on each save/delete; the data is small and writes are rare
   (one per generation + the occasional lazy reconstruction cache).

   PORTABILITY / DATA SAFETY. Independent of the main guest store: a failure here
   never touches guest data (DEC-007). A read failure returns null/empty rather
   than throwing — the diagnostic is secondary; the jingle is the product.
   ================================================================= */
import { storageBackend } from './env.js';

export const DIAGNOSTICS_STORAGE_KEY = 'eki_diagnostics_v1';

// Read the whole sidecar map. Returns {} on any failure (missing key, parse error)
// so callers can treat "no diagnostics yet" and "store unreadable" uniformly.
async function readStore() {
  try {
    const value = await storageBackend.get(DIAGNOSTICS_STORAGE_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

async function writeStore(store) {
  await storageBackend.set(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(store));
}

/** Load one jingle's diagnostic bundle, or null if none is stored. */
export async function loadDiagnostic(jingleId) {
  const store = await readStore();
  return Object.prototype.hasOwnProperty.call(store, jingleId) ? store[jingleId] : null;
}

/** Save (or overwrite) one jingle's diagnostic bundle. */
export async function saveDiagnostic(jingleId, bundle) {
  const store = await readStore();
  store[jingleId] = bundle;
  await writeStore(store);
}

/** Remove one jingle's diagnostic bundle (no-op if absent). */
export async function deleteDiagnostic(jingleId) {
  const store = await readStore();
  if (Object.prototype.hasOwnProperty.call(store, jingleId)) {
    delete store[jingleId];
    await writeStore(store);
  }
}

/** Every jingle id that has a stored bundle. */
export async function listDiagnosticIds() {
  return Object.keys(await readStore());
}

/** Drop the entire sidecar (used by tooling / a full reset; never by normal flow). */
export async function clearAllDiagnostics() {
  await writeStore({});
}

/** The whole sidecar map { [jingleId]: bundle } — for the backup export. */
export async function exportAllDiagnostics() {
  return readStore();
}
