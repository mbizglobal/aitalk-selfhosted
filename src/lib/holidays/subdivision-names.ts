
export const SUBDIVISION_NAMES: Record<string, string> = {
  // Switzerland (26 cantons)
  'CH-AG': 'Aargau',
  'CH-AI': 'Appenzell Innerrhoden',
  'CH-AR': 'Appenzell Ausserrhoden',
  'CH-BE': 'Bern',
  'CH-BL': 'Basel-Landschaft',
  'CH-BS': 'Basel-Stadt',
  'CH-FR': 'Fribourg',
  'CH-GE': 'Geneva',
  'CH-GL': 'Glarus',
  'CH-GR': 'Graubünden',
  'CH-JU': 'Jura',
  'CH-LU': 'Lucerne',
  'CH-NE': 'Neuchâtel',
  'CH-NW': 'Nidwalden',
  'CH-OW': 'Obwalden',
  'CH-SG': 'St. Gallen',
  'CH-SH': 'Schaffhausen',
  'CH-SO': 'Solothurn',
  'CH-SZ': 'Schwyz',
  'CH-TG': 'Thurgau',
  'CH-TI': 'Ticino',
  'CH-UR': 'Uri',
  'CH-VD': 'Vaud',
  'CH-VS': 'Valais',
  'CH-ZG': 'Zug',
  'CH-ZH': 'Zürich',

  // Germany (16 Bundesländer)
  'DE-BW': 'Baden-Württemberg',
  'DE-BY': 'Bavaria',
  'DE-BE': 'Berlin',
  'DE-BB': 'Brandenburg',
  'DE-HB': 'Bremen',
  'DE-HH': 'Hamburg',
  'DE-HE': 'Hesse',
  'DE-MV': 'Mecklenburg-Vorpommern',
  'DE-NI': 'Lower Saxony',
  'DE-NW': 'North Rhine-Westphalia',
  'DE-RP': 'Rhineland-Palatinate',
  'DE-SL': 'Saarland',
  'DE-SN': 'Saxony',
  'DE-ST': 'Saxony-Anhalt',
  'DE-SH': 'Schleswig-Holstein',
  'DE-TH': 'Thuringia',

  // Austria (9 Bundesländer)
  'AT-1': 'Burgenland',
  'AT-2': 'Carinthia',
  'AT-3': 'Lower Austria',
  'AT-4': 'Upper Austria',
  'AT-5': 'Salzburg',
  'AT-6': 'Styria',
  'AT-7': 'Tyrol',
  'AT-8': 'Vorarlberg',
  'AT-9': 'Vienna',

  // United Kingdom
  'GB-ENG': 'England',
  'GB-SCT': 'Scotland',
  'GB-WLS': 'Wales',
  'GB-NIR': 'Northern Ireland',

  // United States — top economic / Managed market states (50 + DC; selective)
  'US-AL': 'Alabama', 'US-AK': 'Alaska', 'US-AZ': 'Arizona', 'US-AR': 'Arkansas',
  'US-CA': 'California', 'US-CO': 'Colorado', 'US-CT': 'Connecticut', 'US-DE': 'Delaware',
  'US-DC': 'District of Columbia', 'US-FL': 'Florida', 'US-GA': 'Georgia', 'US-HI': 'Hawaii',
  'US-ID': 'Idaho', 'US-IL': 'Illinois', 'US-IN': 'Indiana', 'US-IA': 'Iowa',
  'US-KS': 'Kansas', 'US-KY': 'Kentucky', 'US-LA': 'Louisiana', 'US-ME': 'Maine',
  'US-MD': 'Maryland', 'US-MA': 'Massachusetts', 'US-MI': 'Michigan', 'US-MN': 'Minnesota',
  'US-MS': 'Mississippi', 'US-MO': 'Missouri', 'US-MT': 'Montana', 'US-NE': 'Nebraska',
  'US-NV': 'Nevada', 'US-NH': 'New Hampshire', 'US-NJ': 'New Jersey', 'US-NM': 'New Mexico',
  'US-NY': 'New York', 'US-NC': 'North Carolina', 'US-ND': 'North Dakota', 'US-OH': 'Ohio',
  'US-OK': 'Oklahoma', 'US-OR': 'Oregon', 'US-PA': 'Pennsylvania', 'US-RI': 'Rhode Island',
  'US-SC': 'South Carolina', 'US-SD': 'South Dakota', 'US-TN': 'Tennessee', 'US-TX': 'Texas',
  'US-UT': 'Utah', 'US-VT': 'Vermont', 'US-VA': 'Virginia', 'US-WA': 'Washington',
  'US-WV': 'West Virginia', 'US-WI': 'Wisconsin', 'US-WY': 'Wyoming',

  // Australia (8 states/territories)
  'AU-ACT': 'Australian Capital Territory',
  'AU-NSW': 'New South Wales',
  'AU-NT': 'Northern Territory',
  'AU-QLD': 'Queensland',
  'AU-SA': 'South Australia',
  'AU-TAS': 'Tasmania',
  'AU-VIC': 'Victoria',
  'AU-WA': 'Western Australia',

  // Canada (10 provinces + 3 territories)
  'CA-AB': 'Alberta', 'CA-BC': 'British Columbia', 'CA-MB': 'Manitoba', 'CA-NB': 'New Brunswick',
  'CA-NL': 'Newfoundland and Labrador', 'CA-NS': 'Nova Scotia', 'CA-ON': 'Ontario',
  'CA-PE': 'Prince Edward Island', 'CA-QC': 'Quebec', 'CA-SK': 'Saskatchewan',
  'CA-NT': 'Northwest Territories', 'CA-NU': 'Nunavut', 'CA-YT': 'Yukon',
}

export const FEATURED_COUNTRY_CODES: ReadonlyArray<string> = [
  'CH', 'DE', 'AT', 'US', 'GB', 'KR', 'JP', 'SG', 'AU', 'CA', 'FR', 'ES', 'IT', 'NL', 'IE', 'BE', 'NZ',
]

export const ALLOWED_COUNTRY_CODES: ReadonlyArray<string> = [
  // Europe — Western / Central / Southern
  'CH', 'DE', 'AT', 'FR', 'IT', 'ES', 'NL', 'BE', 'LU', 'IE', 'GB', 'PT',
  // Europe — Nordic
  'SE', 'NO', 'DK', 'FI', 'IS',
  // Europe — Central / Eastern (major economies)
  'PL', 'CZ', 'HU', 'GR', 'RO',
  // North America
  'US', 'CA', 'MX',
  // Oceania
  'AU', 'NZ',
  // East Asia (incl. China / Hong Kong / Taiwan)
  'KR', 'JP', 'CN', 'HK', 'TW',
  // Southeast Asia
  'SG', 'MY', 'ID', 'TH', 'VN', 'PH',
  // South Asia
  'IN',
]

export const SUBDIVISION_SUPPORTED_COUNTRIES: ReadonlyArray<string> = [
  'CH', 'DE', 'AT', 'US', 'GB', 'AU', 'CA', 'ES', 'FR', 'IT', 'MX', 'BR',
]

export function getSubdivisionName(code: string): string {
  return SUBDIVISION_NAMES[code] || code
}

export function getSubdivisionsForCountry(countryCode: string): Array<{ code: string; name: string }> {
  const prefix = `${countryCode.toUpperCase()}-`
  return Object.entries(SUBDIVISION_NAMES)
    .filter(([code]) => code.startsWith(prefix))
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
