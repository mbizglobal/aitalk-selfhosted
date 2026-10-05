
import { prisma } from '@/lib/prisma';

// ========================================
// Types
// ========================================

export interface OnboardingResponse {
  message: string;
  buttons?: { label: string; data: string }[];
  completed: boolean;
  agentTitle?: string;
  userName?: string;
}

type OBLang = 'ko' | 'en' | 'de' | 'fr' | 'es';

// ========================================
// Callback data constants
// ========================================

const CB = {
  KEEP_AGENT: 'onboard_keep_agent',
  CHANGE_AGENT: 'onboard_change_agent',
  KEEP_USER: 'onboard_keep_user',
  CHANGE_USER: 'onboard_change_user',
} as const;

// ========================================
// ========================================

type OBMsgKey =
  | 'askAgentName'
  | 'keepBtn'
  | 'changeBtn'
  | 'enterAgentName'
  | 'agentNameSaved'
  | 'askUserName'
  | 'enterUserName'
  | 'userNameSaved'
  | 'greeting';

const OB_MESSAGES: Record<OBMsgKey, Record<OBLang, string>> = {
  askAgentName: {
    ko: '안녕하세요! 먼저 에이전트의 이름을 정해볼까요?\n\n현재 이름: **{agentName}**',
    en: 'Hello! Let\'s start by naming your agent.\n\nCurrent name: **{agentName}**',
    de: 'Hallo! Geben wir Ihrem Agenten zunächst einen Namen.\n\nAktueller Name: **{agentName}**',
    fr: 'Bonjour ! Commençons par nommer votre agent.\n\nNom actuel : **{agentName}**',
    es: '¡Hola! Empecemos dando nombre a tu agente.\n\nNombre actual: **{agentName}**',
  },
  keepBtn: {
    ko: '이대로 유지',
    en: 'Keep as is',
    de: 'So beibehalten',
    fr: 'Garder tel quel',
    es: 'Mantener así',
  },
  changeBtn: {
    ko: '이름 변경',
    en: 'Change name',
    de: 'Name ändern',
    fr: 'Changer le nom',
    es: 'Cambiar nombre',
  },
  enterAgentName: {
    ko: '새로운 에이전트 이름을 입력해주세요.',
    en: 'Please enter a new name for your agent.',
    de: 'Bitte geben Sie einen neuen Namen für Ihren Agenten ein.',
    fr: 'Veuillez entrer un nouveau nom pour votre agent.',
    es: 'Por favor, ingrese un nuevo nombre para su agente.',
  },
  agentNameSaved: {
    ko: '에이전트 이름이 **{agentName}**(으)로 설정되었습니다!',
    en: 'Agent name has been set to **{agentName}**!',
    de: 'Der Name des Agenten wurde auf **{agentName}** gesetzt!',
    fr: 'Le nom de l\'agent a été défini sur **{agentName}** !',
    es: '¡El nombre del agente se ha establecido como **{agentName}**!',
  },
  askUserName: {
    ko: '다음으로, 당신의 이름을 확인해주세요.\n\n현재 이름: **{userName}**',
    en: 'Next, let\'s confirm your name.\n\nCurrent name: **{userName}**',
    de: 'Als Nächstes bestätigen wir Ihren Namen.\n\nAktueller Name: **{userName}**',
    fr: 'Ensuite, confirmons votre nom.\n\nNom actuel : **{userName}**',
    es: 'A continuación, confirmemos tu nombre.\n\nNombre actual: **{userName}**',
  },
  enterUserName: {
    ko: '어떤 이름으로 불러드릴까요?',
    en: 'What name would you like me to call you?',
    de: 'Wie soll ich Sie nennen?',
    fr: 'Comment souhaitez-vous que je vous appelle ?',
    es: '¿Cómo te gustaría que te llame?',
  },
  userNameSaved: {
    ko: '이름이 **{userName}**(으)로 설정되었습니다!',
    en: 'Your name has been set to **{userName}**!',
    de: 'Ihr Name wurde auf **{userName}** gesetzt!',
    fr: 'Votre nom a été défini sur **{userName}** !',
    es: '¡Tu nombre se ha establecido como **{userName}**!',
  },
  greeting: {
    ko: '반갑습니다, **{userName}**님! 저는 **{agentName}**입니다.\n\n무엇이든 물어보세요. 도와드리겠습니다!',
    en: 'Nice to meet you, **{userName}**! I\'m **{agentName}**.\n\nFeel free to ask me anything!',
    de: 'Freut mich, **{userName}**! Ich bin **{agentName}**.\n\nFragen Sie mich gerne alles!',
    fr: 'Ravi de vous rencontrer, **{userName}** ! Je suis **{agentName}**.\n\nN\'hésitez pas à me poser des questions !',
    es: '¡Encantado de conocerte, **{userName}**! Soy **{agentName}**.\n\n¡Pregúntame lo que quieras!',
  },
};

function obMsg(key: OBMsgKey, lang: OBLang, vars?: Record<string, string>): string {
  let msg = OB_MESSAGES[key]?.[lang] || OB_MESSAGES[key]?.en || '';
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return msg;
}

// ========================================
// ========================================

function localeToLang(locale: string | null): OBLang {
  if (!locale) return 'en';
  if (locale.startsWith('ko')) return 'ko';
  if (locale.startsWith('de')) return 'de';
  if (locale.startsWith('fr')) return 'fr';
  if (locale.startsWith('es')) return 'es';
  return 'en';
}

// ========================================
// Main handler
// ========================================

export async function handleOnboarding(
  agentId: string,
  userId: string,
  userInput: string,
): Promise<OnboardingResponse | null> {
  const agent = await prisma.agent.findFirst({
    where: { agentId },
    select: { id: true, agentId: true, title: true, onboardStep: true },
  });
  if (!agent) return null;

  const step = agent.onboardStep;

  if (step >= 5) return null;

  const settings = await prisma.settings.findUnique({
    where: { id: userId },
    select: { locale: true },
  });
  const lang = localeToLang(settings?.locale || null);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const userName = user?.name || 'User';

  switch (step) {
    case 0:
    case 1:
    case 2: {
      await prisma.agent.update({
        where: { id: agent.id },
        data: { onboardStep: 3 },
      });
      return {
        message: obMsg('askUserName', lang, { userName }),
        buttons: [
          { label: obMsg('keepBtn', lang), data: CB.KEEP_USER },
          { label: obMsg('changeBtn', lang), data: CB.CHANGE_USER },
        ],
        completed: false,
      };
    }

    case 3: {
      const input = userInput.trim();

      if (input === CB.CHANGE_USER) {
        await prisma.agent.update({
          where: { id: agent.id },
          data: { onboardStep: 4 },
        });
        return {
          message: obMsg('enterUserName', lang),
          completed: false,
        };
      }

      await prisma.agent.update({
        where: { id: agent.id },
        data: { onboardStep: 5 },
      });

      const freshAgent = await prisma.agent.findFirst({
        where: { agentId },
        select: { title: true },
      });
      const agentName = freshAgent?.title || agent.title;

      return {
        message: obMsg('greeting', lang, { userName, agentName }),
        completed: true,
      };
    }

    case 4: {
      const newName = userInput.trim();
      if (!newName) {
        return {
          message: obMsg('enterUserName', lang),
          completed: false,
        };
      }

      await prisma.user.update({
        where: { id: userId },
        data: { name: newName },
      });

      await prisma.agent.update({
        where: { id: agent.id },
        data: { onboardStep: 5 },
      });

      const freshAgent = await prisma.agent.findFirst({
        where: { agentId },
        select: { title: true },
      });
      const agentName = freshAgent?.title || agent.title;

      const savedMsg = obMsg('userNameSaved', lang, { userName: newName });
      const greetMsg = obMsg('greeting', lang, { userName: newName, agentName });
      return {
        message: `${savedMsg}\n\n${greetMsg}`,
        completed: true,
        userName: newName,
      };
    }

    default:
      return null;
  }
}
