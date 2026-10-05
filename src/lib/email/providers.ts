
export interface EmailProviderConfig {
  id: string
  name: string
  icon?: string
  imap: {
    host: string
    port: number
  }
  smtp: {
    host: string
    port: number
    secure: boolean  // true: SSL (465), false: STARTTLS (587)
  }
  authType: 'password' | 'app_password' | 'oauth2'
  requiresAppPassword?: boolean
  oauth2Available?: boolean
  helpUrl?: string
  note?: string
}

export const EMAIL_PROVIDERS: EmailProviderConfig[] = [
  // === Global Major Providers ===
  {
    id: 'gmail',
    name: 'Gmail / Google Workspace',
    imap: { host: 'imap.gmail.com', port: 993 },
    smtp: { host: 'smtp.gmail.com', port: 587, secure: false },
    authType: 'app_password',
    requiresAppPassword: true,
    helpUrl: 'https://support.google.com/accounts/answer/185833',
    note: 'Requires App Password (2FA must be enabled)'
  },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    imap: { host: 'outlook.office365.com', port: 993 },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    authType: 'oauth2',
    oauth2Available: true,
    helpUrl: 'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353',
    note: 'OAuth2 authentication'
  },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    imap: { host: 'imap.mail.yahoo.com', port: 993 },
    smtp: { host: 'smtp.mail.yahoo.com', port: 587, secure: false },
    authType: 'app_password',
    requiresAppPassword: true,
    helpUrl: 'https://help.yahoo.com/kb/generate-manage-third-party-passwords-sln15241.html'
  },
  {
    id: 'icloud',
    name: 'iCloud Mail (Apple)',
    imap: { host: 'imap.mail.me.com', port: 993 },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    authType: 'app_password',
    requiresAppPassword: true,
    helpUrl: 'https://support.apple.com/en-us/HT204397'
  },
  // === Business / Professional ===
  {
    id: 'zoho',
    name: 'Zoho Mail',
    imap: { host: 'imap.zoho.com', port: 993 },
    smtp: { host: 'smtp.zoho.com', port: 587, secure: false },
    authType: 'password',
    helpUrl: 'https://www.zoho.com/mail/help/imap-access.html'
  },

  // === Europe ===
  // Switzerland
  {
    id: 'hostpoint',
    name: 'Hostpoint (Switzerland)',
    imap: { host: 'imap.mail.hostpoint.ch', port: 993 },
    smtp: { host: 'asmtp.mail.hostpoint.ch', port: 587, secure: false },
    authType: 'password'
  },
  {
    id: 'infomaniak',
    name: 'Infomaniak (Switzerland)',
    imap: { host: 'mail.infomaniak.com', port: 993 },
    smtp: { host: 'mail.infomaniak.com', port: 465, secure: true },
    authType: 'password'
  },
  {
    id: 'swisscom',
    name: 'Swisscom Bluewin (Switzerland)',
    imap: { host: 'imaps.bluewin.ch', port: 993 },
    smtp: { host: 'smtpauths.bluewin.ch', port: 465, secure: true },
    authType: 'password'
  },

  // Germany
  {
    id: 'gmx',
    name: 'GMX (Germany)',
    imap: { host: 'imap.gmx.net', port: 993 },
    smtp: { host: 'mail.gmx.net', port: 587, secure: false },
    authType: 'password'
  },
  {
    id: 'webde',
    name: 'Web.de (Germany)',
    imap: { host: 'imap.web.de', port: 993 },
    smtp: { host: 'smtp.web.de', port: 587, secure: false },
    authType: 'password'
  },
  {
    id: 't-online',
    name: 'T-Online (Germany)',
    imap: { host: 'secureimap.t-online.de', port: 993 },
    smtp: { host: 'securesmtp.t-online.de', port: 465, secure: true },
    authType: 'password'
  },
  {
    id: 'posteo',
    name: 'Posteo (Germany)',
    imap: { host: 'posteo.de', port: 993 },
    smtp: { host: 'posteo.de', port: 587, secure: false },
    authType: 'password'
  },
  {
    id: 'mailbox-org',
    name: 'Mailbox.org (Germany)',
    imap: { host: 'imap.mailbox.org', port: 993 },
    smtp: { host: 'smtp.mailbox.org', port: 587, secure: false },
    authType: 'password'
  },

  // France
  {
    id: 'orange-fr',
    name: 'Orange (France)',
    imap: { host: 'imap.orange.fr', port: 993 },
    smtp: { host: 'smtp.orange.fr', port: 465, secure: true },
    authType: 'password'
  },
  {
    id: 'free-fr',
    name: 'Free (France)',
    imap: { host: 'imap.free.fr', port: 993 },
    smtp: { host: 'smtp.free.fr', port: 465, secure: true },
    authType: 'password'
  },
  {
    id: 'laposte',
    name: 'La Poste (France)',
    imap: { host: 'imap.laposte.net', port: 993 },
    smtp: { host: 'smtp.laposte.net', port: 587, secure: false },
    authType: 'password'
  },
  {
    id: 'sfr',
    name: 'SFR (France)',
    imap: { host: 'imap.sfr.fr', port: 993 },
    smtp: { host: 'smtp.sfr.fr', port: 465, secure: true },
    authType: 'password'
  },

  // === Asia ===
  // Korea
  {
    id: 'naver',
    name: 'Naver (Korea)',
    imap: { host: 'imap.naver.com', port: 993 },
    smtp: { host: 'smtp.naver.com', port: 587, secure: false },
    authType: 'app_password',
    requiresAppPassword: true,
    helpUrl: 'https://help.naver.com/service/5640/contents/8584?lang=ko',
    note: '2FA + App Password required'
  },
  {
    id: 'daum',
    name: 'Daum/Kakao (Korea)',
    imap: { host: 'imap.daum.net', port: 993 },
    smtp: { host: 'smtp.daum.net', port: 465, secure: true },
    authType: 'app_password',
    requiresAppPassword: true,
    helpUrl: 'https://cs.kakao.com/helps?service=52&category=197&locale=ko',
    note: 'App Password required'
  },

  {
    id: 'custom',
    name: 'Custom IMAP/SMTP',
    imap: { host: '', port: 993 },
    smtp: { host: '', port: 587, secure: false },
    authType: 'password'
  }
]

export function getProviderById(id: string): EmailProviderConfig | undefined {
  return EMAIL_PROVIDERS.find(p => p.id === id)
}

export const PROVIDER_GROUPS = [
  {
    label: 'Global',
    providers: ['gmail', 'outlook', 'yahoo', 'icloud', 'zoho']
  },
  {
    label: 'Europe',
    providers: ['hostpoint', 'infomaniak', 'swisscom', 'gmx', 'webde', 't-online', 'posteo', 'mailbox-org', 'orange-fr', 'free-fr', 'laposte', 'sfr']
  },
  {
    label: 'Asia',
    providers: ['naver', 'daum']
  },
  {
    label: 'Other',
    providers: ['custom']
  }
]

export function getGroupedProviders(): Array<{
  label: string
  providers: EmailProviderConfig[]
}> {
  return PROVIDER_GROUPS.map(group => ({
    label: group.label,
    providers: group.providers
      .map(id => EMAIL_PROVIDERS.find(p => p.id === id))
      .filter((p): p is EmailProviderConfig => p !== undefined)
  }))
}
