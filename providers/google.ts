import { TranslationProvider } from './types.js';
import type { TranslationResponse } from './types.js';

// Endpoint and body shape mirror @vitalets/google-translate-api, but with plain
// fetch so the provider also runs inside a Cloudflare Worker.
const GOOGLE_ENDPOINT = 'https://translate.google.com/translate_a/single?client=at&dt=t&dt=rm&dj=1';

interface GoogleSingleResponse {
  sentences?: Array<{ trans?: string }>;
}

export class GoogleTranslateProvider extends TranslationProvider {
  name = 'google';

  // Google Translate supported languages (comprehensive list)
  // Note: This is manually maintained as Google Translate API doesn't export language constants
  // Based on official Google Translate documentation as of 2024
  private supportedLanguages = new Set([
    'auto', 'af', 'ak', 'sq', 'am', 'ar', 'hy', 'as', 'ay', 'az', 'bm', 'eu', 'be', 'bn', 'bho', 'bs', 'bg', 
    'ca', 'ceb', 'ny', 'zh', 'zh-cn', 'zh-tw', 'co', 'hr', 'cs', 'da', 'dv', 'doi', 'nl', 'en', 'eo', 'et', 
    'ee', 'tl', 'fi', 'fr', 'fy', 'gl', 'ka', 'de', 'el', 'gn', 'gu', 'ht', 'ha', 'haw', 'he', 'hi', 'hmn', 
    'hu', 'is', 'ig', 'ilo', 'id', 'ga', 'it', 'ja', 'jw', 'kn', 'kk', 'km', 'rw', 'gom', 'ko', 'kri', 'ku', 
    'ckb', 'ky', 'lo', 'la', 'lv', 'ln', 'lt', 'lg', 'lb', 'mk', 'mai', 'mg', 'ms', 'ml', 'mt', 'mi', 'mr', 
    'mni-mtei', 'lus', 'mn', 'my', 'ne', 'no', 'or', 'om', 'ps', 'fa', 'pl', 'pt', 'pa', 'qu', 'ro', 'ru', 
    'sm', 'sa', 'gd', 'nso', 'sr', 'st', 'sn', 'sd', 'si', 'sk', 'sl', 'so', 'es', 'su', 'sw', 'sv', 'tg', 
    'ta', 'tt', 'te', 'th', 'ti', 'ts', 'tr', 'tk', 'ak', 'uk', 'ur', 'ug', 'uz', 'vi', 'cy', 'xh', 'yi', 
    'yo', 'zu'
  ]);

  async translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResponse> {
    const body = new URLSearchParams({
      sl: sourceLang || 'auto',
      tl: targetLang,
      q: text,
    });

    const response = await fetch(GOOGLE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      // Google often answers 429 with a long "unusual traffic" HTML page: keep the log readable.
      const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(`Google Translate error (${response.status}): ${detail}`);
    }

    const data = await response.json() as GoogleSingleResponse;
    const translated = (data.sentences || [])
      .filter(sentence => typeof sentence.trans === 'string')
      .map(sentence => sentence.trans)
      .join('');

    if (!translated) {
      throw new Error('Invalid response from Google Translate');
    }

    return {
      translated_text: translated,
      source_lang: sourceLang,
      target_lang: targetLang,
      provider: 'google'
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

  getMaxTextLength(): number {
    return 5000;
  }

  // No known constraints on text type
  supportsText(_text: string): boolean {
    return true;
  }
}
