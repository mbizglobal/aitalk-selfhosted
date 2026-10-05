import { getAppBaseUrl } from '@/lib/app-url'
import { isSelfHosted } from '@/lib/edition'
import { getFeedbackRecipient } from '@/lib/brand'
import { translations, Language } from '@/lib/translations'
import { EmailClient } from '@azure/communication-email'
import { sendRoutedEmail } from '@/lib/email-routing'

// Azure ACS Email client
const connectionString = process.env.ACS_CONNECTION_STRING
const emailClient = connectionString ? new EmailClient(connectionString) : null

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function safeLang(language: unknown): Language {
  return typeof language === 'string' && Object.prototype.hasOwnProperty.call(translations, language)
    ? (language as Language)
    : 'en'
}

interface EmailResponse {
  success: boolean
  messageId?: string
  error?: string
}

export class EmailService {
  private fromEmail: string

  constructor() {
    this.fromEmail = process.env.ACS_FROM_EMAIL || 'support@aitalk.ch'

    if (!connectionString && !isSelfHosted()) {
      console.warn('ACS_CONNECTION_STRING not configured')
    }
  }

  private async sendEmail(data: {
    to: string
    subject: string
    html: string
    from?: string
  }): Promise<EmailResponse> {
    return sendRoutedEmail(data, this.fromEmail, (d) => this.sendViaAcs(d))
  }

  private async sendViaAcs(data: {
    to: string
    subject: string
    html: string
    from?: string
  }): Promise<EmailResponse> {
    if (!emailClient) {
      return { success: false, error: 'ACS Email client not configured' }
    }

    try {
      const poller = await emailClient.beginSend({
        senderAddress: data.from || this.fromEmail,
        content: { subject: data.subject, html: data.html },
        recipients: { to: [{ address: data.to }] },
      })

      const result = await poller.pollUntilDone()

      if (result.status === 'Succeeded') {
        return { success: true, messageId: result.id }
      }
      return { success: false, error: `Email send status: ${result.status}` }
    } catch (error) {
      console.error('[EmailService] Send error:', error instanceof Error ? error.message : String(error))
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  private getBaseStyles(): string {
    return `
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.6;
        color: #333;
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
        background-color: #f5f5f5;
      }
      .email-container {
        background-color: #ffffff;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }
      .header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 40px 20px;
        text-align: center;
      }
      .header h1 {
        margin: 0 0 10px 0;
        font-size: 28px;
        font-weight: 600;
      }
      .logo {
        margin-bottom: 15px;
        font-size: 48px;
      }
      .content {
        padding: 40px 30px;
      }
      .greeting {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 20px;
        color: #333;
      }
      .message {
        font-size: 16px;
        color: #555;
        margin-bottom: 30px;
        line-height: 1.8;
      }
      .cta-button {
        display: inline-block;
        padding: 14px 30px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 600;
        font-size: 16px;
        margin-bottom: 20px;
      }
      .footer {
        background-color: #f9f9f9;
        padding: 30px;
        text-align: center;
        border-top: 1px solid #e0e0e0;
      }
      .footer-brand {
        font-size: 20px;
        font-weight: 700;
        color: #667eea;
        margin-bottom: 10px;
      }
      .footer-copyright {
        font-size: 12px;
        color: #999;
        margin-top: 15px;
      }
      .details-box {
        background-color: #f9f9f9;
        border-left: 4px solid #667eea;
        border-radius: 4px;
        padding: 20px;
        margin-bottom: 30px;
      }
      .info-box {
        background-color: #e3f2fd;
        border-left: 4px solid #2196f3;
        border-radius: 4px;
        padding: 15px 20px;
        margin-bottom: 30px;
      }
      .warning-box {
        background-color: #fff3cd;
        border-left: 4px solid #ffc107;
        border-radius: 4px;
        padding: 15px 20px;
        margin-bottom: 30px;
      }
    `
  }

  private getEmailTexts(language: Language) {
    const texts: Record<Language, {
      verification: { subject: string; title: string; greeting: string; message: string; button: string; footer: string }
      welcome: { subject: string; title: string; greeting: string; message: string; button: string; footer: string }
      passwordReset: { subject: string; title: string; greeting: string; message: string; button: string; footer: string; expiry: string }
      teamInvitation: { subject: string; title: string; greeting: string; message: string; button: string; footer: string }
      feedback: { subject: string; title: string }
      anonymizationScheduled: { subject: string; title: string; greeting: string; message: string; button: string; footer: string }
      anonymizationCompleted: { subject: string; title: string; greeting: string; message: string; footer: string }
    }> = {
      en: {
        verification: {
          subject: 'Verify your email - AITalk.ch',
          title: 'Email Verification',
          greeting: 'Hello',
          message: 'Thank you for registering with AITalk.ch. Please click the button below to verify your email address.',
          button: 'Verify Email',
          footer: 'If you did not create an account, you can safely ignore this email.'
        },
        welcome: {
          subject: 'Welcome to AITalk.ch!',
          title: 'Welcome!',
          greeting: 'Hello',
          message: 'Welcome to AITalk.ch! Your account has been successfully created. Start creating your AI agents today.',
          button: 'Get Started',
          footer: 'Thank you for joining us!'
        },
        passwordReset: {
          subject: 'Reset your password - AITalk.ch',
          title: 'Password Reset',
          greeting: 'Hello',
          message: 'We received a request to reset your password. Click the button below to create a new password.',
          button: 'Reset Password',
          footer: 'If you did not request a password reset, you can safely ignore this email.',
          expiry: 'This link will expire in 1 hour.'
        },
        teamInvitation: {
          subject: 'You\'ve been invited to collaborate - AITalk.ch',
          title: 'Team Invitation',
          greeting: 'Hello',
          message: 'You have been invited to collaborate on an AI agent. Click the button below to accept the invitation.',
          button: 'Accept Invitation',
          footer: 'If you don\'t want to join, you can ignore this email.'
        },
        feedback: {
          subject: 'New Feedback - AITalk.ch',
          title: 'User Feedback'
        },
        anonymizationScheduled: {
          subject: 'Account deletion scheduled - AITalk.ch',
          title: 'Account Deletion Scheduled',
          greeting: 'Hello',
          message: 'Your account deletion has been scheduled. All your data will be permanently deleted on the date shown below.',
          button: 'Cancel Deletion',
          footer: 'If you change your mind, you can cancel the deletion before the scheduled date.'
        },
        anonymizationCompleted: {
          subject: 'Account deleted - AITalk.ch',
          title: 'Account Deleted',
          greeting: 'Hello',
          message: 'Your account and all associated data have been permanently deleted. Thank you for using AITalk.ch.',
          footer: 'We\'re sorry to see you go. You\'re always welcome back!'
        }
      },
      de: {
        verification: {
          subject: 'E-Mail bestätigen - AITalk.ch',
          title: 'E-Mail-Verifizierung',
          greeting: 'Hallo',
          message: 'Vielen Dank für Ihre Registrierung bei AITalk.ch. Bitte klicken Sie auf die Schaltfläche unten, um Ihre E-Mail-Adresse zu bestätigen.',
          button: 'E-Mail bestätigen',
          footer: 'Wenn Sie kein Konto erstellt haben, können Sie diese E-Mail ignorieren.'
        },
        welcome: {
          subject: 'Willkommen bei AITalk.ch!',
          title: 'Willkommen!',
          greeting: 'Hallo',
          message: 'Willkommen bei AITalk.ch! Ihr Konto wurde erfolgreich erstellt. Beginnen Sie noch heute mit der Erstellung Ihrer KI-Agenten.',
          button: 'Loslegen',
          footer: 'Vielen Dank, dass Sie sich uns anschließen!'
        },
        passwordReset: {
          subject: 'Passwort zurücksetzen - AITalk.ch',
          title: 'Passwort zurücksetzen',
          greeting: 'Hallo',
          message: 'Wir haben eine Anfrage zum Zurücksetzen Ihres Passworts erhalten. Klicken Sie auf die Schaltfläche unten, um ein neues Passwort zu erstellen.',
          button: 'Passwort zurücksetzen',
          footer: 'Wenn Sie kein Passwort-Reset angefordert haben, können Sie diese E-Mail ignorieren.',
          expiry: 'Dieser Link läuft in 1 Stunde ab.'
        },
        teamInvitation: {
          subject: 'Sie wurden zur Zusammenarbeit eingeladen - AITalk.ch',
          title: 'Team-Einladung',
          greeting: 'Hallo',
          message: 'Sie wurden eingeladen, an einem KI-Agenten mitzuarbeiten. Klicken Sie auf die Schaltfläche unten, um die Einladung anzunehmen.',
          button: 'Einladung annehmen',
          footer: 'Wenn Sie nicht beitreten möchten, können Sie diese E-Mail ignorieren.'
        },
        feedback: {
          subject: 'Neues Feedback - AITalk.ch',
          title: 'Benutzer-Feedback'
        },
        anonymizationScheduled: {
          subject: 'Kontolöschung geplant - AITalk.ch',
          title: 'Kontolöschung geplant',
          greeting: 'Hallo',
          message: 'Ihre Kontolöschung wurde geplant. Alle Ihre Daten werden am unten angegebenen Datum dauerhaft gelöscht.',
          button: 'Löschung abbrechen',
          footer: 'Wenn Sie Ihre Meinung ändern, können Sie die Löschung vor dem geplanten Datum abbrechen.'
        },
        anonymizationCompleted: {
          subject: 'Konto gelöscht - AITalk.ch',
          title: 'Konto gelöscht',
          greeting: 'Hallo',
          message: 'Ihr Konto und alle zugehörigen Daten wurden dauerhaft gelöscht. Vielen Dank für die Nutzung von AITalk.ch.',
          footer: 'Es tut uns leid, Sie gehen zu sehen. Sie sind jederzeit willkommen zurückzukommen!'
        }
      },
      fr: {
        verification: {
          subject: 'Vérifiez votre e-mail - AITalk.ch',
          title: 'Vérification de l\'e-mail',
          greeting: 'Bonjour',
          message: 'Merci de vous être inscrit sur AITalk.ch. Veuillez cliquer sur le bouton ci-dessous pour vérifier votre adresse e-mail.',
          button: 'Vérifier l\'e-mail',
          footer: 'Si vous n\'avez pas créé de compte, vous pouvez ignorer cet e-mail.'
        },
        welcome: {
          subject: 'Bienvenue sur AITalk.ch !',
          title: 'Bienvenue !',
          greeting: 'Bonjour',
          message: 'Bienvenue sur AITalk.ch ! Votre compte a été créé avec succès. Commencez à créer vos agents IA dès aujourd\'hui.',
          button: 'Commencer',
          footer: 'Merci de nous rejoindre !'
        },
        passwordReset: {
          subject: 'Réinitialiser votre mot de passe - AITalk.ch',
          title: 'Réinitialisation du mot de passe',
          greeting: 'Bonjour',
          message: 'Nous avons reçu une demande de réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe.',
          button: 'Réinitialiser le mot de passe',
          footer: 'Si vous n\'avez pas demandé de réinitialisation, vous pouvez ignorer cet e-mail.',
          expiry: 'Ce lien expirera dans 1 heure.'
        },
        teamInvitation: {
          subject: 'Vous avez été invité à collaborer - AITalk.ch',
          title: 'Invitation d\'équipe',
          greeting: 'Bonjour',
          message: 'Vous avez été invité à collaborer sur un agent IA. Cliquez sur le bouton ci-dessous pour accepter l\'invitation.',
          button: 'Accepter l\'invitation',
          footer: 'Si vous ne souhaitez pas rejoindre, vous pouvez ignorer cet e-mail.'
        },
        feedback: {
          subject: 'Nouveau commentaire - AITalk.ch',
          title: 'Commentaire utilisateur'
        },
        anonymizationScheduled: {
          subject: 'Suppression de compte programmée - AITalk.ch',
          title: 'Suppression de compte programmée',
          greeting: 'Bonjour',
          message: 'La suppression de votre compte a été programmée. Toutes vos données seront définitivement supprimées à la date indiquée ci-dessous.',
          button: 'Annuler la suppression',
          footer: 'Si vous changez d\'avis, vous pouvez annuler la suppression avant la date prévue.'
        },
        anonymizationCompleted: {
          subject: 'Compte supprimé - AITalk.ch',
          title: 'Compte supprimé',
          greeting: 'Bonjour',
          message: 'Votre compte et toutes les données associées ont été définitivement supprimés. Merci d\'avoir utilisé AITalk.ch.',
          footer: 'Nous sommes désolés de vous voir partir. Vous êtes toujours le bienvenu !'
        }
      },
      es: {
        verification: {
          subject: 'Verifica tu correo - AITalk.ch',
          title: 'Verificación de correo',
          greeting: 'Hola',
          message: 'Gracias por registrarte en AITalk.ch. Por favor, haz clic en el botón de abajo para verificar tu dirección de correo electrónico.',
          button: 'Verificar correo',
          footer: 'Si no creaste una cuenta, puedes ignorar este correo.'
        },
        welcome: {
          subject: '¡Bienvenido a AITalk.ch!',
          title: '¡Bienvenido!',
          greeting: 'Hola',
          message: '¡Bienvenido a AITalk.ch! Tu cuenta ha sido creada exitosamente. Comienza a crear tus agentes de IA hoy.',
          button: 'Comenzar',
          footer: '¡Gracias por unirte!'
        },
        passwordReset: {
          subject: 'Restablecer contraseña - AITalk.ch',
          title: 'Restablecer contraseña',
          greeting: 'Hola',
          message: 'Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón de abajo para crear una nueva contraseña.',
          button: 'Restablecer contraseña',
          footer: 'Si no solicitaste un restablecimiento de contraseña, puedes ignorar este correo.',
          expiry: 'Este enlace expirará en 1 hora.'
        },
        teamInvitation: {
          subject: 'Has sido invitado a colaborar - AITalk.ch',
          title: 'Invitación de equipo',
          greeting: 'Hola',
          message: 'Has sido invitado a colaborar en un agente de IA. Haz clic en el botón de abajo para aceptar la invitación.',
          button: 'Aceptar invitación',
          footer: 'Si no deseas unirte, puedes ignorar este correo.'
        },
        feedback: {
          subject: 'Nuevo comentario - AITalk.ch',
          title: 'Comentario del usuario'
        },
        anonymizationScheduled: {
          subject: 'Eliminación de cuenta programada - AITalk.ch',
          title: 'Eliminación de cuenta programada',
          greeting: 'Hola',
          message: 'La eliminación de tu cuenta ha sido programada. Todos tus datos serán eliminados permanentemente en la fecha indicada abajo.',
          button: 'Cancelar eliminación',
          footer: 'Si cambias de opinión, puedes cancelar la eliminación antes de la fecha programada.'
        },
        anonymizationCompleted: {
          subject: 'Cuenta eliminada - AITalk.ch',
          title: 'Cuenta eliminada',
          greeting: 'Hola',
          message: 'Tu cuenta y todos los datos asociados han sido eliminados permanentemente. Gracias por usar AITalk.ch.',
          footer: '¡Lamentamos verte partir. Siempre serás bienvenido!'
        }
      },
      ko: {
        verification: {
          subject: '이메일 인증 - AITalk.ch',
          title: '이메일 인증',
          greeting: '안녕하세요',
          message: 'AITalk.ch에 가입해 주셔서 감사합니다. 아래 버튼을 클릭하여 이메일 주소를 인증해 주세요.',
          button: '이메일 인증',
          footer: '계정을 만들지 않으셨다면 이 이메일을 무시해 주세요.'
        },
        welcome: {
          subject: 'AITalk.ch에 오신 것을 환영합니다!',
          title: '환영합니다!',
          greeting: '안녕하세요',
          message: 'AITalk.ch에 오신 것을 환영합니다! 계정이 성공적으로 생성되었습니다. 지금 바로 AI 에이전트를 만들어 보세요.',
          button: '시작하기',
          footer: '저희와 함께해 주셔서 감사합니다!'
        },
        passwordReset: {
          subject: '비밀번호 재설정 - AITalk.ch',
          title: '비밀번호 재설정',
          greeting: '안녕하세요',
          message: '비밀번호 재설정 요청을 받았습니다. 아래 버튼을 클릭하여 새 비밀번호를 만드세요.',
          button: '비밀번호 재설정',
          footer: '비밀번호 재설정을 요청하지 않으셨다면 이 이메일을 무시해 주세요.',
          expiry: '이 링크는 1시간 후에 만료됩니다.'
        },
        teamInvitation: {
          subject: '협업 초대를 받으셨습니다 - AITalk.ch',
          title: '팀 초대',
          greeting: '안녕하세요',
          message: 'AI 에이전트 협업에 초대되었습니다. 아래 버튼을 클릭하여 초대를 수락하세요.',
          button: '초대 수락',
          footer: '참여를 원하지 않으시면 이 이메일을 무시해 주세요.'
        },
        feedback: {
          subject: '새 피드백 - AITalk.ch',
          title: '사용자 피드백'
        },
        anonymizationScheduled: {
          subject: '계정 삭제 예정 - AITalk.ch',
          title: '계정 삭제 예정',
          greeting: '안녕하세요',
          message: '계정 삭제가 예약되었습니다. 아래 표시된 날짜에 모든 데이터가 영구적으로 삭제됩니다.',
          button: '삭제 취소',
          footer: '마음이 바뀌시면 예정된 날짜 전에 삭제를 취소할 수 있습니다.'
        },
        anonymizationCompleted: {
          subject: '계정 삭제 완료 - AITalk.ch',
          title: '계정 삭제 완료',
          greeting: '안녕하세요',
          message: '계정과 모든 관련 데이터가 영구적으로 삭제되었습니다. AITalk.ch를 이용해 주셔서 감사합니다.',
          footer: '떠나시게 되어 아쉽습니다. 언제든지 다시 오세요!'
        }
      }
    }
    return texts[language] || texts.en
  }

  async sendVerificationEmail(email: string, verificationToken: string, baseUrl: string, language: Language = 'en', source?: string) {
    language = safeLang(language)
    const verificationUrl = `${baseUrl}/auth/verify-email?token=${verificationToken}&lang=${language}${source ? `&source=${source}` : ''}`
    const texts = this.getEmailTexts(language)
    const t = texts.verification

    const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">✉️</div>
      <h1>${t.title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.greeting},</div>
      <div class="message">${t.message}</div>
      <div style="text-align: center;">
        <a href="${verificationUrl}" class="cta-button">${t.button}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <p style="font-size: 14px; color: #666;">${t.footer}</p>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} M-BIZ Global AG. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: email,
      subject: t.subject,
      html
    })
  }

  private getAppWelcomeHtml(name: string, ctaUrl: string, language: Language): { subject: string; html: string } {
    const lang: 'en' | 'de' | 'fr' | 'ko' =
      language === 'de' || language === 'de-ch' ? 'de'
        : language === 'fr' ? 'fr'
          : language === 'ko' ? 'ko'
            : 'en'

    const WEB = '<a href="https://www.aitalk.ch" style="color:#4F46E5;text-decoration:none;font-weight:600;">www.aitalk.ch</a>'
    const BRAND = '<a href="https://www.aitalk.ch" style="color:#111827;text-decoration:none;">AiTalk.ch</a>'

    const copy = {
      en: {
        subject: 'Welcome to AiTalk.ch — your 14-day trial starts now',
        title: 'Welcome to AiTalk.ch',
        headline: 'Welcome to {BRAND}',
        tagline: 'Real-time interpretation, in your pocket.',
        trialTitle: 'Your 14-day free trial has started',
        trialSub: 'Everything below is unlocked &mdash; no card needed.',
        greeting: 'Hello {NAME},',
        intro: 'Thanks for joining. AiTalk.ch turns your phone into a real-time interpreter, a personal AI voice agent and a daily training coach. Here is what you can do right now.',
        f1t: 'Real-time translation',
        f1b: 'Speak naturally and hear the translation in your own language through your earphones &mdash; like having a live interpreter in your ear. Made for lectures, meetings, travel and everyday conversations. It keeps running with the screen off and the phone in your pocket.',
        f2t: 'Your own AI voice agent',
        f2b: 'Call your AI and talk to it by voice. It answers from what you set up in &ldquo;Edit AI setup&rdquo;, so it responds the way you want &mdash; great for quick questions, practice and hands-free help.',
        f3t: 'Phone (PSTN) calling',
        f3b: 'Add a phone number and your AI voice agent can place and take real calls. Real-time translation works with or without a number.',
        f4t: 'Daily training quizzes',
        f4b: 'Turn your own knowledge into short daily quizzes. A reminder arrives at the time you pick &mdash; tap it and the AI builds a quiz around what you have not mastered yet, with an explanation for every answer and read-aloud pronunciation practice. Set up a Quiz app for your account at {WEB} to begin; creating one uses credits.',
        f5t: 'Build your workflows on the web',
        f5b: 'Sign in at {WEB} with this same account. The web dashboard is where you design and fine-tune agents and workflows in detail &mdash; then put them to work from the app.',
        cta: 'Open AiTalk.ch',
        explore: 'Explore aitalk.ch',
        youtube: 'Watch on YouTube',
        secondaryNote: 'See it in action and get the full walkthrough.',
        footerInfo: 'Available in English, German, French and Korean &middot; Conversations stay in History for 90 days, then delete automatically &middot; ',
        footerDelete: 'Delete your data or account',
        footerReason: 'You are receiving this because you created an AiTalk.ch account.',
        rights: 'All rights reserved.',
      },
      de: {
        subject: 'Willkommen bei AiTalk.ch — Ihre 14-tägige Testphase beginnt jetzt',
        title: 'Willkommen bei AiTalk.ch',
        headline: 'Willkommen bei {BRAND}',
        tagline: 'Dolmetschen in Echtzeit &mdash; direkt in Ihrer Tasche.',
        trialTitle: 'Ihre 14-tägige kostenlose Testphase hat begonnen',
        trialSub: 'Alles Folgende ist freigeschaltet &mdash; ohne Kreditkarte.',
        greeting: 'Hallo {NAME},',
        intro: 'Danke, dass Sie dabei sind. AiTalk.ch macht Ihr Telefon zum Echtzeit-Dolmetscher, zum persönlichen KI-Sprachassistenten und zum täglichen Lerncoach. Das können Sie ab sofort tun.',
        f1t: 'Übersetzung in Echtzeit',
        f1b: 'Sprechen Sie ganz natürlich und hören Sie die Übersetzung über Ihre Kopfhörer in Ihrer eigenen Sprache &mdash; wie ein Dolmetscher direkt im Ohr. Gemacht für Vorträge, Meetings, Reisen und Alltagsgespräche. Läuft weiter, auch wenn der Bildschirm aus ist und das Telefon in der Tasche steckt.',
        f2t: 'Ihr eigener KI-Sprachassistent',
        f2b: 'Rufen Sie Ihre KI an und sprechen Sie mit ihr. Sie antwortet auf Basis dessen, was Sie unter &ldquo;Edit AI setup&rdquo; hinterlegt haben &mdash; ideal für schnelle Fragen, zum Üben und für freihändige Hilfe.',
        f3t: 'Telefonie (PSTN)',
        f3b: 'Fügen Sie eine Rufnummer hinzu, damit Ihr KI-Sprachassistent echte Anrufe tätigen und annehmen kann. Die Echtzeit-Übersetzung funktioniert mit und ohne Rufnummer.',
        f4t: 'Tägliche Lern-Quizze',
        f4b: 'Machen Sie aus Ihrem eigenen Wissen kurze tägliche Quizze. Zur gewählten Zeit kommt eine Erinnerung &mdash; tippen Sie darauf und die KI erstellt ein Quiz rund um das, was Sie noch nicht sicher beherrschen: mit einer Erklärung zu jeder Antwort und Vorlesefunktion zum Aussprachetraining. Richten Sie dafür unter {WEB} eine Quiz-App für Ihr Konto ein; das Erstellen verbraucht Credits.',
        f5t: 'Workflows im Web erstellen',
        f5b: 'Melden Sie sich unter {WEB} mit demselben Konto an. Im Web-Dashboard gestalten und verfeinern Sie Agenten und Workflows im Detail &mdash; und nutzen sie dann in der App.',
        cta: 'AiTalk.ch öffnen',
        explore: 'aitalk.ch entdecken',
        youtube: 'Auf YouTube ansehen',
        secondaryNote: 'Sehen Sie es in Aktion &mdash; mit der kompletten Anleitung.',
        footerInfo: 'Verfügbar auf Englisch, Deutsch, Französisch und Koreanisch &middot; Gespräche bleiben 90 Tage im Verlauf und werden dann automatisch gelöscht &middot; ',
        footerDelete: 'Daten oder Konto löschen',
        footerReason: 'Sie erhalten diese E-Mail, weil Sie ein AiTalk.ch-Konto erstellt haben.',
        rights: 'Alle Rechte vorbehalten.',
      },
      fr: {
        subject: 'Bienvenue sur AiTalk.ch — votre essai de 14 jours commence',
        title: 'Bienvenue sur AiTalk.ch',
        headline: 'Bienvenue sur {BRAND}',
        tagline: 'L&rsquo;interprétation en temps réel, dans votre poche.',
        trialTitle: 'Votre essai gratuit de 14 jours a commencé',
        trialSub: 'Tout ce qui suit est débloqué &mdash; sans carte bancaire.',
        greeting: 'Bonjour {NAME},',
        intro: 'Merci de nous rejoindre. AiTalk.ch transforme votre téléphone en interprète en temps réel, en agent vocal IA personnel et en coach d&rsquo;entraînement quotidien. Voici ce que vous pouvez faire dès maintenant.',
        f1t: 'Traduction en temps réel',
        f1b: 'Parlez naturellement et écoutez la traduction dans votre langue via vos écouteurs &mdash; comme un interprète à votre oreille. Pensé pour les conférences, les réunions, les voyages et les conversations du quotidien. Cela continue de fonctionner écran éteint, téléphone dans la poche.',
        f2t: 'Votre propre agent vocal IA',
        f2b: 'Appelez votre IA et parlez-lui de vive voix. Elle répond à partir de ce que vous avez défini dans &laquo;&nbsp;Edit AI setup&nbsp;&raquo;, donc elle répond comme vous le souhaitez &mdash; idéal pour les questions rapides, l&rsquo;entraînement et l&rsquo;aide mains libres.',
        f3t: 'Appels téléphoniques (PSTN)',
        f3b: 'Ajoutez un numéro de téléphone et votre agent vocal IA pourra passer et recevoir de vrais appels. La traduction en temps réel fonctionne avec ou sans numéro.',
        f4t: 'Quiz d&rsquo;entraînement quotidiens',
        f4b: 'Transformez vos connaissances en courts quiz quotidiens. À l&rsquo;heure que vous choisissez, un rappel arrive &mdash; touchez-le et l&rsquo;IA construit un quiz centré sur ce que vous ne maîtrisez pas encore, avec une explication pour chaque réponse et une lecture à voix haute pour travailler la prononciation. Configurez une application Quiz pour votre compte sur {WEB} pour commencer&nbsp;; chaque création consomme des crédits.',
        f5t: 'Créez vos workflows sur le web',
        f5b: 'Connectez-vous sur {WEB} avec ce même compte. Le tableau de bord web est l&rsquo;endroit où vous concevez et affinez vos agents et vos workflows en détail &mdash; puis vous les utilisez depuis l&rsquo;application.',
        cta: 'Ouvrir AiTalk.ch',
        explore: 'Découvrir aitalk.ch',
        youtube: 'Voir sur YouTube',
        secondaryNote: 'Voyez-le en action, avec la présentation complète.',
        footerInfo: 'Disponible en anglais, allemand, français et coréen &middot; Les conversations restent 90 jours dans l&rsquo;historique, puis sont supprimées automatiquement &middot; ',
        footerDelete: 'Supprimer vos données ou votre compte',
        footerReason: 'Vous recevez cet e-mail parce que vous avez créé un compte AiTalk.ch.',
        rights: 'Tous droits réservés.',
      },
      ko: {
        subject: 'AiTalk.ch에 오신 것을 환영합니다 — 14일 무료 체험이 시작되었습니다',
        title: 'AiTalk.ch에 오신 것을 환영합니다',
        headline: '{BRAND}에 오신 것을 환영합니다',
        tagline: '실시간 통역을 주머니 속에.',
        trialTitle: '14일 무료 체험이 시작되었습니다',
        trialSub: '아래 기능이 모두 열려 있습니다 &mdash; 카드 등록 없이.',
        greeting: '{NAME}님, 안녕하세요.',
        intro: '함께해 주셔서 감사합니다. AiTalk.ch는 휴대폰을 실시간 통역기이자 나만의 AI 음성 에이전트, 그리고 매일의 학습 코치로 만들어 줍니다. 지금 바로 이런 것들을 할 수 있습니다.',
        f1t: '실시간 번역',
        f1b: '평소처럼 말하면 이어폰으로 내 언어의 번역이 들립니다 &mdash; 귓속에 통역사가 있는 것처럼요. 강연·회의·여행·일상 대화를 위해 만들었습니다. 화면을 끄고 휴대폰을 주머니에 넣어도 계속 동작합니다.',
        f2t: '나만의 AI 음성 에이전트',
        f2b: 'AI에게 전화를 걸어 음성으로 대화하세요. &ldquo;Edit AI setup&rdquo;에서 설정한 내용을 바탕으로 답하기 때문에 원하는 방식으로 응답합니다. 간단한 질문, 연습, 핸즈프리 도움에 좋습니다.',
        f3t: '전화(PSTN) 통화',
        f3b: '전화번호를 추가하면 AI 음성 에이전트가 실제 전화를 걸고 받을 수 있습니다. 실시간 번역은 번호가 없어도 사용할 수 있습니다.',
        f4t: '매일 훈련 퀴즈',
        f4b: '내 지식을 짧은 매일 퀴즈로 만들어 보세요. 정한 시각에 알림이 오고, 탭하면 AI가 아직 익숙하지 않은 부분을 중심으로 퀴즈를 만들어 줍니다. 모든 답에 해설이 붙고 문제와 예문을 소리 내어 읽어 주어 발음 연습도 됩니다. 시작하려면 {WEB}에서 계정에 Quiz 앱을 설정하세요. 퀴즈를 만들 때 크레딧이 사용됩니다.',
        f5t: '웹에서 워크플로 구성',
        f5b: '같은 계정으로 {WEB}에 로그인하세요. 웹 대시보드에서 에이전트와 워크플로를 세밀하게 설계·조정한 뒤, 앱에서 그대로 사용할 수 있습니다.',
        cta: 'AiTalk.ch 열기',
        explore: 'aitalk.ch 둘러보기',
        youtube: 'YouTube에서 보기',
        secondaryNote: '실제 사용 모습과 전체 사용법을 확인해 보세요.',
        footerInfo: '영어·독일어·프랑스어·한국어 지원 &middot; 대화 기록은 90일간 보관 후 자동 삭제 &middot; ',
        footerDelete: '데이터 또는 계정 삭제',
        footerReason: 'AiTalk.ch 계정을 만드셨기 때문에 이 메일을 받으셨습니다.',
        rights: '모든 권리 보유.',
      },
    }
    const t = copy[lang]
    const fill = (s: string) => s.split('{WEB}').join(WEB).split('{BRAND}').join(BRAND).split('{NAME}').join(name)

    const feature = (icon: string, tint: string, title: string, body: string) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
                <tr>
                  <td width="52" valign="top" style="padding-right:14px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="44">
                      <tr><td align="center" height="44" style="background-color:${tint};border-radius:12px;font-size:21px;line-height:44px;">${icon}</td></tr>
                    </table>
                  </td>
                  <td valign="top">
                    <div style="font-size:16px;font-weight:700;color:#111827;margin:0 0 5px;">${title}</div>
                    <div style="font-size:14px;line-height:1.65;color:#4B5563;margin:0;">${fill(body)}</div>
                  </td>
                </tr>
              </table>`

    const html = `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F4F6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

          <!-- Header -->
          <tr>
            <td align="center" style="background-color:#111827;background-image:linear-gradient(135deg,#111827 0%,#312E81 55%,#4F46E5 100%);padding:44px 32px 38px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="66">
                <tr><td align="center" height="66" style="background-color:rgba(255,255,255,0.12);border-radius:33px;font-size:32px;line-height:66px;">&#127911;</td></tr>
              </table>
              <div style="font-size:29px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;margin:20px 0 8px;">${fill(t.headline)}</div>
              <div style="font-size:15px;color:#C7D2FE;margin:0;">${t.tagline}</div>
            </td>
          </tr>

          <!-- Trial banner -->
          <tr>
            <td align="center" style="background-color:#EEF2FF;border-bottom:1px solid #E0E7FF;padding:16px 24px;">
              <div style="font-size:15px;font-weight:700;color:#4338CA;">&#10024;&nbsp; ${t.trialTitle}</div>
              <div style="font-size:13px;color:#6366F1;margin-top:4px;">${t.trialSub}</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:34px 32px 8px;">
              <div style="font-size:17px;font-weight:700;color:#111827;margin:0 0 6px;">${fill(t.greeting)}</div>
              <div style="font-size:15px;line-height:1.7;color:#4B5563;margin:0 0 28px;">${t.intro}</div>
${feature('&#127911;', '#EEF2FF', t.f1t, t.f1b)}
${feature('&#129302;', '#F5F3FF', t.f2t, t.f2b)}
${feature('&#128222;', '#ECFDF5', t.f3t, t.f3b)}
${feature('&#129504;', '#FFF7ED', t.f4t, t.f4b)}
${feature('&#128736;&#65039;', '#F1F5F9', t.f5t, t.f5b)}
            </td>
          </tr>

          <!-- Primary CTA -->
          <tr>
            <td align="center" style="padding:14px 32px 6px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#4F46E5;border-radius:10px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:15px 44px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;">${t.cta}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Secondary links -->
          <tr>
            <td align="center" style="padding:18px 32px 34px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:0 5px;">
                    <a href="https://www.aitalk.ch/" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#374151;text-decoration:none;background-color:#F3F4F6;border:1px solid #E5E7EB;border-radius:9px;">&#127760;&nbsp; ${t.explore}</a>
                  </td>
                  <td align="center" style="padding:0 5px;">
                    <a href="https://www.youtube.com/@aitalk_ch" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#B91C1C;text-decoration:none;background-color:#FEF2F2;border:1px solid #FECACA;border-radius:9px;">&#9654;&nbsp; ${t.youtube}</a>
                  </td>
                </tr>
              </table>
              <div style="font-size:13px;color:#9CA3AF;margin-top:16px;">${t.secondaryNote}</div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background-color:#F9FAFB;border-top:1px solid #E5E7EB;padding:26px 32px;">
              <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px;">AiTalk.ch</div>
              <div style="font-size:12px;line-height:1.7;color:#9CA3AF;margin-bottom:12px;">${t.footerInfo}<a href="https://www.aitalk.ch/en/law/account-deletion" style="color:#6B7280;text-decoration:underline;">${t.footerDelete}</a></div>
              <div style="font-size:13px;color:#6B7280;margin-bottom:12px;">${t.footerReason}</div>
              <div style="font-size:12px;color:#9CA3AF;">&copy; ${new Date().getFullYear()} M-BIZ Global AG. ${t.rights}</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim()

    return { subject: t.subject, html }
  }


  async sendWelcomeEmail(email: string, rawName: string, language: Language = 'en', source?: string, baseUrl?: string) {
    if (isSelfHosted()) source = undefined
    language = safeLang(language)
    const texts = this.getEmailTexts(language)
    const t = texts.welcome
    const name = escapeHtml(Array.from(rawName).slice(0, 100).join(''))

    const base = baseUrl || getAppBaseUrl()
    const ctaUrl = source === 'app'
      ? `${base}/auth/open-app?lang=${language}`
      : `${base}/app`

    if (source === 'app') {
      const { subject, html } = this.getAppWelcomeHtml(name, ctaUrl, language)
      return this.sendEmail({ to: email, subject, html })
    }

    const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">🎉</div>
      <h1>${t.title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.greeting} ${name},</div>
      <div class="message">${t.message}</div>
      <div style="text-align: center;">
        <a href="${ctaUrl}" class="cta-button">${t.button}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <p style="font-size: 14px; color: #666;">${t.footer}</p>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} M-BIZ Global AG. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: email,
      subject: t.subject,
      html
    })
  }

  async sendPasswordResetEmail(email: string, resetToken: string, baseUrl: string, language: Language = 'en') {
    language = safeLang(language)
    const resetUrl = `${baseUrl}/auth/reset-password?token=${resetToken}&lang=${language}`
    const texts = this.getEmailTexts(language)
    const t = texts.passwordReset

    const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">🔑</div>
      <h1>${t.title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.greeting},</div>
      <div class="message">${t.message}</div>
      <div class="warning-box">
        <p style="margin: 0; color: #856404;">${t.expiry}</p>
      </div>
      <div style="text-align: center;">
        <a href="${resetUrl}" class="cta-button">${t.button}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <p style="font-size: 14px; color: #666;">${t.footer}</p>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} M-BIZ Global AG. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: email,
      subject: t.subject,
      html
    })
  }

  async sendTeamInvitationEmail(
    email: string,
    agentName: string,
    inviteToken: string,
    baseUrl: string,
    inviterName: string,
    language: Language = 'en'
  ) {
    language = safeLang(language)
    const inviteUrl = `${baseUrl}/auth/team-invitation?token=${inviteToken}&lang=${language}`
    const texts = this.getEmailTexts(language)
    const t = texts.teamInvitation

    const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">👥</div>
      <h1>${t.title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.greeting},</div>
      <div class="message">
        <strong>${escapeHtml(inviterName)}</strong> ${t.message}
      </div>
      <div class="details-box">
        <p style="margin: 0;"><strong>Workflow:</strong> ${escapeHtml(agentName)}</p>
      </div>
      <div style="text-align: center;">
        <a href="${inviteUrl}" class="cta-button">${t.button}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <p style="font-size: 14px; color: #666;">${t.footer}</p>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} M-BIZ Global AG. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: email,
      subject: t.subject,
      html
    })
  }

  async sendTeamMemberPasswordResetEmail(
    email: string,
    resetToken: string,
    agentId: string,
    agentTitle: string,
    baseUrl: string,
    language: Language = 'en'
  ) {
    language = safeLang(language)
    const resetUrl = `${baseUrl}/chat/${agentId}/team/reset-password?token=${resetToken}&lang=${language}`
    const texts = this.getEmailTexts(language)
    const t = texts.passwordReset

    const agentLabel: Record<Language, string> = {
      en: 'Agent',
      ko: '에이전트',
      de: 'Agent',
      fr: 'Agent',
      es: 'Agente'
    }

    const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">🔑</div>
      <h1>${t.title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.greeting},</div>
      <div class="message">${t.message}</div>
      <div class="details-box">
        <p style="margin: 0;"><strong>${agentLabel[language]}:</strong> ${escapeHtml(agentTitle || agentId)}</p>
      </div>
      <div class="warning-box">
        <p style="margin: 0; color: #856404;">${t.expiry}</p>
      </div>
      <div style="text-align: center;">
        <a href="${resetUrl}" class="cta-button">${t.button}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <p style="font-size: 14px; color: #666;">${t.footer}</p>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} M-BIZ Global AG. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: email,
      subject: t.subject,
      html
    })
  }

  async sendTeamMemberEmailChangeEmail(
    newEmail: string,
    verifyToken: string,
    agentId: string,
    agentTitle: string,
    baseUrl: string,
    language: Language = 'en'
  ) {
    language = safeLang(language)
    const verifyUrl = `${baseUrl}/chat/${agentId}/team/verify-email?token=${verifyToken}&lang=${language}`

    const texts: Record<Language, {
      subject: string
      title: string
      greeting: string
      message: string
      button: string
      expiry: string
      footer: string
      agentLabel: string
    }> = {
      en: {
        subject: 'Verify your new email - AITalk.ch',
        title: 'Email Change Verification',
        greeting: 'Hello',
        message: 'You requested to change your email address. Click the button below to verify your new email.',
        button: 'Verify Email',
        expiry: 'This link will expire in 1 hour.',
        footer: 'If you did not request this change, you can safely ignore this email.',
        agentLabel: 'Agent'
      },
      ko: {
        subject: '새 이메일 주소 인증 - AITalk.ch',
        title: '이메일 변경 인증',
        greeting: '안녕하세요',
        message: '이메일 주소 변경을 요청하셨습니다. 아래 버튼을 클릭하여 새 이메일을 인증해주세요.',
        button: '이메일 인증',
        expiry: '이 링크는 1시간 후 만료됩니다.',
        footer: '이 변경을 요청하지 않으셨다면 이 이메일을 무시하셔도 됩니다.',
        agentLabel: '에이전트'
      },
      de: {
        subject: 'Neue E-Mail-Adresse bestätigen - AITalk.ch',
        title: 'E-Mail-Änderung bestätigen',
        greeting: 'Hallo',
        message: 'Sie haben die Änderung Ihrer E-Mail-Adresse angefordert. Klicken Sie auf die Schaltfläche unten, um Ihre neue E-Mail zu bestätigen.',
        button: 'E-Mail bestätigen',
        expiry: 'Dieser Link läuft in 1 Stunde ab.',
        footer: 'Wenn Sie diese Änderung nicht angefordert haben, können Sie diese E-Mail ignorieren.',
        agentLabel: 'Agent'
      },
      fr: {
        subject: 'Vérifiez votre nouvelle adresse e-mail - AITalk.ch',
        title: 'Vérification du changement d\'e-mail',
        greeting: 'Bonjour',
        message: 'Vous avez demandé à modifier votre adresse e-mail. Cliquez sur le bouton ci-dessous pour vérifier votre nouvel e-mail.',
        button: 'Vérifier l\'e-mail',
        expiry: 'Ce lien expirera dans 1 heure.',
        footer: 'Si vous n\'avez pas demandé ce changement, vous pouvez ignorer cet e-mail.',
        agentLabel: 'Agent'
      },
      es: {
        subject: 'Verifica tu nuevo correo electrónico - AITalk.ch',
        title: 'Verificación de cambio de correo',
        greeting: 'Hola',
        message: 'Has solicitado cambiar tu dirección de correo electrónico. Haz clic en el botón de abajo para verificar tu nuevo correo.',
        button: 'Verificar correo',
        expiry: 'Este enlace expirará en 1 hora.',
        footer: 'Si no solicitaste este cambio, puedes ignorar este correo.',
        agentLabel: 'Agente'
      }
    }

    const t = texts[language] || texts.en

    const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">✉️</div>
      <h1>${t.title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.greeting},</div>
      <div class="message">${t.message}</div>
      <div class="details-box">
        <p style="margin: 0;"><strong>${t.agentLabel}:</strong> ${escapeHtml(agentTitle || agentId)}</p>
      </div>
      <div class="warning-box">
        <p style="margin: 0; color: #856404;">${t.expiry}</p>
      </div>
      <div style="text-align: center;">
        <a href="${verifyUrl}" class="cta-button">${t.button}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <p style="font-size: 14px; color: #666;">${t.footer}</p>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} M-BIZ Global AG. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: newEmail,
      subject: t.subject,
      html
    })
  }

  async sendFeedbackEmail(userEmail: string, feedbackContent: string) {
    const feedbackTo = getFeedbackRecipient()
    if (!feedbackTo) return { success: false, error: 'Feedback recipient not configured' }
    const timestamp = new Date().toISOString()
    const texts = this.getEmailTexts('en')
    const t = texts.feedback

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">📝</div>
      <h1>${t.title}</h1>
    </div>
    <div class="content">
      <div class="details-box">
        <p><strong>From:</strong> ${escapeHtml(userEmail)}</p>
        <p><strong>Time:</strong> ${timestamp}</p>
      </div>
      <div class="message">
        <strong>Feedback:</strong>
        <p style="white-space: pre-wrap;">${escapeHtml(feedbackContent)}</p>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} M-BIZ Global AG. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: feedbackTo,
      subject: `${t.subject} - ${userEmail}`,
      html
    })
  }

  async sendAnonymizationScheduledEmail(
    email: string,
    scheduledDate: Date,
    language: Language = 'en'
  ) {
    language = safeLang(language)
    const baseUrl = getAppBaseUrl()
    const cancelUrl = `${baseUrl}/app/settings?tab=privacy&lang=${language}`

    const formattedDate = scheduledDate.toLocaleDateString(
      language === 'de' ? 'de-DE' : language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : language === 'ko' ? 'ko-KR' : 'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' }
    )

    const texts = this.getEmailTexts(language)
    const t = texts.anonymizationScheduled

    const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">⚠️</div>
      <h1>${t.title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.greeting},</div>
      <div class="message">${t.message}</div>
      <div class="warning-box">
        <p style="margin: 0; font-weight: bold; color: #856404;">${formattedDate}</p>
      </div>
      <div style="text-align: center;">
        <a href="${cancelUrl}" class="cta-button">${t.button}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <p style="font-size: 14px; color: #666;">${t.footer}</p>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} M-BIZ Global AG. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: email,
      subject: t.subject,
      html
    })
  }

  async sendAnonymizationCompletedEmail(
    email: string,
    language: Language = 'en'
  ) {
    language = safeLang(language)
    const texts = this.getEmailTexts(language)
    const t = texts.anonymizationCompleted

    const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">✓</div>
      <h1>${t.title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.greeting},</div>
      <div class="message">${t.message}</div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <p style="font-size: 14px; color: #666;">${t.footer}</p>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} M-BIZ Global AG. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: email,
      subject: t.subject,
      html
    })
  }
}

export const emailService = new EmailService()
