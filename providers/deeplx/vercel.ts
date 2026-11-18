import { TranslationProvider } from '../types.js';
import type { TranslationResponse } from '../types.js';

// Same language set as @deeplx/core's SUPPORTED_LANGUAGES
const SUPPORTED_LANGUAGES = [
  'AR', 'BG', 'CS', 'DA', 'DE', 'EL', 'EN', 'EN-GB', 'EN-US', 'ES', 'ES-419', 'ET', 'FI', 'FR', 'HE', 'HU',
  'ID', 'IT', 'JA', 'KO', 'LT', 'LV', 'NB', 'NL', 'PL', 'PT', 'PT-BR', 'PT-PT', 'RO', 'RU', 'SK', 'SL', 'SV',
  'TR', 'UK', 'VI', 'ZH', 'ZH-HANS', 'ZH-HANT',
];

export class DeepLXVercelProvider extends TranslationProvider {
  name = 'deeplx-vercel';

  private supportedLanguages = new Set(SUPPORTED_LANGUAGES.map(code => code.toLowerCase()));

  async translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResponse> {
    const url = this.env.DEEPLX_VERCEL_URL;
    if (!url) {
      throw new Error('DEEPLX_VERCEL_URL is not set');
    }
    const response = await fetch(`${url.replace(/\/+$/, '')}/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 
        text,
        target_lang: targetLang,
        source_lang: sourceLang
       }),
    });
    if (!response.ok) {
      throw new Error(`DeepLX Vercel API error: ${response.statusText}`);
    }
    const data = await response.json() as { code: number, data: string, source_lang: string, target_lang: string };
    if (data.code !== 200) {
      throw new Error(`DeepLX Vercel API error: ${JSON.stringify(data)}`);
    }
    return {
      translated_text: data.data,
      source_lang: data.source_lang,
      target_lang: data.target_lang,
      provider: 'deepl'
    };
  }

  supportsLanguage(languageCode: string): boolean {
    return this.supportedLanguages.has(languageCode.toLowerCase());
  }

  isAvailable(): boolean {
    return !!this.env.DEEPLX_VERCEL_URL;
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
