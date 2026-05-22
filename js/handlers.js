/* =================================================================
   HANDLERS — orchestration layer

   Wires user actions to storage, the synth, and the two generation
   APIs, re-rendering after each mutation. main.js attaches these to
   DOM events.
   ================================================================= */
import { guests, setGuests, saveGuests, migrateGuest } from './storage.js';
import { render, showError, hideError, toast } from './ui.js';
import { synth, renderJingleToWav } from './jingle/synth.js';
import { generateJingle, DEFAULT_ENGINE, otherEngine, engineLabel } from './jingle/engines.js';
import { generateAvatar } from './avatar/api.js';

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
  const [jingleResult, avatarResult] = await Promise.allSettled([
    generateJingle({ guestName: name, mood: description, engine }),
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
  try {
    const jingle = await generateJingle({ guestName: guest.name, mood: guest.description, engine });
    guest.jingles.push(jingle);
    guest.currentJingleIndex = guest.jingles.length - 1;
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
    if (btn) { btn.disabled = false; btn.innerHTML = '↓ WAV'; }
  }
}

export function handleExportBackup() {
  const payload = {
    type: 'eki_greetings_backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    guests
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  triggerDownload(blob, `eki-greetings-backup-${stamp}.json`);
  toast(`BACKUP SAVED (${guests.length} GUESTS) ♪`);
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
    render();
    toast(`IMPORTED ${incoming.length} GUESTS ♪`);
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
    case 'downloadWav':    handleDownloadWav(id); break;
    case 'delete':         handleDelete(id); break;
    case 'prevJingle':     handlePrevJingle(id); break;
    case 'nextJingle':     handleNextJingle(id); break;
    case 'prevAvatar':     handlePrevAvatar(id); break;
    case 'nextAvatar':     handleNextAvatar(id); break;
  }
}
