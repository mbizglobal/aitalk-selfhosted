import { currentEdition } from '@/lib/edition'
export type WidgetLanguage = 'en' | 'de' | 'fr' | 'es' | 'ko'

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/

export function safeColorValue(value: unknown, fallback = '#000000'): string {
  return typeof value === 'string' && HEX_COLOR_REGEX.test(value) ? value : fallback
}

// Widget Button Settings (separate storage for button + welcome message)
export type WidgetButtonSettings = {
  chatButton: {
    backgroundColor: string
    iconType: string
    iconColor: string
    shadowColor: string
    shadowDirection: string
    shadowIntensity: number
    previewTheme: string
    position: string
    horizontalGap: number
    verticalGap: number
    buttonSize: number
    showMode: 'always' | 'topOnly' | 'hidden'
  }
  welcomeMessage?: Record<string, string> | null
  welcomeMessageBackgroundColor: string
  welcomeMessageTextColor: string
  welcomeMessageCloseDelay: number
  customIconData?: string | null
}

export type WidgetSettings = {
  headerTitle: string
  headerBackgroundColor: string
  headerTextColor: string
  // Multi-language support (30 languages)
  initialMessage?: Record<string, string> | null
  initialMessageBackgroundColor: string
  initialMessageTextColor: string
  userMessageBackgroundColor: string
  userMessageTextColor: string
  aiMessageTimeColor: string
  userMessageTimeColor: string
  // Multi-language support (30 languages)
  inputPlaceholder?: Record<string, string> | null
  inputBackgroundColor: string
  inputTextColor: string
  inputBorderColor: string
  inputFocusBorderColor: string
  chatWindowBackgroundColor: string
  poweredByImage: string
  poweredByTextColor: string
  headerIcons: {
    close: string
    newConversation: string
    maximize: string
    minimize: string
  }
  headerIconColors: {
    close: string
    newConversation: string
    maximize: string
    minimize: string
  }
  sendIcon: string
  sendIconColor: string
  // Multi-language support (30 languages) - array of 4 questions
  recommendedQuestions: (Record<string, string> | null)[]
  recommendedQuestionsBackgroundColor: string
  recommendedQuestionsTextColor: string
  loadingIconColor: string
  loadingTextColor: string
  scrollbarThumbColor: string
  scrollbarTrackColor: string
  privacyPolicy: {
    enabled: boolean
    // Multi-language support (30 languages)
    text?: Record<string, string> | null
    linkText?: Record<string, string> | null
    url: string
    textColor: string
    backgroundColor: string
    linkColor: string
  }
  borderColor: string
  customIconData?: string | null
  chatButton: {
    backgroundColor: string
    iconType: string
    iconColor: string
    shadowColor: string
    shadowDirection: string
    shadowIntensity: number
    previewTheme: string
    position: string
    horizontalGap: number
    verticalGap: number
    buttonSize: number
    showMode: 'always' | 'topOnly' | 'hidden'
  }
  // Multi-language support (30 languages)
  welcomeMessage?: Record<string, string> | null
  welcomeMessageBackgroundColor: string
  welcomeMessageTextColor: string
  welcomeMessageCloseDelay: number
}

const SUPPORTED_LANGUAGES: WidgetLanguage[] = ['en', 'de', 'fr', 'es', 'ko']

export function normalizeWidgetLanguage(language?: string | null): WidgetLanguage {
  if (!language) {
    return 'en'
  }

  const lowerCased = language.toLowerCase().replace('_', '-').trim()

  for (const supported of SUPPORTED_LANGUAGES) {
    if (lowerCased === supported) {
      return supported
    }
    if (lowerCased.startsWith(`${supported}-`)) {
      return supported
    }
  }

  return 'en'
}

// Language-specific default values
const getLanguageDefaults = (language: string = 'en') => {
  const normalized = normalizeWidgetLanguage(language)

  const defaults: Record<WidgetLanguage, {
    initialMessage: string
    inputPlaceholder: string
    recommendedQuestion1: string
    privacyPolicyText: string
    privacyPolicyLinkText: string
    welcomeMessage: string
  }> = {
    en: {
      initialMessage: 'Hello! How can I help you today?',
      inputPlaceholder: 'Type your message...',
      recommendedQuestion1: 'What is your most popular product?',
      privacyPolicyText: 'By starting a chat, you agree to our',
      privacyPolicyLinkText: 'Privacy Policy',
      welcomeMessage: 'Welcome! 👋 Feel free to ask me anything.',
    },
    de: {
      initialMessage: 'Hallo! Wie kann ich Ihnen heute helfen?',
      inputPlaceholder: 'Schreiben Sie Ihre Nachricht...',
      recommendedQuestion1: 'Was ist Ihr beliebtestes Produkt?',
      privacyPolicyText: 'Indem Sie den Chat starten, stimmen Sie unserer',
      privacyPolicyLinkText: 'Datenschutzerklärung',
      welcomeMessage: 'Willkommen! 👋 Fragen Sie mich gerne alles.',
    },
    fr: {
      initialMessage: 'Bonjour ! Comment puis-je vous aider aujourd\'hui ?',
      inputPlaceholder: 'Écrivez votre message...',
      recommendedQuestion1: 'Quel est votre produit le plus populaire ?',
      privacyPolicyText: 'En démarrant le chat, vous acceptez notre',
      privacyPolicyLinkText: 'Politique de confidentialité',
      welcomeMessage: 'Bienvenue ! 👋 N\'hésitez pas à me poser vos questions.',
    },
    es: {
      initialMessage: '¡Hola! ¿Cómo puedo ayudarte hoy?',
      inputPlaceholder: 'Escribe tu mensaje...',
      recommendedQuestion1: '¿Cuál es su producto más popular?',
      privacyPolicyText: 'Al iniciar el chat, aceptas nuestra',
      privacyPolicyLinkText: 'Política de Privacidad',
      welcomeMessage: '¡Bienvenido! 👋 Pregúntame lo que quieras.',
    },
    ko: {
      initialMessage: '안녕하세요! 오늘 어떻게 도와드릴까요?',
      inputPlaceholder: '메시지를 입력하세요...',
      recommendedQuestion1: '가장 인기 있는 제품이 무엇인가요?',
      privacyPolicyText: '채팅을 시작하면 다음에 동의하는 것입니다',
      privacyPolicyLinkText: '개인정보 보호정책',
      welcomeMessage: '환영합니다! 👋 무엇이든 물어보세요.',
    },
  }
  return defaults[normalized]
}

export const getDefaultWidgetSettings = (language: string = 'en'): WidgetSettings => {
  const langDefaults = getLanguageDefaults(language)
  const langCode = normalizeWidgetLanguage(language)
  const selfHosted = currentEdition() === 'selfhosted'

  return {
    headerTitle: 'AI Talk',
    headerBackgroundColor: '#1c1c1c',
    headerTextColor: '#ffffff',
    // Multi-language fields initialized with single language
    initialMessage: { [langCode]: langDefaults.initialMessage },
    initialMessageBackgroundColor: '#f1f3f5',
    initialMessageTextColor: '#000000',
    userMessageBackgroundColor: '#000000',
    userMessageTextColor: '#ffffff',
    aiMessageTimeColor: '#999999',
    userMessageTimeColor: '#cccccc',
    // Multi-language fields initialized with single language
    inputPlaceholder: { [langCode]: langDefaults.inputPlaceholder },
    inputBackgroundColor: '#ffffff',
    inputTextColor: '#000000',
    inputBorderColor: '#ccc',
    inputFocusBorderColor: '#000000',
    chatWindowBackgroundColor: '#DBDBDB',
    poweredByImage: 'AITalk02_b.png',
    poweredByTextColor: '#666666',
    headerIcons: {
      close: 'close-svgrepo-w.svg',
      newConversation: 'rotate-ccw-w.svg',
      maximize: 'maximize-1-svgrepo-w.svg',
      minimize: 'minimize-1-svgrepo-w.svg',
    },
    headerIconColors: {
      close: '#ffffff',
      newConversation: '#ffffff',
      maximize: '#ffffff',
      minimize: '#ffffff',
    },
    sendIcon: 'send-b.svg',
    sendIconColor: '#bdbdbd',
    // Multi-language fields initialized with single language (4 questions)
    recommendedQuestions: [{ [langCode]: langDefaults.recommendedQuestion1 }, null, null, null],
    recommendedQuestionsBackgroundColor: '#ffffff',
    recommendedQuestionsTextColor: '#000000',
    loadingIconColor: '#999999',
    loadingTextColor: '#666666',
    scrollbarThumbColor: '#C7C7C7',
    scrollbarTrackColor: '#dbdbdb',
    privacyPolicy: {
      enabled: !selfHosted,
      // Multi-language fields initialized with single language
      text: { [langCode]: langDefaults.privacyPolicyText },
      linkText: { [langCode]: langDefaults.privacyPolicyLinkText },
      url: selfHosted ? '' : 'https://www.aitalk.ch/en/law/privacy-policy',
      textColor: '#555555',
      backgroundColor: '#f8f8f8',
      linkColor: '#007bff',
    },
    borderColor: '#ccc',
    customIconData: null,
    chatButton: {
      backgroundColor: '#000000',
      iconType: 'message-circle',
      iconColor: '#ffffff',
      shadowColor: '#000000',
      shadowDirection: 'bottom-right',
      shadowIntensity: 0.3,
      previewTheme: 'light',
      position: 'right',
      horizontalGap: 20,
      verticalGap: 20,
      buttonSize: 100,
      showMode: 'always',
    },
    welcomeMessage: { [langCode]: langDefaults.welcomeMessage },
    welcomeMessageBackgroundColor: '#ffffff',
    welcomeMessageTextColor: '#1f2937',
    welcomeMessageCloseDelay: 1440,
  }
}

// Keep DEFAULT_WIDGET_SETTINGS for backward compatibility
export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = getDefaultWidgetSettings()

const RECOMMENDED_QUESTIONS_LENGTH = 4

export function normalizeRecommendedQuestions(
  list?: (Record<string, string> | null)[] | string[]
): (Record<string, string> | null)[] {
  // Handle legacy string[] format
  if (Array.isArray(list) && list.length > 0 && typeof list[0] === 'string') {
    // Legacy format: convert string to { en: string }
    return Array.from({ length: RECOMMENDED_QUESTIONS_LENGTH }, (_, index) => {
      const item = list[index]
      if (typeof item === 'string' && item.trim()) {
        return { en: item }
      }
      return null
    })
  }

  // New format: Record<string, string> | null
  return Array.from({ length: RECOMMENDED_QUESTIONS_LENGTH }, (_, index) => {
    if (!list || !list[index]) {
      return DEFAULT_WIDGET_SETTINGS.recommendedQuestions[index]
    }
    return list[index]
  })
}

export function mergeWidgetSettings(raw?: Partial<WidgetSettings> | null): WidgetSettings {
  const incoming = raw ?? {}
  return {
    ...DEFAULT_WIDGET_SETTINGS,
    ...incoming,
    headerIcons: {
      ...DEFAULT_WIDGET_SETTINGS.headerIcons,
      ...(incoming.headerIcons ?? {}),
    },
    // Multi-language field merging
    initialMessage: incoming.initialMessage ?? DEFAULT_WIDGET_SETTINGS.initialMessage,
    inputPlaceholder: incoming.inputPlaceholder ?? DEFAULT_WIDGET_SETTINGS.inputPlaceholder,
    recommendedQuestions: normalizeRecommendedQuestions(incoming.recommendedQuestions),
    privacyPolicy: {
      ...DEFAULT_WIDGET_SETTINGS.privacyPolicy,
      ...(incoming.privacyPolicy ?? {}),
      enabled: incoming.privacyPolicy?.enabled ?? DEFAULT_WIDGET_SETTINGS.privacyPolicy.enabled,
      text: incoming.privacyPolicy?.text ?? DEFAULT_WIDGET_SETTINGS.privacyPolicy.text,
      linkText: incoming.privacyPolicy?.linkText ?? DEFAULT_WIDGET_SETTINGS.privacyPolicy.linkText,
    },
    customIconData:
      typeof incoming.customIconData === 'string' || incoming.customIconData === null
        ? incoming.customIconData
        : DEFAULT_WIDGET_SETTINGS.customIconData,
    chatButton: {
      ...DEFAULT_WIDGET_SETTINGS.chatButton,
      ...(incoming.chatButton ?? {}),
    },
    welcomeMessage: incoming.welcomeMessage ?? DEFAULT_WIDGET_SETTINGS.welcomeMessage,
    welcomeMessageBackgroundColor: incoming.welcomeMessageBackgroundColor ?? DEFAULT_WIDGET_SETTINGS.welcomeMessageBackgroundColor,
    welcomeMessageTextColor: incoming.welcomeMessageTextColor ?? DEFAULT_WIDGET_SETTINGS.welcomeMessageTextColor,
    welcomeMessageCloseDelay: incoming.welcomeMessageCloseDelay ?? DEFAULT_WIDGET_SETTINGS.welcomeMessageCloseDelay,
  }
}

// Widget Button Settings helpers
export function getDefaultWidgetButtonSettings(language: string = 'en'): WidgetButtonSettings {
  const defaults = getDefaultWidgetSettings(language)
  return {
    chatButton: defaults.chatButton,
    welcomeMessage: defaults.welcomeMessage,
    welcomeMessageBackgroundColor: defaults.welcomeMessageBackgroundColor,
    welcomeMessageTextColor: defaults.welcomeMessageTextColor,
    welcomeMessageCloseDelay: defaults.welcomeMessageCloseDelay,
    customIconData: defaults.customIconData,
  }
}

export function mergeWidgetButtonSettings(raw?: Partial<WidgetButtonSettings> | null): WidgetButtonSettings {
  const incoming = raw ?? {}
  const defaults = getDefaultWidgetButtonSettings()
  return {
    chatButton: {
      ...defaults.chatButton,
      ...(incoming.chatButton ?? {}),
    },
    welcomeMessage: incoming.welcomeMessage ?? defaults.welcomeMessage,
    welcomeMessageBackgroundColor: incoming.welcomeMessageBackgroundColor ?? defaults.welcomeMessageBackgroundColor,
    welcomeMessageTextColor: incoming.welcomeMessageTextColor ?? defaults.welcomeMessageTextColor,
    welcomeMessageCloseDelay: incoming.welcomeMessageCloseDelay ?? defaults.welcomeMessageCloseDelay,
    customIconData:
      typeof incoming.customIconData === 'string' || incoming.customIconData === null
        ? incoming.customIconData
        : defaults.customIconData,
  }
}

// Extract button settings from full widget settings
export function extractButtonSettings(settings: WidgetSettings): WidgetButtonSettings {
  return {
    chatButton: settings.chatButton,
    welcomeMessage: settings.welcomeMessage,
    welcomeMessageBackgroundColor: settings.welcomeMessageBackgroundColor,
    welcomeMessageTextColor: settings.welcomeMessageTextColor,
    welcomeMessageCloseDelay: settings.welcomeMessageCloseDelay,
    customIconData: settings.customIconData,
  }
}

// Extract chat settings (exclude button-related fields)
export function extractChatSettings(settings: WidgetSettings): Omit<WidgetSettings, 'chatButton' | 'welcomeMessage' | 'welcomeMessageBackgroundColor' | 'welcomeMessageTextColor' | 'welcomeMessageCloseDelay' | 'customIconData'> {
  const { chatButton, welcomeMessage, welcomeMessageBackgroundColor, welcomeMessageTextColor, welcomeMessageCloseDelay, customIconData, ...chatSettings } = settings
  return chatSettings
}
