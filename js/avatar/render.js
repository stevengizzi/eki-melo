/* =================================================================
   AVATAR RENDERING (canvas with animated frames)
   ================================================================= */
import { guests } from '../storage.js';

export const avatarAnimations = new Map();

// Dispatch on avatar version: v4+ avatars carry a PixelLab PNG (imageData) and
// render as an image; legacy hex-grid avatars (no version field) keep using the
// original per-pixel canvas renderer.
function renderAvatar(canvas, avatar) {
  if (!avatar) return;
  if (avatar.version >= 4 && avatar.imageData) {
    return renderAvatarImage(canvas, avatar);
  }
  return renderAvatarLegacy(canvas, avatar);
}

function renderAvatarImage(canvas, avatar) {
  const W = avatar.width || 64, H = avatar.height || 64;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Scale the canvas to fill its square wrap (96 desktop / 72 mobile). The
  // sprite is square and the wrap is square, so one factor fills the frame
  // while preserving aspect; image-rendering:pixelated keeps the upscale crisp.
  const wrap = canvas.parentElement;
  if (wrap) {
    const wrapW = wrap.clientWidth || 96, wrapH = wrap.clientHeight || 96;
    const scale = Math.max(1, Math.min(wrapW / W, wrapH / H));
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
  }

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
  };
  img.src = avatar.imageData;

  // Static sprite: CSS handles the idle motion, so cancel any legacy raf loop
  // registered for this canvas and drop it from the animation map.
  const existing = avatarAnimations.get(canvas);
  if (existing) cancelAnimationFrame(existing.raf);
  avatarAnimations.delete(canvas);
}

function renderAvatarLegacy(canvas, avatar) {
  if (!avatar) return;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const W = avatar.width || 24, H = avatar.height || 24;
  canvas.width = W;
  canvas.height = H;

  // Pick the largest integer scale that fits the wrap, preserving aspect.
  // Wrap is 96×144 on desktop, 64×96 on mobile — read it from parent.
  const wrap = canvas.parentElement;
  if (wrap) {
    const wrapW = wrap.clientWidth || 96;
    const wrapH = wrap.clientHeight || 144;
    const scale = Math.max(1, Math.floor(Math.min(wrapW / W, wrapH / H)));
    canvas.style.width = (W * scale) + 'px';
    canvas.style.height = (H * scale) + 'px';
  }

  const drawFrame = (frameIdx) => {
    ctx.clearRect(0, 0, W, H);
    const frame = avatar.frames[frameIdx % avatar.frames.length];
    if (!frame) return;
    for (let y = 0; y < H; y++) {
      const row = frame[y] || '';
      for (let x = 0; x < W; x++) {
        const ch = row[x];
        if (!ch || ch === '0') continue;
        const idx = parseInt(ch, 16);
        if (isNaN(idx)) continue;
        const color = avatar.palette[idx];
        if (!color || color === 'transparent') continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  };

  const existing = avatarAnimations.get(canvas);
  if (existing) cancelAnimationFrame(existing.raf);

  if (avatar.frames.length === 1) {
    drawFrame(0);
    return;
  }

  const fps = Math.max(1, Math.min(12, avatar.fps || 3));
  const frameDur = 1000 / fps;
  let lastSwitch = performance.now();
  let frameIdx = 0;
  drawFrame(0);

  const tick = (now) => {
    if (now - lastSwitch >= frameDur) {
      frameIdx = (frameIdx + 1) % avatar.frames.length;
      drawFrame(frameIdx);
      lastSwitch = now;
    }
    const raf = requestAnimationFrame(tick);
    avatarAnimations.set(canvas, { raf, frameIdx });
  };
  const raf = requestAnimationFrame(tick);
  avatarAnimations.set(canvas, { raf, frameIdx });
}

export function mountAvatars() {
  document.querySelectorAll('canvas[data-avatar-guest]').forEach(c => {
    const guestId = c.dataset.avatarGuest;
    const guest = guests.find(g => g.id === guestId);
    if (!guest || !guest.avatars[guest.currentAvatarIndex]) return;
    renderAvatar(c, guest.avatars[guest.currentAvatarIndex]);
  });
}
