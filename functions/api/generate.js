// functions/api/generate.js
//
// Cloudflare Pages Function. File path becomes route: /api/generate
//
// Purpose: proxy POST requests from the browser to the Anthropic Messages
// API, injecting the api key server-side so it stays off the client.
//
// Bindings required (configure in Cloudflare Pages dashboard):
//   - ANTHROPIC_API_KEY  (secret)  — your sk-ant-... key
//
// Defenses included:
//   - Body size cap (8 KiB; jingle + avatar prompts are well under this)
//   - Model allow-list (prevents using your key for arbitrary other Claude
//     calls if the URL leaks)
//   - max_tokens cap (clamped to 4000 to bound runaway responses)
//   - Method check (POST only)
//
// Future hardening (not implemented yet — see docs/decision-log.md DEC-010):
//   - Per-IP rate limit via Cloudflare KV. Bind a KV namespace called
//     RATE_LIMIT, then increment-and-check by `cf-connecting-ip` header.
//   - Cloudflare WAF rule for IP-level throttling (dashboard, no code).

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_BODY_BYTES = 8 * 1024;
const MAX_TOKENS_CAP = 4000;
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-20250514',
]);

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Config sanity check
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse(500, {
      error: 'Server misconfigured: ANTHROPIC_API_KEY not set. ' +
             'Add it as a secret in Cloudflare Pages → Settings → Environment variables.',
    });
  }

  // 2. Body size guard
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, {
      error: `Request body too large (${contentLength} bytes; max ${MAX_BODY_BYTES}).`,
    });
  }

  // 3. JSON parse
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }

  // 4. Shape check
  if (!body.model || !Array.isArray(body.messages)) {
    return jsonResponse(400, {
      error: 'Missing required fields: "model" (string) and "messages" (array).',
    });
  }

  // 5. Model allow-list
  if (!ALLOWED_MODELS.has(body.model)) {
    return jsonResponse(400, {
      error: `Model not allowed: "${body.model}". ` +
             `Allowed: ${[...ALLOWED_MODELS].join(', ')}.`,
    });
  }

  // 6. Clamp max_tokens to a sane ceiling
  if (typeof body.max_tokens === 'number' && body.max_tokens > MAX_TOKENS_CAP) {
    body.max_tokens = MAX_TOKENS_CAP;
  }

  // 7. Forward to Anthropic
  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return jsonResponse(502, {
      error: `Upstream request failed: ${e && e.message ? e.message : 'unknown'}`,
    });
  }

  // 8. Pass through status + body. Don't leak Anthropic's response headers
  //    (rate-limit headers, request-id, etc) since they're not useful to the
  //    client and could be confusing.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    },
  });
}
