
export const ISO_ALPHA2: readonly string[] = [
  'AD','AE','AF','AG','AL','AM','AO','AR','AT','AU','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ',
  'BN','BO','BR','BS','BT','BW','BY','BZ','CA','CD','CF','CG','CH','CI','CL','CM','CN','CO','CR','CU',
  'CV','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','ER','ES','ET','FI','FJ','FM','FR','GA',
  'GB','GD','GE','GH','GM','GN','GQ','GR','GT','GW','GY','HN','HR','HT','HU','ID','IE','IL','IN','IQ',
  'IR','IS','IT','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KZ','LA','LB','LC','LI',
  'LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MG','MH','MK','ML','MM','MN','MR','MT','MU',
  'MV','MW','MX','MY','MZ','NA','NE','NG','NI','NL','NO','NP','NR','NZ','OM','PA','PE','PG','PH','PK',
  'PL','PT','PW','PY','QA','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SI','SK','SL','SM','SN',
  'SO','SR','SS','ST','SV','SY','SZ','TD','TG','TH','TJ','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','US','UY','UZ','VA','VC','VE','VN','VU','WS','YE','ZA','ZM','ZW',
] as const

export interface CountryOption { code: string; name: string }

export const SERVICE_COUNTRIES: readonly string[] = [
  'AE','AR','AT','AU','BE','BR','CA','CH','CL','CN','CO','CZ','DE','DK','EE','ES','FI','FR','GB','HK',
  'ID','IE','IL','IT','JP','KR','LT','LU','LV','MX','MY','NL','NO','NZ','PH','PL','PT','SA','SE','SG',
  'SI','SK','TH','TW','US','ZA',
] as const

function localizeOptions(codes: readonly string[], lang: string): CountryOption[] {
  const locale = lang === 'de-ch' ? 'de' : lang
  let dn: Intl.DisplayNames | null = null
  try {
    dn = new Intl.DisplayNames([locale], { type: 'region' })
  } catch {
    dn = null
  }
  const options = codes.map((code) => {
    let name = code
    try {
      name = dn?.of(code) || code
    } catch {
      name = code
    }
    return { code, name }
  })
  options.sort((a, b) => a.name.localeCompare(b.name, locale))
  return options
}

export function getCountryOptions(lang: string): CountryOption[] {
  return localizeOptions(ISO_ALPHA2, lang)
}

export function getServiceCountryOptions(lang: string): CountryOption[] {
  return localizeOptions(SERVICE_COUNTRIES, lang)
}
