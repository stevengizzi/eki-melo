/* =================================================================
   STAGE 7 — VOICE-LEADING PASS (buildplan Session 7).

   applyVoiceLeading(voiceTracks, config, macroParams) → voiceTracks

   A thin pass-through to theory/voice-leading-rules.js. It selects the rule
   preset from the PipelineConfig — `config.knobs.voice_leading_strictness`
   (buildplan §3), defaulting to 'chiptune_idiomatic' — and threads macroParams
   (mode/tonic) so the mode-aware repairs (snap-to-mode, step nudges) work.

   The actual rule set, repair primitives, and PRESETS registry live in
   theory/voice-leading-rules.js. The two presets:
   - chiptune_idiomatic (default): range-clamp; snap out-of-mode LEAD notes
     unless anomaly-flagged; allow parallel perfects, ignore voice crossing and
     tritones (the texture vocabulary owns those).
   - cpp_strict: range-clamp; snap every voice to mode (no anomaly exemption);
     forbid voice crossing and parallel perfects; fill melodic tritones.

   Operates on beat-stamped { pitch, beat, duration } events (the Session-5
   VoiceTracks shape); returns a NEW VoiceTracks, input unmutated. The runner
   calls this between Stage 6 and Stage 8.

   PORTABILITY. pipeline/ code — may import theory/ and pipeline-config.
   ================================================================= */
import { applyVoiceLeading as applyRules } from '../theory/voice-leading-rules.js';
import { DEFAULT_CONFIG } from './pipeline-config.js';

/**
 * Dispatch to the configured voice-leading preset. `config` is the
 * PipelineConfig (defaults to DEFAULT_CONFIG); `macroParams` supplies the
 * mode/tonic the rules need. With no macroParams the pass is a no-op (the wired
 * pipeline always provides it — this guards stray callers).
 */
export function applyVoiceLeading(voiceTracks, config = DEFAULT_CONFIG, macroParams) {
  if (!macroParams) return voiceTracks;
  const preset = config?.knobs?.voice_leading_strictness ?? 'chiptune_idiomatic';
  return applyRules(voiceTracks, macroParams, preset);
}
