import { getAppBaseUrl } from '@/lib/app-url'
import { OPERATOR_PATH } from '@/lib/vendor-site'
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

function looksLikeEmail(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 320 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s)
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
    replyTo?: string
  }): Promise<EmailResponse> {
    return sendRoutedEmail(data, this.fromEmail, (d) => this.sendViaAcs(d))
  }

  private async sendViaAcs(data: {
    to: string
    subject: string
    html: string
    from?: string
    replyTo?: string
  }): Promise<EmailResponse> {
    if (!emailClient) {
      return { success: false, error: 'ACS Email client not configured' }
    }

    try {
      const poller = await emailClient.beginSend({
        senderAddress: data.from || this.fromEmail,
        content: { subject: data.subject, html: data.html },
        recipients: { to: [{ address: data.to }] },
        ...(data.replyTo && { replyTo: [{ address: data.replyTo }] }),
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
          message: 'Welcome to AITalk.ch! Your account has been successfully created. Start using or building AI Work Apps today.',
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
          message: 'Willkommen bei AITalk.ch! Ihr Konto wurde erfolgreich erstellt. Beginnen Sie noch heute, AI Work Apps zu nutzen oder zu erstellen.',
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
          message: 'Bienvenue sur AITalk.ch ! Votre compte a été créé avec succès. Commencez dès aujourd\'hui à utiliser ou à créer des AI Work Apps.',
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
          message: 'AITalk.ch에 오신 것을 환영합니다! 계정이 성공적으로 생성되었습니다. 지금 바로 AI Work Apps 를 사용하거나 만들어 보세요.',
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
        tagline: 'AI Work Apps &mdash; AI does the work, you stay in control.',
        trialTitle: 'Your 14-day free trial has started',
        trialSub: 'Everything below is unlocked &mdash; no card needed.',
        greeting: 'Hello {NAME},',
        intro: 'Thanks for joining. AiTalk.ch gives you AI Work Apps: apps where AI does demanding work such as invoices, receipts and bank statements, under your control. AI fills in the lines, and a person confirms before anything becomes final. Here is what you can do right now.',
        f1t: 'Your AI Work Apps',
        f1b: 'Expenses, Bank ledger and Payment approvals are ready on your home screen. Open an app, tell the AI what you need, and it works inside that app &mdash; fixed code calculates the numbers.',
        f2t: 'Scan documents',
        f2b: 'Photograph a receipt or document, or pick a file. AI enters it into the right table, and you check the result. With My forms you can set up your own forms for any kind of document.',
        f3t: 'Real-time translation',
        f3b: 'Speak naturally and hear the translation in your own language through your earphones. It keeps running with the screen off and the phone in your pocket.',
        f4t: 'Your AI voice agent',
        f4b: 'Call your AI and talk to it by voice. Add a phone number and it can place and take real calls.',
        f5t: 'Build more on the web',
        f5b: 'Sign in at {WEB} with this same account to add work apps for your country, connect them and fine-tune them in detail &mdash; then use them from the app.',
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
        tagline: 'AI Work Apps &mdash; die KI arbeitet, Sie behalten die Kontrolle.',
        trialTitle: 'Ihre 14-tägige kostenlose Testphase hat begonnen',
        trialSub: 'Alles Folgende ist freigeschaltet &mdash; ohne Kreditkarte.',
        greeting: 'Hallo {NAME},',
        intro: 'Danke, dass Sie dabei sind. AiTalk.ch bietet Ihnen AI Work Apps: Apps, in denen die KI aufwendige Arbeit wie Rechnungen, Belege und Bankauszüge erledigt &mdash; unter Ihrer Kontrolle. Die KI füllt die Zeilen aus, und ein Mensch bestätigt, bevor etwas definitiv ist. Das können Sie ab sofort tun.',
        f1t: 'Ihre AI Work Apps',
        f1b: 'Ausgaben, Bankjournal und Zahlungsfreigabe sind auf Ihrem Startbildschirm bereit. Öffnen Sie eine App und sagen Sie der KI, was Sie brauchen. Sie arbeitet in dieser App &mdash; fester Code berechnet die Zahlen.',
        f2t: 'Dokumente scannen',
        f2b: 'Fotografieren Sie einen Beleg oder ein Dokument oder wählen Sie eine Datei. Die KI trägt es in die passende Tabelle ein, und Sie prüfen das Ergebnis. Mit «Meine Formulare» richten Sie eigene Formulare für jede Art von Dokument ein.',
        f3t: 'Übersetzung in Echtzeit',
        f3b: 'Sprechen Sie ganz natürlich und hören Sie die Übersetzung über Ihre Kopfhörer in Ihrer eigenen Sprache. Läuft weiter, auch wenn der Bildschirm aus ist und das Telefon in der Tasche steckt.',
        f4t: 'Ihr KI-Sprachassistent',
        f4b: 'Rufen Sie Ihre KI an und sprechen Sie mit ihr. Mit einer Rufnummer kann sie echte Anrufe tätigen und annehmen.',
        f5t: 'Mehr im Web aufbauen',
        f5b: 'Melden Sie sich unter {WEB} mit demselben Konto an, um Arbeits-Apps für Ihr Land hinzuzufügen, sie zu verbinden und im Detail anzupassen &mdash; und nutzen Sie sie dann in der App.',
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
        tagline: 'AI Work Apps &mdash; l&rsquo;IA travaille, vous gardez le contrôle.',
        trialTitle: 'Votre essai gratuit de 14 jours a commencé',
        trialSub: 'Tout ce qui suit est débloqué &mdash; sans carte bancaire.',
        greeting: 'Bonjour {NAME},',
        intro: 'Merci de nous rejoindre. AiTalk.ch vous offre les AI Work Apps&nbsp;: des apps dans lesquelles l&rsquo;IA effectue un travail exigeant comme les factures, les justificatifs et les relevés bancaires, sous votre contrôle. L&rsquo;IA remplit les lignes, et une personne confirme avant que quoi que ce soit ne devienne définitif. Voici ce que vous pouvez faire dès maintenant.',
        f1t: 'Vos AI Work Apps',
        f1b: 'Dépenses, Journal bancaire et Validation des paiements sont prêts sur votre écran d&rsquo;accueil. Ouvrez une app, dites à l&rsquo;IA ce dont vous avez besoin&nbsp;: elle travaille dans cette app, et un code fixe calcule les chiffres.',
        f2t: 'Numériser des documents',
        f2b: 'Photographiez un justificatif ou un document, ou choisissez un fichier. L&rsquo;IA le saisit dans le bon tableau, et vous vérifiez le résultat. Avec «&nbsp;Mes formulaires&nbsp;», créez vos propres formulaires pour tout type de document.',
        f3t: 'Traduction en temps réel',
        f3b: 'Parlez naturellement et écoutez la traduction dans votre langue via vos écouteurs. Cela continue de fonctionner écran éteint, téléphone dans la poche.',
        f4t: 'Votre agent vocal IA',
        f4b: 'Appelez votre IA et parlez-lui de vive voix. Avec un numéro de téléphone, elle peut passer et recevoir de vrais appels.',
        f5t: 'Allez plus loin sur le web',
        f5b: 'Connectez-vous sur {WEB} avec ce même compte pour ajouter des apps de travail pour votre pays, les relier et les affiner en détail &mdash; puis utilisez-les depuis l&rsquo;application.',
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
        tagline: 'AI Work Apps &mdash; 일은 AI 가, 통제는 내가.',
        trialTitle: '14일 무료 체험이 시작되었습니다',
        trialSub: '아래 기능이 모두 열려 있습니다 &mdash; 카드 등록 없이.',
        greeting: '{NAME}님, 안녕하세요.',
        intro: '함께해 주셔서 감사합니다. AiTalk.ch 는 AI Work Apps 를 제공합니다. 청구서, 영수증, 은행 명세서처럼 손이 많이 가는 일을 AI 가 하되, 통제는 사용자 손에 있는 앱입니다. AI 가 줄을 채우고, 확정되기 전에 사람이 확인합니다. 지금 바로 이런 것들을 할 수 있습니다.',
        f1t: '나의 AI Work Apps',
        f1b: '지출, 은행 장부, 지급 승인이 홈 화면에 준비되어 있습니다. 앱을 열어 필요한 것을 AI 에게 말하면 AI 는 그 앱 안에서 일하고, 숫자는 고정된 코드가 계산합니다.',
        f2t: '서류 스캔',
        f2b: '영수증이나 서류를 찍거나 파일을 고르세요. AI 가 맞는 표에 넣어 주고, 결과는 직접 확인합니다. 「내 폼」으로 어떤 서류든 내가 정한 폼을 만들 수 있습니다.',
        f3t: '실시간 번역',
        f3b: '평소처럼 말하면 이어폰으로 내 언어의 번역이 들립니다. 화면을 끄고 휴대폰을 주머니에 넣어도 계속 동작합니다.',
        f4t: 'AI 음성 에이전트',
        f4b: 'AI 에게 전화를 걸어 음성으로 대화하세요. 전화번호를 추가하면 실제 전화를 걸고 받을 수 있습니다.',
        f5t: '웹에서 더 만들기',
        f5b: '같은 계정으로 {WEB} 에 로그인하면 내 나라에 맞는 업무 앱을 더하고, 서로 잇고, 세밀하게 조정할 수 있습니다. 그런 다음 앱에서 그대로 사용하세요.',
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
                <tr><td align="center" height="66" style="background-color:rgba(255,255,255,0.12);border-radius:33px;font-size:32px;line-height:66px;">&#128188;</td></tr>
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
${feature('&#128188;', '#EEF2FF', t.f1t, t.f1b)}
${feature('&#128247;', '#ECFDF5', t.f2t, t.f2b)}
${feature('&#127911;', '#F5F3FF', t.f3t, t.f3b)}
${feature('&#128222;', '#FFF7ED', t.f4t, t.f4b)}
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
      html,
      ...(looksLikeEmail(userEmail) ? { replyTo: userEmail } : {}),
    })
  }

  private supportShell(lang: string, title: string, inner: string): string {
    return `
<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${this.getBaseStyles()}</style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>${escapeHtml(title)}</h1>
    </div>
    <div class="content">${inner}</div>
    <div class="footer">
      <div class="footer-brand">AI Talk</div>
      <div class="footer-copyright">&copy; ${new Date().getFullYear()} M-BIZ Global AG</div>
    </div>
  </div>
</body>
</html>`.trim()
  }

  async sendSupportReportNotice(r: { number: number; appId: string | null; source: string; fileCount: number; failures: string[]; reportId: string; reporterEmail: string | null; note: string }) {
    const to = getFeedbackRecipient()
    if (!to) return { success: false, error: 'Feedback recipient not configured' }
    const link = `${getAppBaseUrl()}${OPERATOR_PATH}/reports?id=${encodeURIComponent(r.reportId)}`
    const subject = `New report #${r.number} · ${r.appId ?? 'work app'} · ${r.fileCount} file(s)${r.failures.length ? ` · ${r.failures.join(', ')}` : ''}`
    const html = this.supportShell('en', `Report #${r.number}`, `
      <div class="details-box">
        <p><strong>Reporter:</strong> ${escapeHtml(r.reporterEmail ?? '-')}</p>
        <p><strong>App:</strong> ${escapeHtml(r.appId ?? '-')}</p>
        <p><strong>From:</strong> ${escapeHtml(r.source)}</p>
        <p><strong>Files:</strong> ${r.fileCount}</p>
        <p><strong>Read failures:</strong> ${escapeHtml(r.failures.join(', ') || '-')}</p>
      </div>
      <div class="message">
        <strong>Note:</strong>
        <p style="white-space: pre-wrap;">${escapeHtml(r.note || '-')}</p>
      </div>
      <p><a href="${escapeHtml(link)}">Open in console</a> — files and the chat excerpt are there.</p>`)
    return this.sendEmail({ to, subject, html, ...(r.reporterEmail ? { replyTo: r.reporterEmail } : {}) })
  }

  async sendSupportReceivedEmail(to: string, language: unknown, r: { number?: number; fileCount?: number }) {
    const lang = safeLang(language)
    const T = SUPPORT_TEXT[lang === 'de' || lang === 'fr' || lang === 'ko' ? lang : 'en']
    const files = r.fileCount ? `<p>${escapeHtml(T.files.replace('{n}', String(r.fileCount)))}</p>` : ''
    const subject = r.number ? T.subjectReport.replace('{n}', String(r.number)) : T.subjectFeedback
    const html = this.supportShell(lang, subject, `
      <div class="message">
        <p>${escapeHtml(r.number ? T.bodyReport.replace('{n}', String(r.number)) : T.bodyFeedback)}</p>
        <p>${escapeHtml(T.when)}</p>
        ${files}
        <p>${escapeHtml(T.sign)}</p>
      </div>`)
    return this.sendEmail({ to, subject, html })
  }

  async sendSupportReplyEmail(to: string, language: unknown, r: { number: number; text: string }) {
    const lang = safeLang(language)
    const T = SUPPORT_TEXT[lang === 'de' || lang === 'fr' || lang === 'ko' ? lang : 'en']
    const subject = T.subjectReply.replace('{n}', String(r.number))
    const html = this.supportShell(lang, subject, `
      <div class="message">
        <p style="white-space: pre-wrap;">${escapeHtml(r.text)}</p>
        <p>${escapeHtml(T.sign)}</p>
      </div>`)
    return this.sendEmail({ to, subject, html })
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

const SUPPORT_TEXT: Record<'en' | 'de' | 'fr' | 'ko', { subjectReport: string; subjectFeedback: string; subjectReply: string; bodyReport: string; bodyFeedback: string; when: string; files: string; sign: string }> = {
  en: {
    subjectReport: 'We received your report #{n}',
    subjectFeedback: 'We received your feedback',
    subjectReply: 'Your report #{n} — our answer',
    bodyReport: 'Thank you — we received your report #{n}.',
    bodyFeedback: 'Thank you — we received your feedback.',
    when: 'We will analyse it, fix the problem and get back to you within 24–48 hours (excluding weekends and Swiss public holidays).',
    files: 'We use the {n} file(s) you agreed to share only to solve this problem.',
    sign: 'AI Talk Support',
  },
  de: {
    subjectReport: 'Wir haben Ihre Meldung #{n} erhalten',
    subjectFeedback: 'Wir haben Ihr Feedback erhalten',
    subjectReply: 'Ihre Meldung #{n} – unsere Antwort',
    bodyReport: 'Vielen Dank – wir haben Ihre Meldung #{n} erhalten.',
    bodyFeedback: 'Vielen Dank – wir haben Ihr Feedback erhalten.',
    when: 'Wir analysieren sie, beheben das Problem und melden uns innerhalb von 24–48 Stunden (ohne Wochenenden und Schweizer Feiertage).',
    files: 'Die {n} Datei(en), die Sie freigegeben haben, verwenden wir nur zur Lösung dieses Problems.',
    sign: 'AI Talk Support',
  },
  fr: {
    subjectReport: 'Nous avons reçu votre signalement n° {n}',
    subjectFeedback: 'Nous avons reçu votre avis',
    subjectReply: 'Votre signalement n° {n} — notre réponse',
    bodyReport: 'Merci — nous avons reçu votre signalement n° {n}.',
    bodyFeedback: 'Merci — nous avons reçu votre avis.',
    when: 'Nous l’analysons, corrigeons le problème et revenons vers vous dans les 24 à 48 heures (hors week-ends et jours fériés suisses).',
    files: 'Nous utilisons le(s) {n} fichier(s) que vous avez accepté de partager uniquement pour résoudre ce problème.',
    sign: 'Support AI Talk',
  },
  ko: {
    subjectReport: '문제 알림 #{n} 을 받았습니다',
    subjectFeedback: '보내 주신 의견을 받았습니다',
    subjectReply: '문제 알림 #{n} — 답변',
    bodyReport: '감사합니다 — 문제 알림 #{n} 을 받았습니다.',
    bodyFeedback: '감사합니다 — 보내 주신 의견을 받았습니다.',
    when: '24~48시간 안에(주말 및 스위스 법정 공휴일 제외) 분석하고 문제를 해결한 뒤 알려 드리겠습니다.',
    files: '보여 주기로 동의하신 파일 {n} 개는 이 문제를 해결하는 데에만 씁니다.',
    sign: 'AI Talk 지원팀',
  },
}

export const emailService = new EmailService()
