import { prisma } from '@/lib/prisma';
import { decryptData } from '@/lib/encryption';

//
//
//
//
const globalForManagedRegion = globalThis as unknown as {
  aitalkManagedRegionConfigCache: Map<string, { config: ManagedAzureConfig; expiry: number }> | undefined;
};

const regionConfigCache =
  globalForManagedRegion.aitalkManagedRegionConfigCache ??
  new Map<string, { config: ManagedAzureConfig; expiry: number }>();

globalForManagedRegion.aitalkManagedRegionConfigCache = regionConfigCache;

const CACHE_TTL = 5 * 60 * 1000;

export interface ManagedAzureConfig {
  readonly apiKey: string;
  readonly endpoint: string;
  readonly apiVersion: string;
  readonly searchApiKey?: string;
  readonly searchEndpoint?: string;
  readonly docIntelligenceKey?: string;
  readonly docIntelligenceEndpoint?: string;
  readonly speechApiKey?: string;
  readonly speechEndpoint?: string;
  readonly speechRegion?: string;
  readonly speechHdApiKey?: string;
  readonly speechHdEndpoint?: string;
  readonly speechHdRegion?: string;
  readonly realtimeApiKey?: string;
  readonly realtimeEndpoint?: string;
  readonly realtimeDeployment?: string;
  readonly realtimeApiVersion?: string;
  readonly realtimeDeployments?: string;
}

export async function getManagedAzureConfig(region: string): Promise<ManagedAzureConfig> {
  const cached = regionConfigCache.get(region);
  if (cached && cached.expiry > Date.now()) {
    return Object.freeze(cached.config);
  }

  if (cached) {
    regionConfigCache.delete(region);
  }

  const regionConfig = await prisma.managedRegionConfig.findUnique({
    where: { regionId: region },
  });

  if (!regionConfig || !regionConfig.enabled) {
    throw new Error(`Managed region "${region}" is not configured or disabled`);
  }

  const apiKey = await decryptData(regionConfig.openaiApiKey);

  let searchApiKey: string | undefined;
  if (regionConfig.searchApiKey) {
    searchApiKey = await decryptData(regionConfig.searchApiKey);
  }

  let docIntelligenceKey: string | undefined;
  if (regionConfig.docIntelligenceKey) {
    docIntelligenceKey = await decryptData(regionConfig.docIntelligenceKey);
  }

  let speechApiKey: string | undefined;
  if (regionConfig.speechApiKey) {
    speechApiKey = await decryptData(regionConfig.speechApiKey);
  }

  let speechHdApiKey: string | undefined;
  if (regionConfig.speechHdApiKey) {
    speechHdApiKey = await decryptData(regionConfig.speechHdApiKey);
  }

  let realtimeApiKey: string | undefined;
  if (regionConfig.realtimeApiKey) {
    realtimeApiKey = await decryptData(regionConfig.realtimeApiKey);
  }

  const config: ManagedAzureConfig = Object.freeze({
    apiKey,
    endpoint: regionConfig.openaiEndpoint,
    apiVersion: process.env.MANAGED_AZURE_API_VERSION || '2025-03-01-preview',
    searchApiKey,
    searchEndpoint: regionConfig.searchEndpoint || undefined,
    docIntelligenceKey,
    docIntelligenceEndpoint: regionConfig.docIntelligenceEndpoint || undefined,
    speechApiKey,
    speechEndpoint: regionConfig.speechEndpoint || undefined,
    speechRegion: regionConfig.speechRegion || undefined,
    speechHdApiKey,
    speechHdEndpoint: regionConfig.speechHdEndpoint || undefined,
    speechHdRegion: regionConfig.speechHdRegion || undefined,
    realtimeApiKey,
    realtimeEndpoint: regionConfig.realtimeEndpoint || undefined,
    realtimeDeployment: regionConfig.realtimeDeployment || undefined,
    realtimeApiVersion: regionConfig.realtimeApiVersion || undefined,
    realtimeDeployments: regionConfig.realtimeDeployments || undefined,
  });

  regionConfigCache.set(region, { config, expiry: Date.now() + CACHE_TTL });

  return config;
}

export function invalidateRegionConfigCache(regionId?: string) {
  if (regionId) {
    regionConfigCache.delete(regionId);
  } else {
    regionConfigCache.clear();
  }
}
