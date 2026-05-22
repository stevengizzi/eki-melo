/* =================================================================
   UI RENDERING + user-facing messaging (errors, toasts)
   ================================================================= */
import { guests } from './storage.js';
import { renderPianoRoll } from './jingle/render.js';
import { avatarAnimations, mountAvatars } from './avatar/render.js';

export function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// A small inline tag showing which engine composed the currently-shown jingle.
// Reads the per-jingle `engine` field (defaulting to v1 for any pre-dual-engine
// jingle that somehow lacks one); re-rendered whenever the archive pager moves,
// so the badge always tracks g.jingles[g.currentJingleIndex].
function engineBadge(engine) {
  const which = engine === 'pipeline' ? 'pipeline' : 'v1';
  const label = which === 'pipeline' ? 'v2' : 'v1';
  return `<span class="engine-badge engine-badge-${which}">${label}</span>`;
}

export function render() {
  avatarAnimations.forEach(a => cancelAnimationFrame(a.raf));
  avatarAnimations.clear();

  const listEl = document.getElementById('guest-list');
  if (guests.length === 0) {
    listEl.innerHTML = `
      <div class="pixel-card empty-state">
        <div class="empty-state-icon">♪ ♫ ♪</div>
        <p>No guests yet. Add one above to compose their arrival theme and pixel avatar.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML =
    `<h2 class="section-heading">★ GUEST LIST (${guests.length})</h2>` +
    guests.map(g => renderGuestCard(g)).join('');

  mountAvatars();
}

export function renderGuestCard(g) {
  const jingle = g.jingles[g.currentJingleIndex];
  const avatar = g.avatars[g.currentAvatarIndex];
  const jCount = g.jingles.length;
  const aCount = g.avatars.length;

  const avatarInner = avatar
    ? `<canvas data-avatar-guest="${g.id}"></canvas>`
    : `<div style="color:var(--text-dim);font-family:'Press Start 2P';font-size:8px;text-align:center;line-height:1.5">NO<br>AVATAR<br>YET</div>`;

  return `
    <div class="guest-card" data-id="${g.id}">
      <div class="guest-header">
        <div class="guest-left">
          <div style="display:flex;flex-direction:column;gap:0">
            <div class="avatar-wrap" id="avatar-wrap-${g.id}">
              ${avatarInner}
            </div>
            ${aCount > 1 ? `
              <div class="avatar-controls">
                <button data-act="prevAvatar" data-id="${g.id}" ${g.currentAvatarIndex === 0 ? 'disabled' : ''}>◀</button>
                <span>${g.currentAvatarIndex + 1}/${aCount}</span>
                <button data-act="nextAvatar" data-id="${g.id}" ${g.currentAvatarIndex >= aCount - 1 ? 'disabled' : ''}>▶</button>
              </div>
            ` : ''}
          </div>
          <div class="guest-info">
            <div class="guest-name">${escapeHtml(g.name)}</div>
            <div class="guest-theme">"${escapeHtml(jingle.title)}" ${engineBadge(jingle.engine)}</div>
            <div class="guest-meta">${escapeHtml(jingle.key)} · ${escapeHtml(jingle.mood)} · ${jingle.tempo} BPM${jingle.form ? ' · ' + escapeHtml(jingle.form) : ''}</div>
            ${g.description ? `<div class="guest-desc">${escapeHtml(g.description)}</div>` : ''}
          </div>
        </div>
        <div class="guest-actions">
          <button class="btn btn-play btn-small" data-act="play" data-id="${g.id}">▶ PLAY</button>
        </div>
      </div>

      ${renderPianoRoll(jingle)}

      <div class="action-row">
        <div class="version-controls">
          <button data-act="prevJingle" data-id="${g.id}" ${g.currentJingleIndex === 0 ? 'disabled' : ''}>◀</button>
          <span>JINGLE ${g.currentJingleIndex + 1} / ${jCount}</span>
          <button data-act="nextJingle" data-id="${g.id}" ${g.currentJingleIndex >= jCount - 1 ? 'disabled' : ''}>▶</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-small" data-act="rerollJingle" data-id="${g.id}">↻ NEW JINGLE</button>
          <button class="btn btn-tertiary btn-small" data-act="rerollAvatar" data-id="${g.id}">↻ NEW AVATAR</button>
          <button class="btn btn-ghost btn-small" data-act="downloadWav" data-id="${g.id}">↓ WAV</button>
          <button class="btn btn-danger btn-small" data-act="delete" data-id="${g.id}">✕</button>
        </div>
      </div>
    </div>
  `;
}

export function showError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg;
  el.style.display = 'block';
}

export function hideError() { document.getElementById('form-error').style.display = 'none'; }

export function toast(msg, color) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  if (color) t.style.background = color;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}
