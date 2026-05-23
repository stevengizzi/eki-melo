/* =================================================================
   API: AVATAR GENERATION (v4 — Claude designs, PixelLab renders)

   Two-stage pipeline behind the /api/avatar Pages Function: Claude
   turns the guest's personality into a character spec, then PixelLab's
   PixFlux model renders a 64x64 transparent PNG sprite. Returns a v4
   avatar record; legacy hex-grid avatars (no version field) keep
   rendering through renderAvatarLegacy.
   ================================================================= */
import { AVATAR_ENDPOINT } from '../env.js';

// The Claude→PixelLab pipeline is slow but bounded; cap the wait so a stalled
// connection fails fast enough to retry instead of hanging until the browser's
// own network layer gives up with an opaque "Load failed".
const AVATAR_TIMEOUT_MS = 60000;
// One automatic retry smooths over flaky mobile networks (a dropped request on
// cellular is the common cause of the "Load failed" the user hits on phones).
const AVATAR_MAX_ATTEMPTS = 2;
const AVATAR_RETRY_BACKOFF_MS = 700;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch with an AbortController-backed timeout. Returns the Response; an aborted
// request rejects with an AbortError, which the caller treats as retryable.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A transient failure worth retrying: an aborted (timed-out) request, or a
// network-level failure (Safari surfaces these as a TypeError "Load failed").
// An HTTP error status is a definitive server answer, NOT this — see below.
function isRetryableError(err) {
  return err && (err.name === 'AbortError' || err instanceof TypeError);
}

export async function generateAvatar(name, description) {
  if (!AVATAR_ENDPOINT) {
    throw new Error('Avatar generation not available in artifact mode');
  }
  const requestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description })
  };

  let lastError = null;
  for (let attempt = 1; attempt <= AVATAR_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(AVATAR_ENDPOINT, requestInit, AVATAR_TIMEOUT_MS);
      if (!response.ok) {
        // A definitive server answer (e.g. a 502 from a failed PixelLab call):
        // surface it as-is — retrying won't change a server-side rejection.
        const errText = await response.text().catch(() => '');
        throw new Error(`Avatar API ${response.status}: ${errText.slice(0,120)}`);
      }
      const data = await response.json();
      // Expected shape: { archetype, hooks, palette, paletteHints, imageData, visualPrompt }
      return {
        archetype: data.archetype,
        hooks: data.hooks,
        palette: data.palette,
        paletteHints: data.paletteHints,
        visualPrompt: data.visualPrompt,
        imageData: data.imageData,  // "data:image/png;base64,..."
        width: 64,
        height: 64,
        version: 4,  // marker for the renderer to dispatch correctly
        createdAt: Date.now()
      };
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === AVATAR_MAX_ATTEMPTS) break;
      await delay(AVATAR_RETRY_BACKOFF_MS);
    }
  }

  // Make a timeout legible rather than leaking a bare "The operation was aborted".
  if (lastError && lastError.name === 'AbortError') {
    throw new Error(`Avatar timed out after ${Math.round(AVATAR_TIMEOUT_MS / 1000)}s`);
  }
  throw lastError;
}
