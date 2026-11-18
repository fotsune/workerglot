import { TranslationService } from './translation.js';
import type { Env } from './config.js';
import type { TranslationRequest } from './providers/index.js';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'access-control-max-age': '86400',
};

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });

const text = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

// Bindings are constant for the isolate, so one service per env object is enough.
const services = new WeakMap<Env, TranslationService>();

function serviceFor(env: Env): TranslationService {
  let service = services.get(env);
  if (!service) {
    service = new TranslationService(env);
    services.set(env, service);
  }
  return service;
}

async function handleTranslate(request: Request, env: Env): Promise<Response> {
  if (env.ACCESS_TOKEN && request.headers.get('Authorization') !== `Bearer ${env.ACCESS_TOKEN}`) {
    return json({
      error: "Unauthorized",
      message: "Invalid access token"
    }, 401);
  }

  let body: TranslationRequest;
  try {
    body = await request.json() as TranslationRequest;
  } catch {
    return text("Request body must be valid JSON", 400);
  }

  const { text: input, source_lang, target_lang } = body ?? ({} as TranslationRequest);

  if (!input || !target_lang || typeof input !== 'string' || typeof target_lang !== 'string') {
    return text("Missing text or target_lang parameter", 400);
  }

  const maxTextLength = env.MAX_TEXT_LENGTH ? Number(env.MAX_TEXT_LENGTH) : undefined;
  if (maxTextLength && Number.isFinite(maxTextLength) && input.length > maxTextLength) {
    return text(`Text exceeds ${maxTextLength} characters`, 413);
  }

  try {
    const result = await serviceFor(env).translate(input, target_lang, source_lang);
    return json(result);
  } catch (error) {
    console.error("Translation error:", error);
    return json({
      error: "Translation failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    let response: Response;
    if (url.pathname === '/ping') {
      response = text('Pong!');
    } else if (url.pathname === '/translate' && request.method === 'POST') {
      response = await handleTranslate(request, env);
    } else if (url.pathname === '/') {
      response = text('This is an instance of polyglot, a scalable translation service: https://github.com/FxEmbed/polyglot');
    } else {
      response = text('Not Found', 404);
    }

    // Every answer, errors included, is readable from a browser origin.
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
