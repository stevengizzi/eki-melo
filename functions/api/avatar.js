// functions/api/avatar.js
//
// Cloudflare Pages Function. File path becomes route: /api/avatar
//
// Purpose: build a guest's pixel-art avatar with a two-stage pipeline that
// runs entirely server-side so neither API key ever reaches the client.
//
//   Stage 1 — Claude (Anthropic Messages API) reads the guest's name and
//             personality and returns a structured character spec:
//             { archetype, hooks, palette, paletteHints, visualPrompt }.
//   Stage 2 — PixelLab (PixFlux model) renders the visualPrompt into a 64x64
//             transparent-background PNG sprite.
//
// The composite { archetype, hooks, palette, paletteHints, visualPrompt,
// imageData } is returned to the client.
//
// Bindings required (Cloudflare Pages → Settings → Environment variables):
//   - ANTHROPIC_API_KEY  (secret) — sk-ant-... key (shared with /api/generate)
//   - PIXELLAB_API_KEY   (secret) — PixelLab API token (Bearer auth)
//
// NOTE on the PixelLab endpoint: the live API path is
//   /v2/create-image-pixflux  (verified against the api.pixellab.ai OpenAPI
//   spec). The original v4 spec draft referenced /v2/generate-image-pixflux,
//   which does not exist and would 404.
//
// Defenses (mirrors generate.js): body size cap (8 KiB), POST only, and
// field validation. Errors are tagged with the stage that failed ("config",
// "request", "claude", "pixellab") so the client can show a useful message.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_MAX_TOKENS = 1024;

const PIXELLAB_URL = 'https://api.pixellab.ai/v2/create-image-pixflux';
const SPRITE_SIZE = 64;
const TEXT_GUIDANCE_SCALE = 8;

const MAX_BODY_BYTES = 8 * 1024;

const CHARACTER_SYSTEM_PROMPT = `You design pixel-art character concepts for a birthday-party "select character" screen. Each character is a 64×64 retro RPG sprite representing a guest. Output JSON only.

Your job is to interpret the guest's personality, pick a character archetype, and produce a visual prompt optimized for a pixel-art image-generation model. The image model is good at concrete visual descriptions (specific colors, named objects, clear pose). It is bad at abstract personality concepts. Translate.

OUTPUT JSON SHAPE:
{
  "archetype": "Forest Artificer",
  "hooks": ["moss-green hooded cloak", "mechanical brass owl on shoulder", "clockwork device at belt"],
  "palette": ["#3e6e4a", "#6fa86d", "#cd7f32", "#d4a574", "#1a1c2c", "#f4e4bc"],
  "paletteHints": "moss greens, weathered bronze, cream highlights, deep forest shadows",
  "visualPrompt": "16-bit RPG character sprite, forest artificer standing forward-facing in moss-green hooded cloak, small mechanical brass owl perched on right shoulder, holding brass clockwork device, weathered leather boots, palette of moss greens and weathered bronze with cream highlights, transparent background, centered, NES/SNES style, single character full body, charming and friendly"
}

ARCHETYPE GUIDANCE — pick or invent a class that captures this guest. Fantasy AND sci-fi both fair game:
Ranger, Naturalist, Bard, Sage, Scholar, Cartographer, Astronomer, Apothecary, Tinkerer, Artificer, Inventor, Mechanic, Pilot, Engineer, Drifter, Wanderer, Navigator, Beastmaster, Falconer, Chronomancer, Cyber-monk, Stargazer, Alchemist, Lorekeeper, Archivist, Strategist, Field Medic, Botanist, Sky-Captain.

The character is ALWAYS anthropomorphic (human, humanoid, or anthropomorphic animal/creature), ALWAYS charming, NEVER scary or monstrous.

VISUAL PROMPT GUIDANCE — this is the most important field. Concrete > abstract. Name specific colors, specific objects, specific clothing. Example weight by category:
- Always include: "16-bit RPG character sprite", "forward-facing standing pose", "transparent background", "single character full body", "centered"
- Always include: 2-3 concrete visual hooks (the items, accessories, companions)
- Always include: explicit palette description ("palette of X, Y, Z")
- Never include: personality words ("contemplative", "creative"), abstract concepts ("forest vibes"), narrative ("loves to tinker")

The visualPrompt should be one paragraph, 40-80 words.`;

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Stage-tagged error body so the client can tell the user which call failed.
const errorResponse = (status, stage, message) =>
  jsonResponse(status, { error: message, stage });

// Robustly pull a JSON object out of Claude's text, tolerating code fences or
// stray prose around the object (same approach the client used pre-v4).
function parseCharacterSpec(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse character JSON from Claude.');
    return JSON.parse(match[0]);
  }
}

// Stage 1: ask Claude for the structured character spec.
async function designCharacter(apiKey, name, description) {
  const user = `Design a character for this guest.\nNAME: ${name}\nDESCRIPTION: ${description}`;

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: CHARACTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(`Anthropic ${upstream.status}: ${detail.slice(0, 200)}`);
  }

  const data = await upstream.json();
  const text = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text || '')
    .join('')
    .trim();

  const spec = parseCharacterSpec(text);
  if (!spec.visualPrompt || typeof spec.visualPrompt !== 'string') {
    throw new Error('Claude response missing a visualPrompt field.');
  }
  return spec;
}

// Stage 2: render the visualPrompt into a 64x64 transparent sprite.
async function renderSprite(apiKey, visualPrompt) {
  const upstream = await fetch(PIXELLAB_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      description: visualPrompt,
      image_size: { width: SPRITE_SIZE, height: SPRITE_SIZE },
      no_background: true,
      text_guidance_scale: TEXT_GUIDANCE_SCALE,
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(`PixelLab ${upstream.status}: ${detail.slice(0, 200)}`);
  }

  const data = await upstream.json();
  const base64 = data && data.image && typeof data.image.base64 === 'string'
    ? data.image.base64
    : null;
  if (!base64) throw new Error('PixelLab response missing image.base64.');

  // The OpenAPI schema describes this only as "Base64 encoded image data" and
  // does not promise a data-URI prefix. Add the prefix only when absent, so the
  // client always receives a ready-to-use data: URL regardless of which form
  // PixelLab returns.
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Config sanity check — both secrets must be present.
  if (!env.ANTHROPIC_API_KEY) {
    return errorResponse(500, 'config',
      'Server misconfigured: ANTHROPIC_API_KEY not set. ' +
      'Add it as a secret in Cloudflare Pages → Settings → Environment variables.');
  }
  if (!env.PIXELLAB_API_KEY) {
    return errorResponse(500, 'config',
      'Server misconfigured: PIXELLAB_API_KEY not set. ' +
      'Add it as a secret in Cloudflare Pages → Settings → Environment variables.');
  }

  // 2. Body size guard.
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse(413, 'request',
      `Request body too large (${contentLength} bytes; max ${MAX_BODY_BYTES}).`);
  }

  // 3. JSON parse.
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse(400, 'request', 'Invalid JSON body.');
  }

  // 4. Shape check.
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!name || !description) {
    return errorResponse(400, 'request',
      'Missing required fields: "name" and "description" (both non-empty strings).');
  }

  // 5. Stage 1 — Claude designs the character spec.
  let spec;
  try {
    spec = await designCharacter(env.ANTHROPIC_API_KEY, name, description);
  } catch (e) {
    return errorResponse(502, 'claude',
      `Claude character design failed: ${e && e.message ? e.message : 'unknown'}`);
  }

  // 6. Stage 2 — PixelLab renders the sprite from the visual prompt.
  let imageData;
  try {
    imageData = await renderSprite(env.PIXELLAB_API_KEY, spec.visualPrompt);
  } catch (e) {
    return errorResponse(502, 'pixellab',
      `PixelLab sprite render failed: ${e && e.message ? e.message : 'unknown'}`);
  }

  // 7. Return the composite to the client.
  return jsonResponse(200, {
    archetype: spec.archetype,
    hooks: spec.hooks,
    palette: spec.palette,
    paletteHints: spec.paletteHints,
    visualPrompt: spec.visualPrompt,
    imageData,
  });
}
