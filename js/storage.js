/* =================================================================
   STORAGE (v1 schema preserved, migrates on read — same key)
   ================================================================= */
import { storageBackend } from './env.js';

export const STORAGE_KEY = 'eki_guests_v1';

// The live guest list. Other modules import this binding for reads and mutate
// it in place (push/unshift); reassignments (filter, replace) go through
// setGuests so the live binding updates for every importer.
export let guests = [];

export function setGuests(next) {
  guests = next;
}

export function migrateGuest(g) {
  if (g.jingles && Array.isArray(g.jingles)) {
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      jingles: g.jingles,
      currentJingleIndex: Math.min(g.currentJingleIndex || 0, g.jingles.length - 1),
      avatars: Array.isArray(g.avatars) ? g.avatars : [],
      currentAvatarIndex: g.currentAvatarIndex || 0
    };
  }
  // Old schema { jingle: {...} } — convert to versions array, preserving data
  const jingles = g.jingle ? [{ ...g.jingle, createdAt: Date.now() }] : [];
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    jingles,
    currentJingleIndex: 0,
    avatars: [],
    currentAvatarIndex: 0
  };
}

export async function loadGuests() {
  try {
    const value = await storageBackend.get(STORAGE_KEY);
    if (value) {
      const raw = JSON.parse(value);
      const needsMigration = raw.some(g => !g.jingles);
      guests = raw.map(migrateGuest);
      if (needsMigration) await saveGuests();
    }
  } catch (e) {
    guests = [];
  }
}

export async function saveGuests() {
  try {
    await storageBackend.set(STORAGE_KEY, JSON.stringify(guests));
  } catch (e) {
    console.error('Save failed', e);
  }
}
