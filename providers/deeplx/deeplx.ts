import { TranslationProvider } from '../types.js';
import type { TranslationResponse } from '../types.js';

// Port of @deeplx/core's anonymous "oneshot" flow (what the `deeplx` package uses)
// to plain fetch, so it runs in a Worker.
const FREE_ENDPOINT = 'https://oneshot-free.www.deepl.com/v1/translate';
const WARMUP_URL = 'https://www.deepl.com/translator';
const IOS_APP_VERSION = '26.42';
const IOS_APP_BUILD = '5443737';
const IOS_OS_VERSION = '26.0';
const IOS_CFNETWORK_VERSION = '3826.600.41';
const IOS_DARWIN_VERSION = '25.0.0';
const MAX_FREE_TEXT_LENGTH = 1500;

// Same language set as @deeplx/core's SUPPORTED_LANGUAGES
const SUPPORTED_LANGUAGES = [
  'AR', 'BG', 'CS', 'DA', 'DE', 'EL', 'EN', 'EN-GB', 'EN-US', 'ES', 'ES-419', 'ET', 'FI', 'FR', 'HE', 'HU',
  'ID', 'IT', 'JA', 'KO', 'LT', 'LV', 'NB', 'NL', 'PL', 'PT', 'PT-BR', 'PT-PT', 'RO', 'RU', 'SK', 'SL', 'SV',
  'TR', 'UK', 'VI', 'ZH', 'ZH-HANS', 'ZH-HANT',
];

const TARGET_LANG_MAP: Record<string, string> = {
  AR: 'ar', BG: 'bg', CS: 'cs', DA: 'da', DE: 'de', EL: 'el', 'EN-GB': 'en-GB', 'EN-US': 'en-US', ES: 'es',
  'ES-419': 'es-419', ET: 'et', FI: 'fi', FR: 'fr', HE: 'he', HU: 'hu', ID: 'id', IT: 'it', JA: 'ja', KO: 'ko',
  LT: 'lt', LV: 'lv', NB: 'nb', NL: 'nl', PL: 'pl', 'PT-BR': 'pt-BR', 'PT-PT': 'pt-PT', RO: 'ro', RU: 'ru',
  SK: 'sk', SL: 'sl', SV: 'sv', TR: 'tr', UK: 'uk', VI: 'vi', ZH: 'zh-Hans', 'ZH-HANS': 'zh-Hans',
  'ZH-HANT': 'zh-Hant', EN: 'en-US', PT: 'pt-BR',
};
const SOURCE_LANG_MAP: Record<string, string> = {
  ...TARGET_LANG_MAP, EN: 'en', PT: 'pt', ZH: 'zh', 'ZH-HANS': 'zh', 'ZH-HANT': 'zh',
};

const ABBREVIATIONS: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map(code => [code.toLowerCase(), code])
);

let sharedCookies = '';
let warmupPromise: Promise<void> | undefined;
let instanceId: string | undefined;
let sessionId: string | undefined;

const uuid = () => crypto.randomUUID();

function resolveLang(code: string | undefined, kind: 'source' | 'target'): string | undefined {
  if (!code || code.toLowerCase() === 'auto') {
    if (kind === 'target') throw new Error('target_lang cannot be "auto" or empty');
    return undefined;
  }
  const map = kind === 'target' ? TARGET_LANG_MAP : SOURCE_LANG_MAP;
  let mapped = map[code.toUpperCase()];
  if (!mapped) {
    const abbreviated = ABBREVIATIONS[code.split('-')[0]!.toLowerCase()];
    if (abbreviated) mapped = map[abbreviated];
  }
  if (!mapped) throw new Error(`unsupported ${kind}_lang "${code}"`);
  return mapped;
}

async function warmCookies(): Promise<void> {
  if (warmupPromise) return warmupPromise;
  warmupPromise = (async () => {
    try {
      const response = await fetch(WARMUP_URL);
      const raw = (response.headers.get('set-cookie') || '');
      const cookies: string[] = [];
      const userCountry = /userCountry=[^;]+/.exec(raw);
      if (userCountry) cookies.push(userCountry[0]);
      const verifiedBot = /verifiedBot=[^;]+/.exec(raw);
      if (verifiedBot) cookies.push(verifiedBot[0]);
      if (cookies.length) sharedCookies = cookies.join('; ');
    } catch {
      warmupPromise = undefined;
    }
  })();
  return warmupPromise;
}

export class DeepLXProvider extends TranslationProvider {
  name = 'deeplx';

  private supportedLanguages = new Set(SUPPORTED_LANGUAGES.map(code => code.toLowerCase()));

  async translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResponse> {
    const target = resolveLang(targetLang, 'target')!;
    const source = resolveLang(sourceLang, 'source');

    if (text.length > MAX_FREE_TEXT_LENGTH) {
      throw new Error(`text exceeds maximum length: ${text.length} characters (anonymous oneshot limit is ${MAX_FREE_TEXT_LENGTH})`);
    }

    if (!sharedCookies) {
      await warmCookies();
    }

    instanceId ??= uuid();
    sessionId ??= uuid();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Authorization: 'None',
      'User-Agent': `DeepL/${IOS_APP_VERSION} CFNetwork/${IOS_CFNETWORK_VERSION} Darwin/${IOS_DARWIN_VERSION}`,
      'x-app-os-version': IOS_OS_VERSION,
      'x-app-instance-id': instanceId,
      'x-app-session-id': sessionId,
    };
    if (sharedCookies) headers.Cookie = sharedCookies;

    const response = await fetch(FREE_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: [text],
        target_lang: target,
        source_lang: source,
        usage_type: 'translate',
        app_information: {
          os: 'iOS',
          os_version: IOS_OS_VERSION,
          app_version: IOS_APP_VERSION,
          app_build: IOS_APP_BUILD,
          instance_id: instanceId,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepLX oneshot HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as {
      translations?: Array<{ text?: string; detected_source_language?: string }>;
    };
    const translated = data.translations?.[0]?.text;
    if (!translated) {
      throw new Error('DeepLX oneshot returned an empty translation');
    }

    return {
      translated_text: translated,
      source_lang: data.translations?.[0]?.detected_source_language?.toUpperCase() || sourceLang,
      target_lang: targetLang,
      provider: 'deepl'
    };
  }

  supportsLanguage(languageCode: string): boolean {
    return this.supportedLanguages.has(languageCode.toLowerCase());
  }

  isAvailable(): boolean {
    return true;
  }

  isFree(): boolean {
    return true;
  }

  getMaxTextLength(): number {
    return MAX_FREE_TEXT_LENGTH;
  }

  // No known constraints on text type
  supportsText(_text: string): boolean {
    return true;
  }
}
