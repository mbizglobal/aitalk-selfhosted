
import { VOICE_LOCALES, REALTIME_VOICE_LOCALES } from '@/lib/call/voice-locales'

export const LANGUAGES: Array<{ value: string; label: string }> = VOICE_LOCALES.map((l) => ({
  value: l.value,
  label: l.label,
}))

export const AZURE_VOICES_BY_LANG: Record<string, Array<{ value: string; label: string }>> = {
  'de-CH': [
    { value: 'de-CH-LeniNeural', label: 'Leni — Frau (Schweiz)' },
    { value: 'de-CH-JanNeural', label: 'Jan — Mann (Schweiz)' },
  ],
  'de-DE': [
    { value: 'de-DE-KatjaNeural', label: 'Katja — Frau (Deutschland)' },
    { value: 'de-DE-ConradNeural', label: 'Conrad — Mann (Deutschland)' },
  ],
  'fr-CH': [
    { value: 'fr-CH-ArianeNeural', label: 'Ariane — Femme (Suisse)' },
    { value: 'fr-CH-FabriceNeural', label: 'Fabrice — Homme (Suisse)' },
  ],
  'fr-FR': [
    { value: 'fr-FR-DeniseNeural', label: 'Denise — Femme (France)' },
    { value: 'fr-FR-HenriNeural', label: 'Henri — Homme (France)' },
  ],
  'en-US': [
    { value: 'en-US-JennyNeural', label: 'Jenny — Female (US)' },
    { value: 'en-US-GuyNeural', label: 'Guy — Male (US)' },
  ],
  'en-GB': [
    { value: 'en-GB-SoniaNeural', label: 'Sonia — Female (UK)' },
    { value: 'en-GB-RyanNeural', label: 'Ryan — Male (UK)' },
  ],
  'en-AU': [
    { value: 'en-AU-NatashaNeural', label: 'Natasha — Female (Australia)' },
    { value: 'en-AU-WilliamNeural', label: 'William — Male (Australia)' },
  ],
  'de-AT': [
    { value: 'de-AT-IngridNeural', label: 'Ingrid — Frau (Österreich)' },
    { value: 'de-AT-JonasNeural', label: 'Jonas — Mann (Österreich)' },
  ],
  'it-IT': [
    { value: 'it-IT-IsabellaNeural', label: 'Isabella — Donna (Italia)' },
    { value: 'it-IT-DiegoNeural', label: 'Diego — Uomo (Italia)' },
  ],
  'es-ES': [
    { value: 'es-ES-ElviraNeural', label: 'Elvira — Mujer (España)' },
    { value: 'es-ES-AlvaroNeural', label: 'Alvaro — Hombre (España)' },
  ],
  'nl-NL': [
    { value: 'nl-NL-ColetteNeural', label: 'Colette — Vrouw (Nederland)' },
    { value: 'nl-NL-MaartenNeural', label: 'Maarten — Man (Nederland)' },
  ],
  'sv-SE': [
    { value: 'sv-SE-SofieNeural', label: 'Sofie — Kvinna (Sverige)' },
    { value: 'sv-SE-MattiasNeural', label: 'Mattias — Man (Sverige)' },
  ],
  'ko-KR': [
    { value: 'ko-KR-SunHiNeural', label: 'SunHi — 여성 (한국)' },
    { value: 'ko-KR-InJoonNeural', label: 'InJoon — 남성 (한국)' },
  ],
  'ja-JP': [
    { value: 'ja-JP-NanamiNeural', label: 'Nanami — 女性 (日本)' },
    { value: 'ja-JP-KeitaNeural', label: 'Keita — 男性 (日本)' },
  ],
  'da-DK': [
    { value: 'da-DK-ChristelNeural', label: 'Christel — Kvinde (Danmark)' },
    { value: 'da-DK-JeppeNeural', label: 'Jeppe — Mand (Danmark)' },
  ],
  'nb-NO': [
    { value: 'nb-NO-PernilleNeural', label: 'Pernille — Kvinne (Norge)' },
    { value: 'nb-NO-FinnNeural', label: 'Finn — Mann (Norge)' },
  ],
  'fi-FI': [
    { value: 'fi-FI-NooraNeural', label: 'Noora — Nainen (Suomi)' },
    { value: 'fi-FI-HarriNeural', label: 'Harri — Mies (Suomi)' },
  ],
  'pl-PL': [
    { value: 'pl-PL-ZofiaNeural', label: 'Zofia — Kobieta (Polska)' },
    { value: 'pl-PL-MarekNeural', label: 'Marek — Mężczyzna (Polska)' },
  ],
  'cs-CZ': [
    { value: 'cs-CZ-VlastaNeural', label: 'Vlasta — Žena (Česko)' },
    { value: 'cs-CZ-AntoninNeural', label: 'Antonín — Muž (Česko)' },
  ],
  'es-US': [
    { value: 'es-US-PalomaNeural', label: 'Paloma — Mujer (Estados Unidos)' },
    { value: 'es-US-AlonsoNeural', label: 'Alonso — Hombre (Estados Unidos)' },
  ],
  'es-MX': [
    { value: 'es-MX-DaliaNeural', label: 'Dalia — Mujer (México)' },
    { value: 'es-MX-JorgeNeural', label: 'Jorge — Hombre (México)' },
  ],
  'fr-CA': [
    { value: 'fr-CA-SylvieNeural', label: 'Sylvie — Femme (Canada)' },
    { value: 'fr-CA-JeanNeural', label: 'Jean — Homme (Canada)' },
  ],
  'pt-BR': [
    { value: 'pt-BR-FranciscaNeural', label: 'Francisca — Mulher (Brasil)' },
    { value: 'pt-BR-AntonioNeural', label: 'Antonio — Homem (Brasil)' },
  ],
  'zh-CN': [
    { value: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao — 女 (中国)' },
    { value: 'zh-CN-YunxiNeural', label: 'Yunxi — 男 (中国)' },
  ],
  'ms-MY': [
    { value: 'ms-MY-YasminNeural', label: 'Yasmin — Wanita (Malaysia)' },
    { value: 'ms-MY-OsmanNeural', label: 'Osman — Lelaki (Malaysia)' },
  ],
  'id-ID': [
    { value: 'id-ID-GadisNeural', label: 'Gadis — Wanita (Indonesia)' },
    { value: 'id-ID-ArdiNeural', label: 'Ardi — Pria (Indonesia)' },
  ],
  'th-TH': [
    { value: 'th-TH-PremwadeeNeural', label: 'Premwadee — หญิง (ไทย)' },
    { value: 'th-TH-NiwatNeural', label: 'Niwat — ชาย (ไทย)' },
  ],
  'vi-VN': [
    { value: 'vi-VN-HoaiMyNeural', label: 'HoaiMy — Nữ (Việt Nam)' },
    { value: 'vi-VN-NamMinhNeural', label: 'NamMinh — Nam (Việt Nam)' },
  ],
  'hi-IN': [
    { value: 'hi-IN-SwaraNeural', label: 'Swara — महिला (भारत)' },
    { value: 'hi-IN-MadhurNeural', label: 'Madhur — पुरुष (भारत)' },
  ],
}

export const HD_VOICES_BY_LANG: Record<string, Array<{ value: string; label: string }>> = {
  'de-DE': [
    { value: 'de-DE-Seraphina:DragonHDLatestNeural', label: 'Seraphina — Frau (Deutschland, HD)' },
    { value: 'de-DE-Florian:DragonHDLatestNeural', label: 'Florian — Mann (Deutschland, HD)' },
  ],
  'en-GB': [
    { value: 'en-GB-Sonia:DragonHDLatestNeural', label: 'Sonia — Female (UK, HD)' },
    { value: 'en-GB-Ada:DragonHDLatestNeural', label: 'Ada — Female (UK, HD)' },
    { value: 'en-GB-Ryan:DragonHDLatestNeural', label: 'Ryan — Male (UK, HD)' },
    { value: 'en-GB-Ollie:DragonHDLatestNeural', label: 'Ollie — Male (UK, HD)' },
  ],
  'en-US': [
    { value: 'en-US-Ava:DragonHDLatestNeural', label: 'Ava — Female (US, HD)' },
    { value: 'en-US-Ava3:DragonHDLatestNeural', label: 'Ava3 — Female (US, HD)' },
    { value: 'en-US-Aria:DragonHDLatestNeural', label: 'Aria — Female (US, HD)' },
    { value: 'en-US-Emma:DragonHDLatestNeural', label: 'Emma — Female (US, HD)' },
    { value: 'en-US-Emma2:DragonHDLatestNeural', label: 'Emma2 — Female (US, HD)' },
    { value: 'en-US-Jenny:DragonHDLatestNeural', label: 'Jenny — Female (US, HD)' },
    { value: 'en-US-Jane:DragonHDLatestNeural', label: 'Jane — Female (US, HD)' },
    { value: 'en-US-Nova:DragonHDLatestNeural', label: 'Nova — Female (US, HD)' },
    { value: 'en-US-Phoebe:DragonHDLatestNeural', label: 'Phoebe — Female (US, HD)' },
    { value: 'en-US-Serena:DragonHDLatestNeural', label: 'Serena — Female (US, HD)' },
    { value: 'en-US-Bree:DragonHDLatestNeural', label: 'Bree — Female (US, HD)' },
    { value: 'en-US-Andrew:DragonHDLatestNeural', label: 'Andrew — Male (US, HD)' },
    { value: 'en-US-Andrew2:DragonHDLatestNeural', label: 'Andrew2 — Male (US, HD)' },
    { value: 'en-US-Andrew3:DragonHDLatestNeural', label: 'Andrew3 — Male (US, HD)' },
    { value: 'en-US-Brian:DragonHDLatestNeural', label: 'Brian — Male (US, HD)' },
    { value: 'en-US-Davis:DragonHDLatestNeural', label: 'Davis — Male (US, HD)' },
    { value: 'en-US-Adam:DragonHDLatestNeural', label: 'Adam — Male (US, HD)' },
    { value: 'en-US-Alloy:DragonHDLatestNeural', label: 'Alloy — Male (US, HD)' },
    { value: 'en-US-Steffan:DragonHDLatestNeural', label: 'Steffan — Male (US, HD)' },
  ],
  'fr-FR': [
    { value: 'fr-FR-Vivienne:DragonHDLatestNeural', label: 'Vivienne — Femme (France, HD)' },
    { value: 'fr-FR-Remy:DragonHDLatestNeural', label: 'Remy — Homme (France, HD)' },
  ],
  'it-IT': [
    { value: 'it-IT-Isabella:DragonHDLatestNeural', label: 'Isabella — Donna (Italia, HD)' },
    { value: 'it-IT-Alessio:DragonHDLatestNeural', label: 'Alessio — Uomo (Italia, HD)' },
  ],
  'es-ES': [
    { value: 'es-ES-Ximena:DragonHDLatestNeural', label: 'Ximena — Mujer (España, HD)' },
    { value: 'es-ES-Tristan:DragonHDLatestNeural', label: 'Tristan — Hombre (España, HD)' },
  ],
  'es-MX': [
    { value: 'es-MX-Ximena:DragonHDLatestNeural', label: 'Ximena — Mujer (México, HD)' },
    { value: 'es-MX-Tristan:DragonHDLatestNeural', label: 'Tristan — Hombre (México, HD)' },
  ],
  'fr-CA': [
    { value: 'fr-CA-Sylvie:DragonHDLatestNeural', label: 'Sylvie — Femme (Canada, HD)' },
    { value: 'fr-CA-Thierry:DragonHDLatestNeural', label: 'Thierry — Homme (Canada, HD)' },
  ],
  'pt-BR': [
    { value: 'pt-BR-Thalita:DragonHDLatestNeural', label: 'Thalita — Mulher (Brasil, HD)' },
    { value: 'pt-BR-Macerio:DragonHDLatestNeural', label: 'Macerio — Homem (Brasil, HD)' },
  ],
  'ko-KR': [
    { value: 'ko-KR-SunHi:DragonHDLatestNeural', label: 'SunHi — 여성 (한국, HD)' },
    { value: 'ko-KR-Hyunsu:DragonHDLatestNeural', label: 'Hyunsu — 남성 (한국, HD)' },
  ],
  'ja-JP': [
    { value: 'ja-JP-Nanami:DragonHDLatestNeural', label: 'Nanami — 女性 (日本, HD)' },
    { value: 'ja-JP-Masaru:DragonHDLatestNeural', label: 'Masaru — 男性 (日本, HD)' },
  ],
  'zh-CN': [
    { value: 'zh-CN-Xiaochen:DragonHDLatestNeural', label: 'Xiaochen — 女 (中国, HD)' },
    { value: 'zh-CN-Yunfan:DragonHDLatestNeural', label: 'Yunfan — 男 (中国, HD)' },
  ],
}

export const ALL_AZURE_VOICES = Array.from(
  new Map(
    [...Object.values(AZURE_VOICES_BY_LANG), ...Object.values(HD_VOICES_BY_LANG)]
      .flat()
      .map((v) => [v.value, v])
  ).values()
)

export const REALTIME_VOICES: Array<{ value: string; label: string }> = [
  { value: 'realtime:coral', label: 'Coral — Female' },
  { value: 'realtime:sage', label: 'Sage — Female' },
  { value: 'realtime:shimmer', label: 'Shimmer — Female' },
  { value: 'realtime:ash', label: 'Ash — Male' },
  { value: 'realtime:ballad', label: 'Ballad — Male' },
  { value: 'realtime:echo', label: 'Echo — Male' },
  { value: 'realtime:verse', label: 'Verse — Male' },
  { value: 'realtime:alloy', label: 'Alloy — Neutral' },
]

export function isRealtimeVoice(voiceName: string | undefined | null): boolean {
  return typeof voiceName === 'string' && voiceName.startsWith('realtime:')
}

export function isHdVoice(voiceName: string | undefined | null): boolean {
  return typeof voiceName === 'string' && voiceName.includes(':DragonHDLatest')
}

export const REALTIME_MODELS: Array<{
  value: string
  label: string
  descKey: 'pstn_realtime_model_21_desc' | 'pstn_realtime_model_21mini_desc'
  cpaPerMin: number
}> = [
  { value: 'gpt-realtime-2.1', label: 'Realtime 2.1', descKey: 'pstn_realtime_model_21_desc', cpaPerMin: 15 },
  { value: 'gpt-realtime-2.1-mini', label: 'Realtime 2.1 Mini', descKey: 'pstn_realtime_model_21mini_desc', cpaPerMin: 5 },
]

export const REALTIME_LANGUAGES: Array<{ value: string; label: string }> = REALTIME_VOICE_LOCALES.map((l) => ({
  value: l.value,
  label: l.label,
}))

const REALTIME_LANGUAGE_FAMILY_TO_DEFAULT: Record<string, string> = Object.fromEntries(
  REALTIME_LANGUAGES.map((l) => [l.value.split('-')[0], l.value])
)

export function toRealtimeFamilyLocale(locale: string): string | null {
  const family = String(locale || '').split('-')[0]
  return REALTIME_LANGUAGE_FAMILY_TO_DEFAULT[family] ?? null
}

export function getAzureVoicesForLanguage(lang: string) {
  const standard = AZURE_VOICES_BY_LANG[lang]
  const hd = HD_VOICES_BY_LANG[lang]
  if (!standard && !hd) return ALL_AZURE_VOICES
  return [...(standard || []), ...(hd || [])]
}

export function getVoiceGroupsForLanguage(lang: string): {
  standard: Array<{ value: string; label: string }>
  hd: Array<{ value: string; label: string }>
  realtime: Array<{ value: string; label: string }>
} {
  return {
    standard: AZURE_VOICES_BY_LANG[lang] || [],
    hd: HD_VOICES_BY_LANG[lang] || [],
    realtime: REALTIME_VOICES,
  }
}

export function getDefaultVoiceForLocale(locale: string): string | null {
  return AZURE_VOICES_BY_LANG[locale]?.[0]?.value ?? null
}

const FEMALE_LABEL_WORDS = [
  'female', 'frau', 'femme', 'mujer', 'donna', 'mulher', 'kobieta',
  'kvinde', 'kvinna', 'kvinne', 'nainen', 'vrouw', 'wanita', 'žena',
  '여성', '女性', '女', 'महिला', 'หญิง', 'nữ',
]

function isFemaleVoiceLabel(label: string): boolean {
  const lc = label.toLowerCase()
  return FEMALE_LABEL_WORDS.some((w) => lc.includes(w.toLowerCase()))
}

export function getDefaultHdFemaleVoice(lang: string): string {
  const hd = HD_VOICES_BY_LANG[lang] || []
  const std = AZURE_VOICES_BY_LANG[lang] || []
  const hdFemale = hd.find((v) => isFemaleVoiceLabel(v.label))
  if (hdFemale) return hdFemale.value
  const stdFemale = std.find((v) => isFemaleVoiceLabel(v.label))
  if (stdFemale) return stdFemale.value
  return hd[0]?.value || std[0]?.value || ALL_AZURE_VOICES[0]?.value || 'de-CH-LeniNeural'
}
