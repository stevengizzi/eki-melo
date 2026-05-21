/* =================================================================
   API: JINGLE GENERATION — owns "how we ask Claude"

   Builds the per-guest user prompt, posts to the jingle endpoint with
   the composition brief from composition.js, then parses and validates
   the JSON jingle the model returns.
   ================================================================= */
import { API_ENDPOINT } from '../env.js';
import { JINGLE_SYSTEM_PROMPT } from './composition.js';

export async function generateJingle(name, description) {
  const system = JINGLE_SYSTEM_PROMPT;

  const user = `Compose an arrival theme for this guest:

NAME: ${name}
DESCRIPTION: ${description}

Translate their personality into musical choices, then construct a piece with clear sections and motivic development so the piece feels composed, not just strung together. Make it instantly memorable.`;

  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }]
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${errText.slice(0,120)}`);
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join('').trim();

  let cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  let jingle;
  try {
    jingle = JSON.parse(cleaned);
  } catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not parse jingle JSON');
    jingle = JSON.parse(m[0]);
  }

  if (!Array.isArray(jingle.lead) || jingle.lead.length === 0) throw new Error('Jingle missing lead melody');
  jingle.harmony = Array.isArray(jingle.harmony) ? jingle.harmony : [];
  jingle.bass    = Array.isArray(jingle.bass) ? jingle.bass : [];
  jingle.tempo   = Number(jingle.tempo) || 140;
  jingle.title   = String(jingle.title || 'untitled theme');
  jingle.key     = String(jingle.key   || '');
  jingle.mood    = String(jingle.mood  || '');
  jingle.form    = String(jingle.form  || '');
  jingle.sections = Array.isArray(jingle.sections) ? jingle.sections : [];
  jingle.createdAt = Date.now();
  return jingle;
}
