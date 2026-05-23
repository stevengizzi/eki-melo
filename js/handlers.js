/* =================================================================
   HANDLERS — orchestration layer

   Wires user actions to storage, the synth, and the two generation
   APIs, re-rendering after each mutation. main.js attaches these to
   DOM events.
   ================================================================= */
import { guests, setGuests, saveGuests, migrateGuest } from './storage.js';
import { render, showError, hideError, toast } from './ui.js';
import { synth, renderJingleToWav } from './jingle/synth.js';
import { buildMidiFile } from './jingle/midi-writer.js';
import { generateJingle, DEFAULT_ENGINE, otherEngine, engineLabel } from './jingle/engines.js';
import { generateAvatar } from './avatar/api.js';
import {
  buildLiveDiagnostic,
  reconstructDiagnostic,
  serializeDiagnostic,
  validateDiagnostic,
} from './jingle/diagnostics.js';
import {
  loadDiagnostic,
  saveDiagnostic,
  exportAllDiagnostics,
} from './storage-diagnostics.js';

const GENERATE_LABEL = '► COMPOSE THEME & AVATAR';

// The engine the Add-Guest form currently selects (radio group), defaulting to
// the pipeline if the control is somehow absent.
function selectedEngine() {
  const checked = document.querySelector('input[name="engine"]:checked');
  return checked ? checked.value : DEFAULT_ENGINE;
}

// A successful avatar held across a jingle-engine RETRY so we don't re-spend the
// PixelLab call when only the jingle engine is being swapped. Cleared once a guest
// is saved (or a fresh, non-retry generation starts).
let heldAvatarResult = null;

function setGenerating(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  if (on) btn.innerHTML = 'COMPOSING<span class="loading"></span>';
  else btn.textContent = GENERATE_LABEL;
}

// Render the "retry with the other engine" affordance. The button regenerates
// with the OTHER engine (preserving the user's deliberate first choice — no
// auto-fallback). Recreated each time, so no stale listener accumulates.
function showRetry(failedEngine) {
  const el = document.getElementById('form-retry');
  if (!el) return;
  const other = otherEngine(failedEngine);
  el.innerHTML = `<button class="btn btn-secondary btn-small" id="retry-other-btn">↻ RETRY WITH ${engineLabel(other).toUpperCase()}</button>`;
  el.style.display = 'block';
  const btn = document.getElementById('retry-other-btn');
  if (btn) btn.addEventListener('click', () => runGenerate(other));
}

function hideRetry() {
  const el = document.getElementById('form-retry');
  if (!el) return;
  el.innerHTML = '';
  el.style.display = 'none';
}

// Click handler on the Generate button — composes with the selected engine.
export function handleGenerate() {
  heldAvatarResult = null; // a fresh top-level generate is not a retry.
  return runGenerate(selectedEngine());
}

// The core generate flow, parameterized by engine so the retry button can re-run
// it with the other engine. On a retry a previously-successful avatar is reused.
async function runGenerate(engine) {
  const nameEl = document.getElementById('guest-name');
  const descEl = document.getElementById('guest-desc');
  const btn = document.getElementById('generate-btn');
  hideError();
  hideRetry();

  const name = nameEl.value.trim();
  const description = descEl.value.trim();
  if (!name) return showError('Please enter a name.');
  if (!description) return showError('Describe their vibe — even a sentence works.');

  synth.init();
  setGenerating(btn, true);

  // Reuse a held avatar across an engine retry; otherwise generate one alongside.
  const avatarPromise = heldAvatarResult
    ? Promise.resolve(heldAvatarResult)
    : generateAvatar(name, description);
  // Capture the live diagnostic emitted at the end of generation (secondary to the
  // jingle; persisted below before saveGuests so the diagnosticsRef rides along).
  let liveCapture = null;
  const [jingleResult, avatarResult] = await Promise.allSettled([
    generateJingle({ guestName: name, mood: description, engine, options: { onDiagnostic: (c) => { liveCapture = c; } } }),
    avatarPromise
  ]);

  setGenerating(btn, false);

  if (jingleResult.status === 'rejected') {
    // Hold a good avatar so the retry-with-other-engine doesn't redo it.
    heldAvatarResult = avatarResult.status === 'fulfilled' ? avatarResult.value : null;
    showError(`Couldn't compose the ${engineLabel(engine)} jingle: ${jingleResult.reason?.message || 'unknown'}`);
    showRetry(engine);
    return;
  }

  heldAvatarResult = null;
  const guest = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    name,
    description,
    jingles: [jingleResult.value],
    currentJingleIndex: 0,
    avatars: avatarResult.status === 'fulfilled' ? [avatarResult.value] : [],
    currentAvatarIndex: 0
  };
  guests.unshift(guest);
  await captureLiveDiagnostic(jingleResult.value, { engine, guestName: name, mood: description, capture: liveCapture });
  await saveGuests();

  if (avatarResult.status === 'rejected') {
    showError(`Jingle saved, but avatar failed: ${avatarResult.reason?.message || 'unknown'}. Try "↻ NEW AVATAR".`);
  } else {
    nameEl.value = '';
    descEl.value = '';
  }

  render();
  setTimeout(() => synth.play(jingleResult.value, guest.id), 200);
}

async function handleRerollJingle(id) {
  const guest = guests.find(g => g.id === id);
  if (!guest) return;
  const card = document.querySelector(`.guest-card[data-id="${id}"]`);
  const btn = card?.querySelector('[data-act="rerollJingle"]');
  if (btn) { btn.disabled = true; btn.innerHTML = 'REROLLING<span class="loading"></span>'; }

  // Reroll honors the form's current engine selection (a guest can hold a mix of
  // v1 and pipeline takes; each carries its own engine tag).
  const engine = selectedEngine();
  let liveCapture = null;
  try {
    const jingle = await generateJingle({
      guestName: guest.name,
      mood: guest.description,
      engine,
      options: { onDiagnostic: (c) => { liveCapture = c; } },
    });
    guest.jingles.push(jingle);
    guest.currentJingleIndex = guest.jingles.length - 1;
    await captureLiveDiagnostic(jingle, { engine, guestName: guest.name, mood: guest.description, capture: liveCapture });
    await saveGuests();
    render();
    setTimeout(() => synth.play(jingle, id), 150);
  } catch (e) {
    showError(`Reroll (${engineLabel(engine)}) failed: ${e.message}`);
    if (btn) { btn.disabled = false; btn.innerHTML = '↻ NEW JINGLE'; }
  }
}

async function handleRerollAvatar(id) {
  const guest = guests.find(g => g.id === id);
  if (!guest) return;
  const card = document.querySelector(`.guest-card[data-id="${id}"]`);
  const wrap = card?.querySelector('.avatar-wrap');
  const btn = card?.querySelector('[data-act="rerollAvatar"]');
  if (wrap) wrap.classList.add('loading');
  if (btn) { btn.disabled = true; btn.innerHTML = 'PIXELING<span class="loading"></span>'; }

  try {
    const avatar = await generateAvatar(guest.name, guest.description);
    guest.avatars.push(avatar);
    guest.currentAvatarIndex = guest.avatars.length - 1;
    await saveGuests();
    render();
  } catch (e) {
    showError(`Avatar reroll failed: ${e.message}`);
    if (wrap) wrap.classList.remove('loading');
    if (btn) { btn.disabled = false; btn.innerHTML = '↻ NEW AVATAR'; }
  }
}

async function handleDelete(id) {
  if (synth.currentId === id) synth.stop();
  setGuests(guests.filter(g => g.id !== id));
  await saveGuests();
  render();
}

function handlePrevJingle(id) {
  const g = guests.find(g => g.id === id);
  if (g && g.currentJingleIndex > 0) { g.currentJingleIndex--; saveGuests(); render(); }
}
function handleNextJingle(id) {
  const g = guests.find(g => g.id === id);
  if (g && g.currentJingleIndex < g.jingles.length - 1) { g.currentJingleIndex++; saveGuests(); render(); }
}
function handlePrevAvatar(id) {
  const g = guests.find(g => g.id === id);
  if (g && g.currentAvatarIndex > 0) { g.currentAvatarIndex--; saveGuests(); render(); }
}
function handleNextAvatar(id) {
  const g = guests.find(g => g.id === id);
  if (g && g.currentAvatarIndex < g.avatars.length - 1) { g.currentAvatarIndex++; saveGuests(); render(); }
}

function sanitizeFilename(s) {
  return String(s).replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '_').slice(0, 60) || 'untitled';
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

async function handleDownloadWav(id) {
  const guest = guests.find(g => g.id === id);
  if (!guest) return;
  const jingle = guest.jingles[guest.currentJingleIndex];
  const btn = document.querySelector(`.guest-card[data-id="${id}"] [data-act="downloadWav"]`);
  if (btn) { btn.disabled = true; btn.innerHTML = 'RENDERING<span class="loading"></span>'; }
  try {
    const blob = await renderJingleToWav(jingle);
    const fname = `${sanitizeFilename(guest.name)}-${sanitizeFilename(jingle.title)}.wav`;
    triggerDownload(blob, fname);
    toast('WAV DOWNLOADED ♪');
  } catch (e) {
    showError(`WAV render failed: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'WAV (audio)'; }
  }
}

// Download the guest's CURRENT jingle as a Standard MIDI File (Session 15).
// Synchronous build (no audio render, unlike WAV), so no spinner — just build
// the bytes, trigger the .mid download, and toast. Any build error surfaces as
// an inline error rather than a silent no-op.
function handleDownloadMidi(id) {
  const guest = guests.find(g => g.id === id);
  if (!guest) return;
  const jingle = guest.jingles[guest.currentJingleIndex];
  if (!jingle) return;
  try {
    const bytes = buildMidiFile(jingle);
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const fname = `${sanitizeFilename(guest.name)}-${sanitizeFilename(jingle.title)}.mid`;
    triggerDownload(blob, fname);
    toast('MIDI DOWNLOADED ♪');
  } catch (e) {
    showError(`MIDI build failed: ${e.message}`);
  }
}

// =================================================================
// DIAGNOSTIC DOWNLOAD (Session 14) — the JSON "how this jingle was made" export.
// =================================================================

// A short opaque id for a diagnostic bundle. It IS the jingle's diagnosticsRef
// (one bundle per jingle); the sidecar is keyed by it.
function makeDiagnosticId() {
  return 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Reconstructing an old jingle's bundle is cheap to cache so a repeat download is
// O(1). On by default; a future settings panel could expose an opt-out (out of
// scope this session, so the flag is hardcoded ON).
const CACHE_RECONSTRUCTED_DIAGNOSTICS = true;

// Serialize a bundle and trigger its download. No toast — the caller picks the
// message (a cached hit vs. a fresh reconstruction read differently).
function downloadDiagnostic(guest, jingle, bundle) {
  const blob = new Blob([serializeDiagnostic(bundle)], { type: 'application/json' });
  const fname = `${sanitizeFilename(guest.name)}-${sanitizeFilename(jingle.title)}-diagnostic.json`;
  triggerDownload(blob, fname);
}

// Persist a freshly-reconstructed bundle to the sidecar + set the jingle's
// diagnosticsRef so the next download is O(1). Fire-and-forget; never throws.
async function cacheReconstructedDiagnostic(jingle, bundle) {
  if (!CACHE_RECONSTRUCTED_DIAGNOSTICS) return;
  try {
    const ref = jingle.diagnosticsRef || makeDiagnosticId();
    await saveDiagnostic(ref, bundle);
    jingle.diagnosticsRef = ref;
    await saveGuests();
    toast('diagnostic reconstructed + cached');
  } catch (e) {
    console.warn('[diagnostics] caching reconstructed bundle failed (non-fatal):', e);
  }
}

// Build + persist a LIVE diagnostic for a freshly-generated jingle, setting its
// diagnosticsRef. SECONDARY to the jingle: any failure is logged, never thrown —
// the jingle is the product (so a diagnostic bug can't break generation).
async function captureLiveDiagnostic(jingle, { engine, guestName, mood, capture }) {
  try {
    const bundle = buildLiveDiagnostic({ engine, input: { guestName, mood }, output: jingle, captures: capture ?? {} });
    const result = validateDiagnostic(bundle);
    if (!result.ok) {
      console.warn('[diagnostics] live bundle failed self-validation; not persisting:', result.errors);
      return;
    }
    const ref = makeDiagnosticId();
    await saveDiagnostic(ref, bundle);
    jingle.diagnosticsRef = ref;
  } catch (e) {
    console.warn('[diagnostics] live capture failed (non-fatal):', e);
  }
}

// Download the JSON diagnostic for a guest's CURRENT jingle. Fast path: a cached
// sidecar bundle. Slow path: reconstruct from stored data, download immediately,
// then cache in the background. A reconstruction that fails (or comes out
// malformed) errors out rather than downloading a file we can't trust.
async function handleDownloadJson(id) {
  const guest = guests.find(g => g.id === id);
  if (!guest) return;
  const jingle = guest.jingles[guest.currentJingleIndex];
  if (!jingle) return;

  // 1/2. Cached in the sidecar? Serialize + download.
  if (jingle.diagnosticsRef) {
    const cached = await loadDiagnostic(jingle.diagnosticsRef);
    if (cached) {
      downloadDiagnostic(guest, jingle, cached);
      toast('JSON DIAGNOSTIC SAVED ♪');
      return;
    }
    // Dangling ref (sidecar cleared / different device) — fall through to reconstruct.
  }

  // 3. Reconstruct from stored data.
  let bundle;
  try {
    bundle = await reconstructDiagnostic({ guest, jingle });
  } catch (e) {
    console.error('[diagnostics] reconstruction failed:', e);
    showError(`Couldn't build the diagnostic for "${jingle.title}": ${e.message}`);
    return;
  }
  const result = validateDiagnostic(bundle);
  if (!result.ok) {
    console.error('[diagnostics] reconstructed bundle is invalid:', result.errors);
    showError(`The diagnostic for "${jingle.title}" came out malformed — not downloading a file I can't trust.`);
    return;
  }
  // Download immediately (don't make the user wait twice), then cache in the bg.
  downloadDiagnostic(guest, jingle, bundle);
  cacheReconstructedDiagnostic(jingle, bundle);
}

// =================================================================
// DOWNLOAD DROPDOWN — open/close + outside-click + Escape + arrow-key nav.
// =================================================================

function closeAllDownloadMenus() {
  document.querySelectorAll('.download-menu').forEach((menu) => {
    const panel = menu.querySelector('.download-options');
    const toggle = menu.querySelector('.download-toggle');
    if (panel) panel.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  });
}

function toggleDownloadMenu(toggleBtn) {
  const menu = toggleBtn.closest('.download-menu');
  if (!menu) return;
  const panel = menu.querySelector('.download-options');
  const wasOpen = panel && !panel.hidden;
  closeAllDownloadMenus();
  if (!wasOpen && panel) {
    panel.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
    const first = panel.querySelector('button:not([disabled])');
    if (first) first.focus();
  }
}

/**
 * Attach the document-level dismiss + keyboard handlers for the download menus.
 * Called once from main.js. Outside clicks land on document AFTER the delegated
 * guest-list handler (which owns the toggle), so a click inside a .download-menu
 * is left alone here and everything else closes the menus.
 */
export function initDownloadMenus() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.download-menu')) closeAllDownloadMenus();
  });
  document.addEventListener('keydown', (e) => {
    const openPanel = document.querySelector('.download-options:not([hidden])');
    if (!openPanel) return;
    if (e.key === 'Escape') {
      const toggle = openPanel.closest('.download-menu')?.querySelector('.download-toggle');
      closeAllDownloadMenus();
      if (toggle) toggle.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...openPanel.querySelectorAll('button:not([disabled])')];
      if (items.length === 0) return;
      const here = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown'
        ? items[(here + 1) % items.length]
        : items[(here - 1 + items.length) % items.length];
      next.focus();
    }
  });
}

export async function handleExportBackup() {
  // Pull every saved diagnostic bundle so the backup is self-contained: a restore
  // re-attaches them to the jingles' diagnosticsRefs. (Session 14 — version 3.)
  let diagnostics = {};
  try {
    diagnostics = await exportAllDiagnostics();
  } catch (e) {
    console.warn('[diagnostics] could not read the sidecar for backup (exporting guests only):', e);
  }
  const payload = {
    type: 'eki_greetings_backup',
    version: 3,
    exportedAt: new Date().toISOString(),
    guests,
    diagnostics
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  triggerDownload(blob, `eki-greetings-backup-${stamp}.json`);
  const dCount = Object.keys(diagnostics).length;
  toast(`BACKUP SAVED (${guests.length} GUESTS${dCount ? `, ${dCount} DIAGNOSTICS` : ''}) ♪`);
}

export function handleImportClick() {
  document.getElementById('import-file').click();
}

export async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.guests)) throw new Error('Invalid backup file');

    const incoming = data.guests.map(migrateGuest);
    if (guests.length === 0) {
      setGuests(incoming);
    } else {
      const map = new Map(guests.map(g => [g.id, g]));
      incoming.forEach(g => map.set(g.id, g));
      setGuests(Array.from(map.values()));
    }
    await saveGuests();

    // Diagnostics are OPTIONAL in a backup (pre-Session-14 files lack the key —
    // those still import fine, with an empty sidecar; re-downloading a JSON for
    // such a guest reconstructs on demand). When present, validate each bundle and
    // save only the valid ones; a corrupt bundle is skipped with a console warning
    // rather than silently stored.
    let importedDiagnostics = 0;
    if (data.diagnostics && typeof data.diagnostics === 'object' && !Array.isArray(data.diagnostics)) {
      for (const [ref, bundle] of Object.entries(data.diagnostics)) {
        const result = validateDiagnostic(bundle);
        if (result.ok) {
          await saveDiagnostic(ref, bundle);
          importedDiagnostics++;
        } else {
          console.warn(`[diagnostics] skipped invalid bundle "${ref}" on import:`, result.errors);
        }
      }
    }

    render();
    toast(`IMPORTED ${incoming.length} GUESTS${importedDiagnostics ? ` + ${importedDiagnostics} DIAGNOSTICS` : ''} ♪`);
  } catch (err) {
    showError(`Import failed: ${err.message}`);
  } finally {
    e.target.value = '';
  }
}

// Delegated click handler for the guest list: maps each button's data-act to
// its handler. synth.play is called inline since it needs no orchestration.
export function handleGuestListClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  const guest = guests.find(g => g.id === id);
  if (!guest) return;
  switch (act) {
    case 'play':           synth.play(guest.jingles[guest.currentJingleIndex], id); break;
    case 'rerollJingle':   handleRerollJingle(id); break;
    case 'rerollAvatar':   handleRerollAvatar(id); break;
    case 'downloadToggle': toggleDownloadMenu(btn); break;
    case 'downloadWav':    closeAllDownloadMenus(); handleDownloadWav(id); break;
    case 'downloadJson':   closeAllDownloadMenus(); handleDownloadJson(id); break;
    case 'downloadMidi':   closeAllDownloadMenus(); handleDownloadMidi(id); break;
    case 'delete':         handleDelete(id); break;
    case 'prevJingle':     handlePrevJingle(id); break;
    case 'nextJingle':     handleNextJingle(id); break;
    case 'prevAvatar':     handlePrevAvatar(id); break;
    case 'nextAvatar':     handleNextAvatar(id); break;
  }
}
