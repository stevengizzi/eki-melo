/* =================================================================
   STORAGE (v1 schema preserved, migrates on read — same key)

   Migration is read-side and NON-DESTRUCTIVE (DEC-007 / DEC-009): the raw stored
   data is transformed in memory, and only written back after a clean full read +
   in-memory migration. No field is ever dropped — migrations only ADD defaults.

   Session-13 (the dual-engine wire-up) extends each jingle with:
     - engine: 'v1' | 'pipeline'   (which composer produced it; required for new
                                    jingles, defaulted to 'v1' for every jingle
                                    stored before this session — v1 was the only
                                    engine then)
     - pipelineMetadata: object    (optional; present only on 'pipeline' jingles —
                                    the resolved aesthetic / macroParams / harmony /
                                    motifs / phrase / texture plans, for inspection)
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

// Add the `engine` tag to a jingle that predates the dual-engine schema. Pure —
// returns a new object, preserves every existing field (including pipelineMetadata
// on pipeline jingles). Pre-Session-13 jingles were all produced by v1, so an
// absent engine defaults to 'v1'.
export function migrateJingle(jingle) {
  if (!jingle || typeof jingle !== 'object') return jingle;
  if (typeof jingle.engine === 'string') return jingle;
  return { ...jingle, engine: 'v1' };
}

// True when any jingle in the raw stored data lacks the new `engine` tag — i.e.
// the engine-field migration still has work to write back.
function jinglesNeedEngineTag(raw) {
  return raw.some(
    (g) => Array.isArray(g.jingles) && g.jingles.some((j) => !j || typeof j.engine !== 'string')
  );
}

export function migrateGuest(g) {
  if (g.jingles && Array.isArray(g.jingles)) {
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      jingles: g.jingles.map(migrateJingle),
      currentJingleIndex: Math.min(g.currentJingleIndex || 0, g.jingles.length - 1),
      avatars: Array.isArray(g.avatars) ? g.avatars : [],
      currentAvatarIndex: g.currentAvatarIndex || 0
    };
  }
  // Old schema { jingle: {...} } — convert to versions array, preserving data
  const jingles = g.jingle ? [migrateJingle({ ...g.jingle, createdAt: Date.now() })] : [];
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
      // Write-back triggers: old per-guest schema (no jingles array) OR a jingle
      // missing the Session-13 engine tag. Either way we migrate in memory FIRST,
      // then persist only after the full read + transform succeeded (DEC-007).
      const needsMigration = raw.some(g => !g.jingles) || jinglesNeedEngineTag(raw);
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
