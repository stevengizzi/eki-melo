/* =================================================================
   API: AVATAR GENERATION (v4 — Claude designs, PixelLab renders)

   Two-stage pipeline behind the /api/avatar Pages Function: Claude
   turns the guest's personality into a character spec, then PixelLab's
   PixFlux model renders a 64x64 transparent PNG sprite. Returns a v4
   avatar record; legacy hex-grid avatars (no version field) keep
   rendering through renderAvatarLegacy.
   ================================================================= */
import { AVATAR_ENDPOINT } from '../env.js';

export async function generateAvatar(name, description) {
  if (!AVATAR_ENDPOINT) {
    throw new Error('Avatar generation not available in artifact mode');
  }
  const response = await fetch(AVATAR_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description })
  });
  if (!response.ok) {
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
}
