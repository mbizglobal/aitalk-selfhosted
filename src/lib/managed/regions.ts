//
const MODELS_SWITZERLAND = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-6-luna', 'gpt-6-sol', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini'] as const;

export const MANAGED_REGIONS = [
  { id: 'switzerlandnorth', country: 'Switzerland', flag: '🇨🇭', models: MODELS_SWITZERLAND },
] as const;

export const CLOUD_MANAGED_REGION = 'switzerlandnorth' as const;

const STANDARD_MODELS_BY_REGION: Record<string, string[]> = {
  switzerlandnorth: ['gpt-4.1', 'gpt-4.1-mini'],
};

export function isStandardDeployment(regionId: string, model: string): boolean {
  return STANDARD_MODELS_BY_REGION[regionId]?.includes(model) ?? false;
}

const DATA_ZONE_BY_REGION: Record<string, Record<string, 'eu' | 'us'>> = {
  switzerlandnorth: { 'gpt-6-luna': 'eu', 'gpt-6-sol': 'eu' },
};

export type DataLocationType = 'standard' | 'eu' | 'us' | 'global';

export interface DataLocationInfo {
  type: DataLocationType;
  label: string;
  description: string;
}

export function getDataLocation(regionId: string, model: string): DataLocationInfo {
  const region = getRegionById(regionId);
  const regionName = region?.country || 'Unknown';

  //
  //
  if (model.startsWith('gpt-realtime')) {
    if (model === 'gpt-realtime-2.1' || model === 'gpt-realtime-1.5') {
      return {
        type: 'eu',
        label: 'EU Data Zone (STT: Global)',
        description:
          'Voice processed within the EU/EFTA data boundary (incl. Switzerland). ' +
          'Speech-to-text is processed globally.',
      };
    }
    return {
      type: 'global',
      label: 'Global',
      description: 'May be processed globally.',
    };
  }

  if (isStandardDeployment(regionId, model)) {
    return {
      type: 'standard',
      label: regionName,
      description: `Stored and processed in ${regionName} only.`,
    };
  }

  const dz = DATA_ZONE_BY_REGION[regionId]?.[model];
  if (dz === 'eu') {
    return {
      type: 'eu',
      label: 'EU Data Zone',
      description: `Stored in ${regionName}. Processed within the EU/EFTA data boundary (incl. Switzerland).`,
    };
  }
  if (dz === 'us') {
    return {
      type: 'us',
      label: 'US Data Zone',
      description: `Stored in ${regionName}. Processed within the US data zone.`,
    };
  }

  return {
    type: 'global',
    label: 'Global',
    description: `Stored in ${regionName}. May be processed globally.`,
  };
}

//
//

export type ServiceZone = 'country' | 'eu' | 'us' | 'global';
export type ZoneCountry = 'CH' | 'SE';

export interface ServiceLocationRow {
  key: string;
  label: string;
  zone: ServiceZone;
  country?: ZoneCountry;
  group: 'chat' | 'voice' | 'translate' | 'rag';
}

const REGION_COUNTRY_CODE: Record<string, ZoneCountry> = {
  switzerlandnorth: 'CH',
};

const SERVICE_LABELS: Record<string, string> = {
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 mini',
  'gpt-6-luna': 'GPT-6 Luna',
  'gpt-6-sol': 'GPT-6 Sol',
  'gpt-realtime-2.1': 'Realtime 2.1',
  'gpt-realtime-2.1-mini': 'Realtime 2.1 mini',
};

export function getServiceLocations(regionId: string): ServiceLocationRow[] {
  const region = getRegionById(regionId);
  const cc = REGION_COUNTRY_CODE[regionId];
  if (!region || !cc) return [];

  const rows: ServiceLocationRow[] = region.models.map((model) => {
    const { type } = getDataLocation(regionId, model);
    const zone: ServiceZone = type === 'standard' ? 'country' : type;
    return {
      key: model,
      label: SERVICE_LABELS[model] ?? model,
      zone,
      country: zone === 'country' ? cc : undefined,
      group: model.startsWith('gpt-realtime') ? 'voice' : 'chat',
    };
  });

  //
  //     - Realtime      : `gpt-transcribe`(GlobalStandard) = 🌐 Global
  const fixed: ServiceLocationRow[] = [
    { key: 'stt', label: 'STT (Talk)', zone: 'country', country: 'CH', group: 'voice' },
    { key: 'stt-realtime', label: 'STT (Realtime)', zone: 'global', group: 'voice' },
    { key: 'tts', label: 'TTS Azure', zone: 'country', country: 'CH', group: 'voice' },
    { key: 'tts-hd', label: 'TTS HD', zone: 'country', country: 'SE', group: 'voice' },
  ];
  rows.push(...fixed);

  rows.push({ key: 'translate', label: 'Translation', zone: 'global', group: 'translate' });

  rows.push({ key: 'ai-search', label: 'Azure AI Search', zone: 'country', country: cc, group: 'rag' });

  return rows;
}

export type ManagedRegionId = typeof MANAGED_REGIONS[number]['id'];

export function getRegionById(id: string) {
  return MANAGED_REGIONS.find(r => r.id === id);
}

export function isModelAvailableInRegion(regionId: string, model: string): boolean {
  const region = getRegionById(regionId);
  if (!region) return false;
  return (region.models as readonly string[]).includes(model);
}
