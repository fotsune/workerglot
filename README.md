# 🗣️ Workerglot - Scalable Translation Service

A fast, reliable, and modular translation API designed to meet the scale required by FxEmbed.

With our native multi-provider architecture, we support multiple kinds of providers:
- **Work on Cloudflare Workers** 
- **Free translations** from popular services like *Google Translate*, *DeepL*, and *Bing Translate*
- **Official APIs** using your own API keys for services like *Azure AI Translator*, *DeepL API*, and *AWS Translate*. Each of which have free tiers or trials.
- **Self-hosted alternative** *LibreTranslate*

## Features

- **Dynamic Selection**: Chooses between providers based on target language, input string length, and availability
- **Load Balancing and Rate Limit Leveling**: Distributes requests across translation providers
- **Automatic Failover**: If one provider fails, automatically tries others (free first, then paid)
- **Designed to Scale**: Use higher rate limits for free services by scaling across servers and network providers

## Quick Start

### Standalone

This requires [Node.js](https://nodejs.org) 20 or newer installed.

```bash
# Clone the repository
git clone <your-repo-url>
cd polyglot

# Install dependencies
npm install

# Start the server
npm start
```

`npm start` runs `server.ts`, a thin Node HTTP adapter over the very same `worker.ts` handler that Cloudflare runs, so both targets share one implementation of the routes and of every provider. The API will be available at `http://localhost:3220` (port configurable with `PORT` in `.env` or `docker-compose.yml`; a local `.env` is loaded automatically when present).

### Cloudflare Workers

`worker.ts` is the Workers entry point and exposes the same API (`GET /ping`, `GET /`, `POST /translate`).
Every provider is written against `fetch`/`crypto.subtle` only, so the same `translation.ts` and `providers/` run on Node and on Workers - there are no runtime-specific packages left in the path.

```bash
# Install dependencies (wrangler + Cloudflare types)
npm install

# Local run, reading vars/secrets from .dev.vars
cp .dev.vars.example .dev.vars   # fill in what you need
npm run dev

# Type-check and deploy
npm run typecheck
npx wrangler login
npm run deploy
```

Secrets are set with Wrangler, not committed to `wrangler.toml`:

```bash
npx wrangler secret put ACCESS_TOKEN
npx wrangler secret put DEEPL_API_KEY
npx wrangler secret put AZURE_TRANSLATOR_KEY
npx wrangler secret put AZURE_TRANSLATOR_REGION
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
npx wrangler secret put DEEPLX_CLOUDFLARE_URL
```

Workers notes:

- **Only DeepL was tested on Workers.** The deployed Worker was verified end to end with the official `deepl` provider alone; every other provider is an untested path there. 
- From Cloudflare's own egress IPs the free providers are usually blocked: Google answers `429` with an "unusual traffic", while the same request from a home IP returns `200`, and Bing's  answers `401`. A Worker deployment therefore needs a paid provider or a self-hosted DeepLX; expect the free fallbacks to fail under load, not to save the request.
- `PREFER_PAID=true` (optional, a `[vars]` entry rather than a secret) puts configured paid providers ahead of the free ones in both the primary attempt and the fallback chain.
- `MAX_TEXT_LENGTH` (optional) rejects bodies above that length with `413`; `REQUEST_TIMEOUT_MS` (default `15000`) bounds each provider attempt before failing over.
- The built-in `deeplx` provider talks to DeepL's anonymous endpoint directly and is capped at 1500 characters.
- Bing tokens (`IG`/`IID`/token) are cached per isolate; free endpoints may throttle or block datacenter IPs.
- CORS is open on every route; restrict it in `worker.ts` if the endpoint is public.
- A Worker has no fixed outbound IP and a per-request subrequest limit, so free-service rate limits are not escaped by scaling.

### Optional: Configure Paid APIs

Relying on free services alone is not ideal since requests can be throttled or blocked (DeepL in particular is very aggressive at this). So we support a variety of paid translation providers, which luckily have free tiers:
- [Azure AI Translator](https://azure.microsoft.com/en-us/products/ai-services/ai-translator) - 2M characters free per month, forever
- [DeepL](https://www.deepl.com/en/pro-api) - 1M characters free per month, forever
- [AWS Translate](https://aws.amazon.com/translate/) - 2M characters free per month, 12 months only

```
# Azure AI Translator 
AZURE_TRANSLATOR_KEY="your_azure_key"
AZURE_TRANSLATOR_REGION="eastus"

# DeepL Official API  
DEEPL_API_KEY="your_deepl_key"

# AWS Translate
AWS_ACCESS_KEY_ID="your_access_key_id"
AWS_SECRET_ACCESS_KEY="your_access_key"
AWS_REGION="your_region" # optional, defaults to us-east-1

# LibreTranslate (self-hosted or public instance)
LIBRETRANSLATE_URL="https://translate.example.com"
LIBRETRANSLATE_API_KEY="your_api_key_if_required" # optional for some instances
```

**Note**: Free providers (Google Translate, Bing, DeepLX) work without configuration.

### Optional: Use Paid Providers First

By default the service prefers free providers and only reaches for a paid one when none of them can handle the request. Within each group the provider is picked at random, and the rest of the group is kept as a fallback chain.

Set `PREFER_PAID` to flip that order:

```bash
# Cloudflare Workers: a plain variable, not a secret
# wrangler.toml -> [vars] PREFER_PAID = "true"

# .env, docker-compose.yml
PREFER_PAID="true"

# docker run
-e PREFER_PAID=true
```

With the flag on, every request tries a configured paid provider first (and the fallback chain stays paid-first too); free services only step in once the paid ones fail. Accepted values for "on" are `true`, `1`, `yes` and `on`; anything else, or no value at all, keeps the default free-first behaviour.

A paid provider only counts as configured when its credentials are present, so with no paid keys set the flag changes nothing — free services keep serving either way.


### Using Docker Compose (idk untested)

Edit the `docker-compose.yml` file to set bound port and your API keys if you want to use paid translation providers.

```bash
docker compose up -d
```
### Using Docker (idk untested)

```bash
# Pull and run the latest image
docker run -p 3220:3220 ghcr.io/fxembed/polyglot:latest

# Or run with environment variables 
docker run -p 3220:3220 \
  -e AZURE_TRANSLATOR_KEY="your_azure_key" \
  -e AZURE_TRANSLATOR_REGION="eastus" \
  -e DEEPL_API_KEY="your_deepl_key" \
  ghcr.io/fxembed/polyglot:latest
```




## 📖 API Usage

### Translate Text

**Endpoint:** `POST /translate`

If you configured an `ACCESS_TOKEN`, please provide it in the `Authorization` header as `Bearer <token>`.

**Request Body:**
```json
{
  "text": "Hello, world!",
  "target_lang": "es",
  "source_lang": "en"  // Optional - auto-detected if not provided
}
```

**Response:**
```json
{
  "translated_text": "¡Hola Mundo!",
  "source_lang": "en",
  "target_lang": "es",
  "provider": "google"
}
```

### Example with cURL

```bash
# Basic translation, auto detect language
curl -X POST http://localhost:3220/translate \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, world!", "target_lang": "es"}'

# With source language specified
curl -X POST http://localhost:3220/translate \
  -H "Content-Type: application/json" \
  -d '{"text": "Bonjour le monde", "source_lang": "fr", "target_lang": "en"}'
```

## 📄 License

This project is licensed under AGPL-3.0.

## Disclaimer

This project is not affiliated with any of the providers listed above. The names of the providers may be trademarks or registered trademarks of their respective owners. Scraping from free APIs may violate their respective EULA.