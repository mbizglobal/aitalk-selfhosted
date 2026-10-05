import { translations as enTranslations } from './main/en';
import { translations as deTranslations } from './main/de';
import { translations as deChTranslations } from './main/de-ch';
import { translations as frTranslations } from './main/fr';
import { translations as esTranslations } from './main/es';
import { translations as koTranslations } from './main/ko';
import { translations as jaTranslations } from './main/ja';
import { translations as appEnTranslations } from './app/en';
import { translations as appDeTranslations } from './app/de';
import { translations as appFrTranslations } from './app/fr';
import { translations as appEsTranslations } from './app/es';
import { translations as appKoTranslations } from './app/ko';
import { translations as appJaTranslations } from './app/ja';
import { translations as dashboardEnTranslations } from './dashboard/en';
import { translations as dashboardDeTranslations } from './dashboard/de';
import { translations as dashboardFrTranslations } from './dashboard/fr';
import { translations as dashboardEsTranslations } from './dashboard/es';
import { translations as dashboardKoTranslations } from './dashboard/ko';

export const translations = {
  en: { ...enTranslations.en, ...appEnTranslations.en, ...dashboardEnTranslations.en },
  de: { ...deTranslations.de, ...appDeTranslations.de, ...dashboardDeTranslations.de },
  'de-ch': { ...deChTranslations['de-ch'], ...appDeTranslations.de, ...dashboardDeTranslations.de },
  fr: { ...frTranslations.fr, ...appFrTranslations.fr, ...dashboardFrTranslations.fr },
  es: { ...esTranslations.es, ...appEsTranslations.es, ...dashboardEsTranslations.es },
  ko: { ...koTranslations.ko, ...appKoTranslations.ko, ...dashboardKoTranslations.ko },
  ja: { ...jaTranslations.ja, ...appJaTranslations.ja },
};

export const pricingPlans = [
  {
    id: 'free',
    name: 'Free Plan',
    priceUSD: 0,
    priceEUR: 0,
    priceCHF: 0,
    quarterlyPriceEUR: 0,
    quarterlyPriceCHF: 0,
    billing: 'free',
    freeTrial: 0,
    aiAgents: 1,
    messagesPerMonth: 50,
    conversationHistory: '3 days',
    branding: 'Powered by AI Talk',
    teamMembers: 5,
    productionWorkflows: 1
  },
  {
    id: 'starter',
    name: 'Starter Plan',
    priceUSD: 35,
    priceEUR: 29,
    priceCHF: 29,
    quarterlyPriceEUR: 87,
    quarterlyPriceCHF: 87,
    billing: 'monthly',
    freeTrial: 0,
    aiAgents: 1,
    messagesPerMonth: 5000,
    conversationHistory: '90 days',
    branding: 'Powered by AI Talk',
    teamMembers: 20,
    productionWorkflows: 10
  },
  {
    id: 'standard',
    name: 'Standard Plan',
    priceUSD: 69,
    priceEUR: 59,
    priceCHF: 59,
    quarterlyPriceEUR: 177,
    quarterlyPriceCHF: 177,
    billing: 'monthly',
    freeTrial: 0,
    aiAgents: 2,
    messagesPerMonth: 10000,
    conversationHistory: '90 days',
    branding: 'Powered by AI Talk',
    teamMembers: 40,
    productionWorkflows: 20
  },
  {
    id: 'growth',
    name: 'Growth Plan',
    priceUSD: 119,
    priceEUR: 99,
    priceCHF: 99,
    quarterlyPriceEUR: 297,
    quarterlyPriceCHF: 297,
    billing: 'monthly',
    freeTrial: 0,
    aiAgents: 3,
    messagesPerMonth: 20000,
    conversationHistory: '90 days',
    branding: 'Logo removed',
    teamMembers: 80,
    productionWorkflows: 30
  },
  {
    id: 'pro',
    name: 'Pro Plan',
    priceUSD: 219,
    priceEUR: 189,
    priceCHF: 189,
    quarterlyPriceEUR: 567,
    quarterlyPriceCHF: 567,
    billing: 'monthly',
    freeTrial: 0,
    aiAgents: 4,
    messagesPerMonth: 40000,
    conversationHistory: '90 days',
    branding: 'Logo removed',
    teamMembers: 160,
    productionWorkflows: 40
  }
];

export const managedPricingPlans = [
  {
    id: 'starter',
    name: 'Starter Plan',
    priceEUR: 40,
    priceCHF: 40,
    priceUSD: 49,
    priceGBP: 39,
    priceCAD: 59,
    priceAUD: 65,
    priceJPY: 6980,
    priceKRW: 59000,
    priceSGD: 55,
    quarterlyPriceEUR: 120,
    quarterlyPriceCHF: 120,
    quarterlyPriceUSD: 147,
    quarterlyPriceGBP: 117,
    quarterlyPriceCAD: 177,
    quarterlyPriceAUD: 195,
    quarterlyPriceJPY: 20940,
    quarterlyPriceSGD: 165,
    billing: 'monthly',
    aiAgents: 1,
    messagesPerMonth: 1000,
    teamMembers: 40,
    totalWorkflows: 0,
    activeWorkflows: 10,
    storagePerAgent: '10MB',
    storageBytes: 10485760,
    docPagesPerMonth: 200,
    latestModels: true,
    includesVectorDB: true,
    conversationHistoryDays: 90,
  },
  {
    id: 'standard',
    name: 'Standard Plan',
    priceEUR: 150,
    priceCHF: 150,
    priceUSD: 179,
    priceGBP: 139,
    priceCAD: 219,
    priceAUD: 239,
    priceJPY: 25800,
    priceKRW: 219000,
    priceSGD: 199,
    quarterlyPriceEUR: 450,
    quarterlyPriceCHF: 450,
    quarterlyPriceUSD: 537,
    quarterlyPriceGBP: 417,
    quarterlyPriceCAD: 657,
    quarterlyPriceAUD: 717,
    quarterlyPriceJPY: 77400,
    quarterlyPriceSGD: 597,
    billing: 'monthly',
    aiAgents: 2,
    messagesPerMonth: 6000,
    teamMembers: 150,
    totalWorkflows: 0,
    activeWorkflows: 20,
    storagePerAgent: '20MB',
    storageBytes: 20971520,
    docPagesPerMonth: 1000,
    latestModels: true,
    includesVectorDB: true,
    conversationHistoryDays: 90,
  },
  {
    id: 'pro',
    name: 'Pro Plan',
    priceEUR: 500,
    priceCHF: 500,
    priceUSD: 579,
    priceGBP: 459,
    priceCAD: 749,
    priceAUD: 799,
    priceJPY: 85800,
    priceKRW: 729000,
    priceSGD: 699,
    quarterlyPriceEUR: 1500,
    quarterlyPriceCHF: 1500,
    quarterlyPriceUSD: 1737,
    quarterlyPriceGBP: 1377,
    quarterlyPriceCAD: 2247,
    quarterlyPriceAUD: 2397,
    quarterlyPriceJPY: 257400,
    quarterlyPriceSGD: 2097,
    billing: 'monthly',
    aiAgents: 4,
    messagesPerMonth: 22000,
    teamMembers: 500,
    totalWorkflows: 0,
    activeWorkflows: 40,
    storagePerAgent: '40MB',
    storageBytes: 41943040,
    docPagesPerMonth: 4000,
    latestModels: true,
    includesVectorDB: true,
    conversationHistoryDays: 90,
  },
];

export type Language = keyof typeof translations;
export const supportedLanguages: Language[] = ['en', 'de', 'de-ch', 'fr', 'ko'];

export function getApiTranslation(request: Request | { headers: Headers }) {
  const headers = 'headers' in request ? request.headers : request.headers;
  const acceptLanguage = (headers.get('accept-language') || headers.get('Accept-Language') || 'en').toLowerCase();

  let language: Language = 'en';

  if (acceptLanguage.includes('de-ch') || acceptLanguage.includes('gsw')) {
    language = 'de-ch';
  } else if (acceptLanguage.includes('de')) {
    language = 'de';
  } else if (acceptLanguage.includes('fr')) {
    language = 'fr';
  } else if (acceptLanguage.includes('es')) {
    language = 'es';
  } else if (acceptLanguage.includes('ko')) {
    language = 'ko';
  }

  const t = translations[language];

  return (key: string): string => {
    return (t as any)[key] || key;
  };
}