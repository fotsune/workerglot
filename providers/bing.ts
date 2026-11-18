import { TranslationProvider } from './types.js';
import type { TranslationResponse } from './types.js';

// Port of bing-translate-api's request flow to plain fetch (Workers-compatible):
// 1. GET bing.com/translator, scrape IG / IID / params_AbusePreventionHelper
// 2. POST /ttranslatev3 with an urlencoded body, reusing the token until it expires
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0';
const WEBSITE = 'https://www.bing.com/translator';
const MAX_TEXT_LEN = 1000;
const MAX_TEXT_LEN_CN = 5000;
const MAX_RETRY_COUNT = 3;

// Language codes from bing-translate-api's lang.json
const BING_LANG_CODES = [
  'ace', 'af', 'sq', 'am', 'ar', 'arz', 'ary', 'arb', 'hy', 'as', 'ast', 'az', 'ban', 'bn', 'ba', 'eu', 'bbc',
  'be', 'bho', 'bik', 'brx', 'bs', 'bg', 'yue', 'ca', 'ceb', 'hne', 'lzh', 'zh-Hans', 'zh-Hant', 'co', 'hr',
  'cs', 'da', 'prs', 'dv', 'doi', 'nl', 'en', 'en-GB', 'epo', 'et', 'fo', 'fj', 'fil', 'fi', 'fr', 'fr-CA',
  'fy', 'fur', 'gl', 'lug', 'ka', 'de', 'el', 'gu', 'ht', 'ha', 'he', 'hil', 'hi', 'mww', 'hu', 'iba', 'is',
  'ig', 'ilo', 'id', 'ikt', 'iu', 'iu-Latn', 'ga', 'it', 'jam', 'ja', 'jav', 'kea', 'kn', 'pam', 'ks', 'kk',
  'km', 'rw', 'tlh-Latn', 'gom', 'ko', 'kri', 'ku', 'kmr', 'ky', 'lo', 'la', 'lv', 'lij', 'lim', 'ln', 'lt',
  'lmo', 'dsb', 'lb', 'mk', 'mai', 'mg', 'ms', 'ml', 'mt', 'mr', 'mwr', 'mfe', 'min', 'mn-Cyrl', 'mn-Mong',
  'my', 'mi', 'ne', 'nb', 'nno', 'nya', 'oc', 'or', 'pap', 'ps', 'fa', 'pl', 'pt', 'pt-PT', 'pa', 'pnb',
  'otq', 'ro', 'run', 'ru', 'sm', 'sa', 'srd', 'sr-Cyrl', 'sr-Latn', 'st', 'nso', 'tn', 'crs', 'sn', 'scn',
  'sd', 'si', 'sk', 'sl', 'so', 'es', 'su', 'sw', 'sv', 'ty', 'tgk', 'ta', 'tt', 'te', 'tet', 'th', 'bo',
  'ti', 'tpi', 'to', 'tr', 'tk', 'uk', 'hsb', 'ur', 'ug', 'uz', 'vec', 'vi', 'war', 'cy', 'xh', 'ydd', 'yo',
  'yua', 'zu'
];

// Canonical code per lowercased code, e.g. 'zh-hans' -> 'zh-Hans'
const LANG_BY_LOWER = new Map(BING_LANG_CODES.map(code => [code.toLowerCase(), code]));

interface BingConfig {
  IG: string;
  IID: string;
  subdomain?: string;
  key: number;
  token: string;
  tokenTs: number;
  tokenExpiryInterval: number;
  count: number;
}

interface BingTranslationResponse {
  detectedLanguage?: { language?: string; score?: number };
  translations?: Array<{ text?: string; to?: string }>;
}

let globalConfig: BingConfig | undefined;
let globalConfigPromise: Promise<BingConfig> | undefined;

function replaceSubdomain(url: string, subdomain?: string): string {
  return url.replace('{s}', subdomain ? subdomain + '.' : 'www.');
}

function isTokenExpired(config: BingConfig | undefined): boolean {
  if (!config) return true;
  return Date.now() - config.tokenTs > config.tokenExpiryInterval;
}

async function fetchGlobalConfig(): Promise<BingConfig> {
  let subdomain = globalConfig?.subdomain;

  // `redirect: 'manual'` lets us learn the regional subdomain (e.g. cn.bing.com),
  // but workerd may answer with an opaque redirect: in that case just follow it.
  const first = await fetch(replaceSubdomain(WEBSITE, subdomain), {
    headers: { 'user-agent': USER_AGENT },
    redirect: 'manual',
  });

  const location = first.headers.get('location') || '';
  const match = location.match(/^https?:\/\/(\w+)\.bing\.com/);
  if (match?.[1]) subdomain = match[1];

  const page = first.status === 0 || first.status >= 300
    ? await fetch(location ? new URL(location, replaceSubdomain(WEBSITE, subdomain)).toString() : replaceSubdomain(WEBSITE, subdomain), {
        headers: { 'user-agent': USER_AGENT },
      })
    : first;

  if (!page.ok) throw new Error(`Bing translator page HTTP ${page.status}`);
  const body = await page.text();

  const IG = body.match(/IG:"([^"]+)"/)?.[1];
  const IID = body.match(/data-iid="([^"]+)"/)?.[1];
  const abuse = body.match(/params_AbusePreventionHelper\s?=\s?([^\]]+\])/)?.[1];
  if (!IG || !IID || !abuse) {
    throw new Error('Bing translator: failed to scrape IG/IID/token');
  }

  const [key, token, tokenExpiryInterval] = JSON.parse(abuse) as [number, string, number];

  globalConfig = {
    IG,
    IID,
    key,
    token,
    tokenTs: key,
    tokenExpiryInterval,
    subdomain,
    count: 0,
  };
  return globalConfig;
}

async function getConfig(): Promise<BingConfig> {
  if (!globalConfigPromise) {
    globalConfigPromise = fetchGlobalConfig();
  }
  try {
    await globalConfigPromise;
  } catch (error) {
    globalConfigPromise = undefined;
    throw error;
  }
  if (isTokenExpired(globalConfig)) {
    globalConfigPromise = fetchGlobalConfig();
    try {
      await globalConfigPromise;
    } catch (error) {
      globalConfigPromise = undefined;
      throw error;
    }
  }
  return globalConfig!;
}

function getLangCode(languageCode: string): string | undefined {
  return LANG_BY_LOWER.get(languageCode.toLowerCase());
}

function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${context}: unparseable body ${JSON.stringify(raw.slice(0, 200))}`);
  }
}

export class BingTranslateProvider extends TranslationProvider {
  name = 'bing';

  // Language support is static, same set as bing-translate-api's lang.json
  private supportedLanguages = new Set(BING_LANG_CODES.map(code => code.toLowerCase()));

  async translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResponse> {
    if (!text.trim()) {
      throw new Error('Bing translation failed: empty text');
    }

    const config = await getConfig();

    const from = sourceLang ? getLangCode(sourceLang) : 'auto-detect';
    const to = getLangCode(targetLang);

    if (!from) throw new Error(`The language '${sourceLang}' is not supported!`);
    if (!to) throw new Error(`The language '${targetLang}' is not supported!`);
    if (to === 'auto-detect') throw new Error("The language 'auto-detect' cannot be a target language");

    const maxTextLen = config.subdomain === 'cn' ? MAX_TEXT_LEN_CN : MAX_TEXT_LEN;
    if (text.length > maxTextLen) {
      throw new Error(`The supported maximum text length is ${maxTextLen}. Please shorten the text.`);
    }

    const url = replaceSubdomain('https://{s}bing.com/ttranslatev3?isVertical=1&', config.subdomain)
      + '&IG=' + config.IG
      + '&IID=' + config.IID;

    const form = {
      fromLang: from,
      text,
      token: config.token,
      key: String(config.key),
      to,
      tryFetchingGenderDebiasedTranslations: 'true',
    };

    const request = (extra: Record<string, string> = {}) => fetch(url, {
      method: 'POST',
      headers: {
        'user-agent': USER_AGENT,
        'content-type': 'application/x-www-form-urlencoded',
        referer: replaceSubdomain(WEBSITE, config.subdomain),
      },
      body: new URLSearchParams({ ...form, ...extra }).toString(),
    });

    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRY_COUNT; attempt++) {
      try {
        response = await request();
        if (response.ok || (response.status !== 401 && response.status < 500)) break;
        lastError = new Error(`Bing translation HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }

    if (!response || !response.ok) {
      const detail = response ? `${response.status} ${JSON.stringify((await response.text()).slice(0, 200))}` : String(lastError);
      throw new Error(`Bing translation failed: ${detail}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let raw = await response.text();

    if (!contentType.includes('application/json')) {
      // Gender-debiased results come back as HTML and need a second, explicit request.
      const debiased = await request({ isGenderDebiasViewPresent: 'true' });
      if (!debiased.ok) throw new Error(`Bing translation HTTP ${debiased.status}`);
      raw = await debiased.text();
    }

    if (!raw.trim()) {
      throw new Error(`Bing translation failed: empty body (HTTP ${response.status}, ${contentType || 'no content-type'})`);
    }

    const data = parseJson<BingTranslationResponse[] | { masculineTranslation?: string; feminineTranslation?: string }>(
      raw,
      'Bing translation failed'
    );

    if (Array.isArray(data)) {
      const result = data[0];
      const translated = result?.translations?.[0]?.text;
      if (!translated) throw new Error(`Bing translation failed: no result returned ${JSON.stringify(raw.slice(0, 200))}`);
      return {
        translated_text: translated,
        source_lang: sourceLang || result.detectedLanguage?.language || 'auto',
        target_lang: targetLang,
        provider: this.name
      };
    }

    const translated = data.masculineTranslation || data.feminineTranslation;
    if (!translated) throw new Error('Bing translation failed: no result returned');
    return {
      translated_text: translated,
      source_lang: sourceLang || 'auto',
      target_lang: targetLang,
      provider: this.name
    };
  }

  supportsLanguage(languageCode: string): boolean {
    return this.supportedLanguages.has(languageCode.toLowerCase());
  }

  isAvailable(): boolean {
    // Always available since we don't need API keys
    return true;
  }

  isFree(): boolean {
    return true;
  }

  // smol
  getMaxTextLength(): number {
    return MAX_TEXT_LEN;
  }

  // Bing Translate API doesn't support outputting newlines for some reason
  supportsText(text: string): boolean {
    return text.match(/\n/g) === null;
  }
}
