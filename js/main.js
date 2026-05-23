/* =================================================================
   ENTRY POINT — event-listener wire-up + initial load

   The import graph (not script-tag order) resolves load order. This
   file is loaded as <script type="module">, so it runs after the DOM
   is parsed and getElementById is safe.
   ================================================================= */
import { loadGuests } from './storage.js';
import { render } from './ui.js';
import { synth } from './jingle/synth.js';
import {
  handleGenerate,
  handleExportBackup,
  handleImportClick,
  handleImportFile,
  handleGuestListClick,
  initDownloadMenus
} from './handlers.js';

document.getElementById('generate-btn').addEventListener('click', handleGenerate);
document.getElementById('export-btn').addEventListener('click', handleExportBackup);
document.getElementById('import-btn').addEventListener('click', handleImportClick);
document.getElementById('import-file').addEventListener('change', handleImportFile);
document.getElementById('guest-list').addEventListener('click', handleGuestListClick);
initDownloadMenus();

document.getElementById('guest-desc').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate();
});

// Prime the AudioContext on the first interaction anywhere on the page. iOS only
// resumes audio from inside a user gesture, and the post-COMPOSE auto-play fires
// from a timer (no gesture of its own) — so unlocking on the first tap/key keeps
// it audible. unlock() is idempotent; once:true keeps each listener one-shot.
const unlockAudio = () => synth.unlock();
['pointerdown', 'keydown'].forEach((evt) =>
  document.addEventListener(evt, unlockAudio, { once: true, passive: true })
);

loadGuests().then(render);
