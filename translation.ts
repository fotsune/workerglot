import { GoogleTranslateProvider, DeepLXProvider, DeepLXCloudflareProvider, BingTranslateProvider, AzureProvider, DeepLProvider, DeepLXVercelProvider, AWSProvider, LibreTranslateProvider } from './providers/index.js';
import type { TranslationProvider, TranslationResponse } from './providers/index.js';
import type { Env } from './config.js';

const DEFAULT_TIMEOUT_MS = 15000;

export class TranslationService {
  private allProviders: TranslationProvider[];

  private availableProviders: TranslationProvider[];

  private timeoutMs: number;

  // PREFER_PAID=true puts configured paid providers ahead of the free ones.
  private preferPaid: boolean;

  constructor(env: Env = {}) {
    this.allProviders = [
      new GoogleTranslateProvider(env),
      new DeepLXProvider(env),
      new DeepLXCloudflareProvider(env),
      new DeepLXVercelProvider(env),
      new BingTranslateProvider(env),
      new AzureProvider(env),
      new DeepLProvider(env),
      new AWSProvider(env),
      new LibreTranslateProvider(env),
    ];

    this.timeoutMs = env.REQUEST_TIMEOUT_MS ? Number(env.REQUEST_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;

    const preferPaidRaw = (env.PREFER_PAID ?? '').trim().toLowerCase();
    this.preferPaid = ['1', 'true', 'yes', 'on'].includes(preferPaidRaw);

    // Only include providers that are available (have required configuration)
    this.availableProviders = this.allProviders.filter(provider => {
      const isAvailable = provider.isAvailable();
      if (!isAvailable) {
        console.log(`Provider ${provider.name} not configured`);
      }
      return isAvailable;
    });

    console.log(`Initialized with ${this.availableProviders.length} available providers: ${this.availableProviders.map(p => p.name).join(', ')}`);
  }

  // Get providers that support the target language and can handle the text length, separated by free/paid
  private getProvidersForLanguage(targetLang: string, text: string): { free: TranslationProvider[], paid: TranslationProvider[] } {
    const compatibleProviders = this.availableProviders.filter(provider => {
      const supportsLanguage = provider.supportsLanguage(targetLang);
      const canHandleText = provider.supportsText(text);
      const canHandleLength = provider.getMaxTextLength() >= text.length;
      
      if (!supportsLanguage) {
        console.log(`Provider ${provider.name} does not support language: ${targetLang}`);
      }
      if (!canHandleLength) {
        console.log(`Provider ${provider.name} cannot handle text length ${text.length} (max: ${provider.getMaxTextLength()})`);
      }
      if (!canHandleText) {
        console.log(`Provider ${provider.name} cannot handle text: ${text}`);
      }
      
      return supportsLanguage && canHandleLength && canHandleText;
    });

    const free = compatibleProviders.filter(provider => provider.isFree());
    const paid = compatibleProviders.filter(provider => !provider.isFree());

    return { free, paid };
  }

  private selectProvider(targetLang: string, text: string): TranslationProvider | null {
    const { free, paid } = this.getProvidersForLanguage(targetLang, text);
    const groups: Array<[string, TranslationProvider[]]> = this.preferPaid
      ? [['paid', paid], ['free', free]]
      : [['free', free], ['paid', paid]];

    for (const [kind, group] of groups) {
      if (group.length === 0) continue;
      const randomIndex = Math.floor(Math.random() * group.length);
      console.log(`Selected ${kind} provider: ${group[randomIndex]?.name} (${group.length} ${kind} providers available, preferPaid=${this.preferPaid})`);
      return group[randomIndex] || null;
    }

    return null;
  }

  // Get other providers for fallback, in the same order the primary one was picked
  private getOtherProviders(excludeProvider: TranslationProvider, targetLang: string, text: string): TranslationProvider[] {
    const { free, paid } = this.getProvidersForLanguage(targetLang, text);
    
    // Remove the excluded provider from both lists
    const availableFree = free.filter(provider => provider !== excludeProvider);
    const availablePaid = paid.filter(provider => provider !== excludeProvider);
    
    // PREFER_PAID keeps the paid providers ahead in the fallback chain too
    return this.preferPaid
      ? [...availablePaid, ...availableFree]
      : [...availableFree, ...availablePaid];
  }

  // Workers kill an over-long request on the platform side, so each attempt gets a deadline.
  private withTimeout<T>(promise: Promise<T>, providerName: string): Promise<T> {
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      return promise;
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${providerName} timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs
      );
      promise.then(
        value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(error); }
      );
    });
  }

  async translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResponse> {
    const textLength = text.length;
    const primaryProvider = this.selectProvider(targetLang, text);
    
    if (!primaryProvider) {
      throw new Error(`No providers available for language: ${targetLang}, length ${textLength} chars`);
    }

    const fallbackProviders = this.getOtherProviders(primaryProvider, targetLang, text);

    // Try primary provider
    try {
      console.log(`Attempting translation with ${primaryProvider.name} for language ${targetLang}`);
      return await this.withTimeout(primaryProvider.translate(text, targetLang, sourceLang), primaryProvider.name);
    } catch (error) {
      console.error(`${primaryProvider.name} failed:`, error);

      // Try fallback providers so at least we get SOMETHING
      for (const provider of fallbackProviders) {
        try {
          console.log(`Falling back to ${provider.name} for language ${targetLang}`);
          return await this.withTimeout(provider.translate(text, targetLang, sourceLang), provider.name);
        } catch (fallbackError) {
          console.error(`${provider.name} fallback failed:`, fallbackError);
        }
      }

      // well this sucks lol
      throw new Error('All translation providers failed');
    }
  }
}

/** One service per bindings object; the Worker calls this once per request. */
export const createTranslationService = (env: Env) => new TranslationService(env);
