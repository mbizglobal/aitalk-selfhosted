
import { appTranslations } from '@/lib/translations/app'
import { EmailClient } from '@azure/communication-email'
import { sendRoutedEmail } from '@/lib/email-routing'
import { isSelfHosted } from '@/lib/edition'
import { VENDOR_LEAD_INBOX, VENDOR_OPS_BCC } from '@/lib/vendor-contacts'

// Azure ACS Email client
const connectionString = process.env.ACS_CONNECTION_STRING
const emailClient = connectionString ? new EmailClient(connectionString) : null

interface EmailResponse {
  success: boolean
  messageId?: string
  error?: string
}

export type EmailLanguage = 'en' | 'de' | 'fr' | 'es' | 'ko'

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export class EmailServiceV2 {
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
    bcc?: string
  }): Promise<EmailResponse> {
    return sendRoutedEmail(data, this.fromEmail, (d) => this.sendViaAcs(d))
  }

  private async sendViaAcs(data: {
    to: string
    subject: string
    html: string
    from?: string
    bcc?: string
  }): Promise<EmailResponse> {
    if (!emailClient) {
      return { success: false, error: 'ACS Email client not configured' }
    }

    try {
      const poller = await emailClient.beginSend({
        senderAddress: data.from || this.fromEmail,
        content: { subject: data.subject, html: data.html },
        recipients: {
          to: [{ address: data.to }],
          ...(data.bcc && { bcc: [{ address: data.bcc }] }),
        },
      })

      const result = await poller.pollUntilDone()

      if (result.status === 'Succeeded') {
        return { success: true, messageId: result.id }
      }
      return { success: false, error: `Email send status: ${result.status}` }
    } catch (error) {
      console.error('[EmailServiceV2] Send error:', error instanceof Error ? error.message : String(error))
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async sendPaymentSuccessEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    planType: string
    billingCycle?: string | null
    amount: string
    currency: string
    paymentDate: Date
    paymentNumber: string
    nextRenewalDate?: Date | null
  }): Promise<EmailResponse> {
    const { to, name, language, planType, billingCycle, amount, currency, paymentDate, paymentNumber, nextRenewalDate } = params

    const t = appTranslations[language] || appTranslations.en

    const planName = billingCycle
      ? `${planType.charAt(0).toUpperCase() + planType.slice(1)} (${billingCycle})`
      : planType.charAt(0).toUpperCase() + planType.slice(1)

    const formatDate = (date: Date) => {
      const localeMap: Record<EmailLanguage, string> = {
        en: 'en-US',
        de: 'de-DE',
        fr: 'fr-FR',
        es: 'es-ES',
        ko: 'ko-KR'
      }
      return date.toLocaleDateString(localeMap[language], {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    const formattedPaymentDate = formatDate(paymentDate)
    const formattedNextRenewal = nextRenewalDate ? formatDate(nextRenewalDate) : '-'

    const html = this.generatePaymentSuccessHTML({
      t,
      name,
      planName,
      amount: `${currency.toUpperCase()} ${amount}`,
      paymentDate: formattedPaymentDate,
      paymentNumber,
      nextRenewalDate: formattedNextRenewal,
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_payment_success_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendCancellationEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    planType: string
    billingCycle?: string | null
    serviceEndDate: Date
  }): Promise<EmailResponse> {
    const { to, name, language, planType, billingCycle, serviceEndDate } = params

    const t = appTranslations[language] || appTranslations.en

    const planName = billingCycle
      ? `${planType.charAt(0).toUpperCase() + planType.slice(1)} (${billingCycle})`
      : planType.charAt(0).toUpperCase() + planType.slice(1)

    const formatDate = (date: Date) => {
      const localeMap: Record<EmailLanguage, string> = {
        en: 'en-US',
        de: 'de-DE',
        fr: 'fr-FR',
        es: 'es-ES',
        ko: 'ko-KR'
      }
      return date.toLocaleDateString(localeMap[language], {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    const formattedEndDate = formatDate(serviceEndDate)

    const html = this.generateCancellationHTML({
      t,
      name,
      planName,
      serviceEndDate: formattedEndDate,
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_cancellation_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendSubscriptionExpiredEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    previousPlan: string
    previousBillingCycle?: string | null
    effectiveDate: Date
  }): Promise<EmailResponse> {
    const { to, name, language, previousPlan, previousBillingCycle, effectiveDate } = params

    const t = appTranslations[language] || appTranslations.en

    const planName = previousBillingCycle
      ? `${previousPlan.charAt(0).toUpperCase() + previousPlan.slice(1)} (${previousBillingCycle})`
      : previousPlan.charAt(0).toUpperCase() + previousPlan.slice(1)

    const formatDate = (date: Date) => {
      const localeMap: Record<EmailLanguage, string> = {
        en: 'en-US',
        de: 'de-DE',
        fr: 'fr-FR',
        es: 'es-ES',
        ko: 'ko-KR'
      }
      return date.toLocaleDateString(localeMap[language], {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    const formattedDate = formatDate(effectiveDate)

    const html = this.generateSubscriptionExpiredHTML({
      t,
      name,
      previousPlanName: planName,
      effectiveDate: formattedDate,
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_expired_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendInternalOpsAlert(params: {
    subject: string
    lines: Array<{ label: string; value: string }>
    note?: string
    to?: string
  }): Promise<EmailResponse> {
    const rows = params.lines
      .map(
        (l) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap">${escapeHtml(l.label.slice(0, 80))}</td>` +
          `<td style="padding:6px 0;font-family:monospace">${escapeHtml(l.value.slice(0, 2000))}</td></tr>`
      )
      .join('')
    const note = params.note ? `<p style="color:#555;font-size:13px">${escapeHtml(params.note.slice(0, 2000))}</p>` : ''
    const html =
      `<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#111">` +
      `<h2 style="color:#B45309;margin:0 0 4px">${escapeHtml(params.subject.slice(0, 200))}</h2>` +
      `<p style="color:#888;font-size:12px;margin:0 0 16px">AiTalk 내부 운영 알림 — 고객 발송 아님</p>` +
      `<table style="border-collapse:collapse;font-size:14px">${rows}</table>${note}</div>`
    return this.sendEmail({
      to: params.to ?? 'support@aitalk.ch',
      subject: `[AiTalk Ops] ${params.subject}`,
      html,
      from: 'support@aitalk.ch',
    })
  }

  async sendBookingWidgetEmail(params: {
    to: string
    subject: string
    heading: string
    lines: Array<{ label: string; value: string }>
    paragraphs: string[]
    bodyHtml?: string
    footer: string
  }): Promise<EmailResponse> {
    const esc = (s: string, n: number) => escapeHtml(String(s).slice(0, n))
    const paragraphs = params.paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p, 500)}</p>`).join('')
    const rows = params.lines
      .map(
        (l) =>
          `<tr><td style="padding:6px 16px 6px 0;color:#666;white-space:nowrap;vertical-align:top">${esc(l.label, 60)}</td>` +
          `<td style="padding:6px 0;white-space:pre-wrap">${esc(l.value, 600)}</td></tr>`
      )
      .join('')
    const html =
      `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;font-size:15px;line-height:1.5">` +
      `<h2 style="margin:0 0 16px;font-size:20px">${esc(params.heading, 200)}</h2>` +
      paragraphs +
      (params.bodyHtml ? `<p style="margin:0 0 12px">${params.bodyHtml}</p>` : '') +
      (rows ? `<table style="border-collapse:collapse;margin:8px 0 16px">${rows}</table>` : '') +
      `<p style="color:#888;font-size:12px;margin:24px 0 0">${esc(params.footer, 300)}</p></div>`
    return this.sendEmail({ to: params.to, subject: params.subject.replace(/[\r\n]+/g, ' ').slice(0, 200), html })
  }

  async sendTrialEndedEmail(params: {
    to: string
    name: string
    language: EmailLanguage
  }): Promise<EmailResponse> {
    const { to, language } = params
    const name = escapeHtml(params.name.slice(0, 100))
    const c: Record<EmailLanguage, { subject: string; title: string; body: string; cta: string }> = {
      en: { subject: 'Your AiTalk trial has ended', title: 'Your trial has ended', body: `Hi ${name}, your 14-day trial has ended. Subscribe any time within the next 6 months to keep your agent and data — otherwise they will be deleted.`, cta: 'Choose a plan' },
      de: { subject: 'Ihre AiTalk-Testphase ist beendet', title: 'Ihre Testphase ist beendet', body: `Hallo ${name}, Ihre 14-tägige Testphase ist beendet. Abonnieren Sie innerhalb der nächsten 6 Monate, um Agent und Daten zu behalten — andernfalls werden sie gelöscht.`, cta: 'Plan wählen' },
      fr: { subject: 'Votre essai AiTalk est terminé', title: 'Votre essai est terminé', body: `Bonjour ${name}, votre essai de 14 jours est terminé. Abonnez-vous dans les 6 prochains mois pour conserver votre agent et vos données — sinon elles seront supprimées.`, cta: 'Choisir une offre' },
      es: { subject: 'Tu prueba de AiTalk ha finalizado', title: 'Tu prueba ha finalizado', body: `Hola ${name}, tu prueba de 14 días ha finalizado. Suscríbete en los próximos 6 meses para conservar tu agente y tus datos — de lo contrario se eliminarán.`, cta: 'Elegir un plan' },
      ko: { subject: 'AiTalk 체험이 종료되었습니다', title: '체험이 종료되었습니다', body: `${name}님, 14일 체험이 종료되었습니다. 앞으로 6개월 안에 결제하시면 에이전트와 데이터가 유지됩니다 — 그렇지 않으면 삭제됩니다.`, cta: '플랜 선택' },
    }
    const m = c[language] || c.en
    const url = 'https://www.aitalk.ch/app/subscription'
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111"><h2 style="color:#14B8A6">${m.title}</h2><p>${m.body}</p><p><a href="${url}" style="display:inline-block;background:#14B8A6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${m.cta}</a></p></div>`
    return this.sendEmail({ to, subject: m.subject, html, from: 'support@aitalk.ch' })
  }

  async sendTrialDeleteWarningEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    deleteDate: Date
  }): Promise<EmailResponse> {
    const { to, language, deleteDate } = params
    const name = escapeHtml(params.name.slice(0, 100))
    const localeMap: Record<EmailLanguage, string> = { en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', ko: 'ko-KR' }
    const d = deleteDate.toLocaleDateString(localeMap[language] || 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const c: Record<EmailLanguage, { subject: string; title: string; body: string; cta: string }> = {
      en: { subject: 'Action needed: your AiTalk data will be deleted in 7 days', title: 'Your data will be deleted in 7 days', body: `Hi ${name}, your trial ended and your account and data are scheduled for permanent deletion on ${d}. Subscribe before then to keep everything.`, cta: 'Keep my account' },
      de: { subject: 'Wichtig: Ihre AiTalk-Daten werden in 7 Tagen gelöscht', title: 'Ihre Daten werden in 7 Tagen gelöscht', body: `Hallo ${name}, Ihre Testphase ist beendet und Ihr Konto samt Daten wird am ${d} endgültig gelöscht. Abonnieren Sie vorher, um alles zu behalten.`, cta: 'Konto behalten' },
      fr: { subject: 'Action requise : vos données AiTalk seront supprimées dans 7 jours', title: 'Vos données seront supprimées dans 7 jours', body: `Bonjour ${name}, votre essai est terminé et votre compte et vos données seront définitivement supprimés le ${d}. Abonnez-vous avant pour tout conserver.`, cta: 'Conserver mon compte' },
      es: { subject: 'Acción necesaria: tus datos de AiTalk se eliminarán en 7 días', title: 'Tus datos se eliminarán en 7 días', body: `Hola ${name}, tu prueba ha finalizado y tu cuenta y datos se eliminarán definitivamente el ${d}. Suscríbete antes para conservarlo todo.`, cta: 'Conservar mi cuenta' },
      ko: { subject: '확인 필요: AiTalk 데이터가 7일 후 삭제됩니다', title: '데이터가 7일 후 삭제됩니다', body: `${name}님, 체험이 종료되어 계정과 데이터가 ${d}에 영구 삭제될 예정입니다. 그 전에 결제하시면 모두 유지됩니다.`, cta: '계정 유지하기' },
    }
    const m = c[language] || c.en
    const url = 'https://www.aitalk.ch/app/subscription'
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111"><h2 style="color:#dc2626">${m.title}</h2><p>${m.body}</p><p><a href="${url}" style="display:inline-block;background:#14B8A6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${m.cta}</a></p></div>`
    return this.sendEmail({ to, subject: m.subject, html, from: 'support@aitalk.ch' })
  }

  async sendConsentExportEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    kind: 'ready' | 'expiring' | 'purged'
    rowCount: number
    purgeDate: Date
    daysLeft?: number
    downloaded?: boolean
    url: string
  }): Promise<EmailResponse> {
    const { to, language, kind, rowCount, purgeDate, url } = params
    const name = escapeHtml(params.name.slice(0, 100))
    const localeMap: Record<EmailLanguage, string> = { en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', ko: 'ko-KR' }
    const d = purgeDate.toLocaleDateString(localeMap[language] || 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const n = String(rowCount)
    const left = String(params.daysLeft ?? 0)
    const gone = params.downloaded === true

    const c: Record<EmailLanguage, Record<'ready' | 'expiring' | 'purged', { subject: string; title: string; body: string }> & { cta: string; note: string }> = {
      en: {
        cta: 'Download the record', note: 'You need to sign in to download. The link does not contain the file itself.',
        ready: { subject: `Your consent record is ready to download (${n} entries)`, title: 'Your consent record is ready', body: `Hi ${name}, we have packaged ${n} consent entries from your phone quiz programme as a CSV file. Please download and store it — you are the controller for this record, and we delete our copy on ${d}.` },
        expiring: { subject: `Reminder: your consent record is deleted in ${left} day(s)`, title: `We delete our copy in ${left} day(s)`, body: `Hi ${name}, your consent record (${n} entries) is still waiting. We delete our copy on ${d} and cannot restore it afterwards.` },
        purged: { subject: 'Your consent record has been deleted from our systems', title: 'Deleted as scheduled', body: gone ? `Hi ${name}, as scheduled we deleted our copy of the consent record (${n} entries) on ${d}. You downloaded it earlier, so your own copy is unaffected.` : `Hi ${name}, as scheduled we deleted our copy of the consent record (${n} entries) on ${d}. It was never downloaded. If you need this record for a regulator, you no longer have it — please download future exports promptly.` },
      },
      de: {
        cta: 'Nachweis herunterladen', note: 'Zum Herunterladen ist eine Anmeldung nötig. Der Link enthält die Datei nicht.',
        ready: { subject: `Ihr Einwilligungsnachweis steht bereit (${n} Einträge)`, title: 'Ihr Einwilligungsnachweis steht bereit', body: `Guten Tag ${name}, wir haben ${n} Einwilligungen aus Ihrem Telefon-Quiz als CSV-Datei zusammengestellt. Bitte laden Sie diese herunter und bewahren Sie sie auf — Sie sind für diesen Nachweis verantwortlich, unsere Kopie löschen wir am ${d}.` },
        expiring: { subject: `Erinnerung: Löschung Ihres Einwilligungsnachweises in ${left} Tag(en)`, title: `Wir löschen unsere Kopie in ${left} Tag(en)`, body: `Guten Tag ${name}, Ihr Einwilligungsnachweis (${n} Einträge) wartet noch. Wir löschen unsere Kopie am ${d} und können sie danach nicht wiederherstellen.` },
        purged: { subject: 'Ihr Einwilligungsnachweis wurde bei uns gelöscht', title: 'Wie angekündigt gelöscht', body: gone ? `Guten Tag ${name}, wie angekündigt haben wir unsere Kopie des Einwilligungsnachweises (${n} Einträge) am ${d} gelöscht. Sie hatten die Datei zuvor heruntergeladen.` : `Guten Tag ${name}, wie angekündigt haben wir unsere Kopie des Einwilligungsnachweises (${n} Einträge) am ${d} gelöscht. Die Datei wurde nie heruntergeladen. Bitte laden Sie künftige Nachweise zeitnah herunter.` },
      },
      fr: {
        cta: 'Télécharger le registre', note: 'Une connexion est requise pour télécharger. Le lien ne contient pas le fichier.',
        ready: { subject: `Votre registre de consentement est prêt (${n} entrées)`, title: 'Votre registre de consentement est prêt', body: `Bonjour ${name}, nous avons regroupé ${n} consentements de votre quiz téléphonique dans un fichier CSV. Merci de le télécharger et de le conserver — vous êtes responsable de ce registre et nous supprimons notre copie le ${d}.` },
        expiring: { subject: `Rappel : suppression de votre registre dans ${left} jour(s)`, title: `Nous supprimons notre copie dans ${left} jour(s)`, body: `Bonjour ${name}, votre registre de consentement (${n} entrées) est toujours en attente. Nous supprimons notre copie le ${d} et ne pourrons pas la restaurer.` },
        purged: { subject: 'Votre registre de consentement a été supprimé chez nous', title: 'Supprimé comme prévu', body: gone ? `Bonjour ${name}, comme prévu nous avons supprimé notre copie du registre (${n} entrées) le ${d}. Vous l'aviez téléchargé auparavant.` : `Bonjour ${name}, comme prévu nous avons supprimé notre copie du registre (${n} entrées) le ${d}. Il n'a jamais été téléchargé. Merci de télécharger rapidement les prochains registres.` },
      },
      es: {
        cta: 'Descargar el registro', note: 'Debe iniciar sesión para descargar. El enlace no contiene el archivo.',
        ready: { subject: `Su registro de consentimiento está listo (${n} entradas)`, title: 'Su registro de consentimiento está listo', body: `Hola ${name}, hemos agrupado ${n} consentimientos de su quiz telefónico en un archivo CSV. Descárguelo y consérvelo — usted es el responsable de este registro y eliminamos nuestra copia el ${d}.` },
        expiring: { subject: `Recordatorio: eliminaremos su registro en ${left} día(s)`, title: `Eliminamos nuestra copia en ${left} día(s)`, body: `Hola ${name}, su registro de consentimiento (${n} entradas) sigue pendiente. Eliminamos nuestra copia el ${d} y no podremos restaurarla.` },
        purged: { subject: 'Su registro de consentimiento se ha eliminado de nuestros sistemas', title: 'Eliminado según lo previsto', body: gone ? `Hola ${name}, según lo previsto eliminamos nuestra copia del registro (${n} entradas) el ${d}. Usted ya lo había descargado.` : `Hola ${name}, según lo previsto eliminamos nuestra copia del registro (${n} entradas) el ${d}. Nunca se descargó. Descargue con prontitud los próximos registros.` },
      },
      ko: {
        cta: '기록 내려받기', note: '내려받으려면 로그인이 필요합니다. 링크에 파일이 들어 있지 않습니다.',
        ready: { subject: `동의 기록을 내려받으실 수 있습니다 (${n}건)`, title: '동의 기록이 준비됐습니다', body: `${name}님, 전화 퀴즈 프로그램의 동의 ${n}건을 CSV 파일로 묶었습니다. 내려받아 보관해 주세요 — 이 기록의 관리 책임은 고객사에 있고, 저희 사본은 ${d}에 지웁니다.` },
        expiring: { subject: `안내: 동의 기록을 ${left}일 뒤에 지웁니다`, title: `저희 사본을 ${left}일 뒤에 지웁니다`, body: `${name}님, 동의 기록(${n}건)을 아직 안 받으셨습니다. 저희 사본은 ${d}에 지우며 그 뒤에는 되살릴 수 없습니다.` },
        purged: { subject: '동의 기록을 저희 쪽에서 지웠습니다', title: '안내드린 대로 지웠습니다', body: gone ? `${name}님, 안내드린 대로 동의 기록(${n}건) 사본을 ${d}에 지웠습니다. 앞서 내려받으셨으므로 고객사 사본은 그대로입니다.` : `${name}님, 안내드린 대로 동의 기록(${n}건) 사본을 ${d}에 지웠습니다. 한 번도 내려받지 않으셨습니다. 감독기관에 제출할 일이 생기면 이 기록은 더 이상 없으니, 다음부터는 받으신 뒤 보관해 주세요.` },
      },
    }
    const pack = c[language] || c.en
    const m = pack[kind]
    const warn = kind === 'purged' && !gone
    const button = kind === 'purged'
      ? ''
      : `<p><a href="${url}" style="display:inline-block;background:#14B8A6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${pack.cta}</a></p><p style="color:#6b7280;font-size:13px">${pack.note}</p>`
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111"><h2 style="color:${warn ? '#dc2626' : '#111'}">${m.title}</h2><p>${m.body}</p>${button}</div>`
    return this.sendEmail({ to, subject: m.subject, html, from: 'support@aitalk.ch' })
  }

  async sendTrialRequestReceivedEmail(params: {
    to: string
    name: string
    language: EmailLanguage
  }): Promise<EmailResponse> {
    const { to, language } = params
    const name = escapeHtml(params.name.slice(0, 100))
    const c: Record<EmailLanguage, { subject: string; title: string; body: string }> = {
      en: { subject: 'We received your AiTalk trial request', title: 'Request received', body: `Hi ${name}, thank you for your interest in AiTalk. We have received your trial request and will get back to you as soon as possible.` },
      de: { subject: 'Wir haben Ihre AiTalk-Testanfrage erhalten', title: 'Anfrage erhalten', body: `Hallo ${name}, vielen Dank für Ihr Interesse an AiTalk. Wir haben Ihre Testanfrage erhalten und melden uns so schnell wie möglich.` },
      fr: { subject: 'Nous avons reçu votre demande d’essai AiTalk', title: 'Demande reçue', body: `Bonjour ${name}, merci de votre intérêt pour AiTalk. Nous avons bien reçu votre demande d’essai et reviendrons vers vous dès que possible.` },
      es: { subject: 'Hemos recibido tu solicitud de prueba de AiTalk', title: 'Solicitud recibida', body: `Hola ${name}, gracias por tu interés en AiTalk. Hemos recibido tu solicitud de prueba y te responderemos lo antes posible.` },
      ko: { subject: 'AiTalk 트라이얼 요청이 접수되었습니다', title: '요청이 접수되었습니다', body: `${name}님, AiTalk에 관심 가져 주셔서 감사합니다. 트라이얼 요청이 접수되었으며 가능한 빨리 처리해 연락드리겠습니다.` },
    }
    const m = c[language] || c.en
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111"><h2 style="color:#14B8A6">${m.title}</h2><p>${m.body}</p></div>`
    return this.sendEmail({ to, subject: m.subject, html, from: 'support@aitalk.ch' })
  }

  async sendVoiceQuizEraseBlockedEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    agentName: string
    lastFailure: string
  }): Promise<EmailResponse> {
    const name = escapeHtml(params.name.slice(0, 100))
    const agent = escapeHtml(params.agentName.slice(0, 100))
    const why = escapeHtml(params.lastFailure.slice(0, 120))
    const c: Record<EmailLanguage, { subject: string; title: string; body: string; act: string; note: string }> = {
      en: {
        subject: 'Action needed: a phone quiz deletion request is stuck',
        title: 'A deletion request could not be completed',
        body: `Hi ${name}, someone on your phone quiz programme (${agent}) asked us to delete their data. We removed everything on our side, but writing the change to your member sheet failed five times, so we stopped retrying.`,
        act: 'Please open the member sheet and delete the row for that person. Once the row is gone, the request closes by itself on our next sweep — you do not need to tell us.',
        note: `Last failure: ${why}`,
      },
      de: {
        subject: 'Handlung nötig: eine Löschanfrage im Telefon-Quiz hängt',
        title: 'Eine Löschanfrage konnte nicht abgeschlossen werden',
        body: `Guten Tag ${name}, eine Teilnehmerin oder ein Teilnehmer Ihres Telefon-Quiz (${agent}) hat die Löschung der Daten verlangt. Auf unserer Seite ist alles entfernt, das Schreiben in Ihre Mitglieder-Tabelle ist jedoch fünfmal fehlgeschlagen — wir versuchen es nicht weiter.`,
        act: 'Bitte öffnen Sie die Mitglieder-Tabelle und löschen Sie die betreffende Zeile. Danach schliesst sich die Anfrage bei unserem nächsten Durchlauf von selbst — eine Rückmeldung ist nicht nötig.',
        note: `Letzter Fehler: ${why}`,
      },
      fr: {
        subject: 'Action requise : une demande de suppression du quiz téléphonique est bloquée',
        title: 'Une demande de suppression n’a pas pu aboutir',
        body: `Bonjour ${name}, une personne inscrite à votre quiz téléphonique (${agent}) a demandé la suppression de ses données. Tout a été supprimé de notre côté, mais l’écriture dans votre feuille des membres a échoué cinq fois : nous avons cessé de réessayer.`,
        act: 'Merci d’ouvrir la feuille des membres et de supprimer la ligne concernée. La demande se clôturera d’elle-même lors de notre prochain passage — inutile de nous répondre.',
        note: `Dernière erreur : ${why}`,
      },
      es: {
        subject: 'Acción necesaria: una solicitud de borrado del quiz telefónico está bloqueada',
        title: 'No se pudo completar una solicitud de borrado',
        body: `Hola ${name}, una persona de su programa de quiz telefónico (${agent}) pidió borrar sus datos. Lo eliminamos todo por nuestra parte, pero la escritura en su hoja de miembros falló cinco veces y dejamos de reintentar.`,
        act: 'Abra la hoja de miembros y elimine la fila correspondiente. La solicitud se cerrará sola en nuestro siguiente barrido; no hace falta que nos responda.',
        note: `Último error: ${why}`,
      },
      ko: {
        subject: '조치 필요 — 전화 퀴즈 삭제 요청이 멈춰 있습니다',
        title: '삭제 요청을 끝내지 못했습니다',
        body: `${name} 님, 전화 퀴즈(${agent}) 참여자 한 분이 개인정보 삭제를 요청했습니다. 저희 쪽 자료는 모두 지웠지만 회원 시트에 반영하는 일이 다섯 번 실패해 재시도를 멈췄습니다.`,
        act: '회원 시트를 열어 해당 행을 지워 주세요. 행이 없어지면 다음 점검에서 요청이 저절로 닫힙니다 — 따로 알려 주지 않으셔도 됩니다.',
        note: `마지막 실패: ${why}`,
      },
    }
    const t = c[params.language] ?? c.en
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111"><h2 style="color:#DC2626">${escapeHtml(t.title)}</h2><p style="line-height:1.6">${escapeHtml(t.body)}</p><p style="line-height:1.6"><b>${escapeHtml(t.act)}</b></p><p style="font-size:12px;color:#888">${escapeHtml(t.note)}</p></div>`
    return this.sendEmail({ to: params.to, subject: t.subject, html, from: 'support@aitalk.ch' })
  }

  async sendTrialRequestAdminEmail(params: {
    companyName: string
    contactName: string
    email: string
    phone?: string | null
    country: string
    useCase?: string | null
    channel: 'web' | 'app'
  }): Promise<EmailResponse> {
    const companyName = escapeHtml(params.companyName.slice(0, 200))
    const contactName = escapeHtml(params.contactName.slice(0, 200))
    const email = escapeHtml(params.email.slice(0, 200))
    const phone = escapeHtml((params.phone || '-').slice(0, 40))
    const country = escapeHtml(params.country.slice(0, 8))
    const useCase = escapeHtml((params.useCase || '-').slice(0, 1000))
    const channel = params.channel === 'app' ? 'App' : 'Web'
    const subject = `[AiTalk] 신규 트라이얼 요청 — ${companyName} (${email})`
    const row = (k: string, v: string) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${k}</td><td style="padding:4px 0">${v}</td></tr>`
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111"><h2 style="color:#14B8A6">신규 트라이얼 요청</h2><p>새 트라이얼 요청이 접수되었습니다. console 에서 검토·승인하세요.</p><table style="border-collapse:collapse;font-size:14px">${row('회사', `<b>${companyName}</b>`)}${row('담당자', contactName)}${row('이메일', email)}${row('전화', phone)}${row('국가', country)}${row('용도', useCase)}${row('채널', channel)}</table></div>`
    return this.sendEmail({ to: VENDOR_LEAD_INBOX, subject, html, from: 'support@aitalk.ch' })
  }

  async sendTrialApprovedEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    source?: string
    baseUrl?: string
  }): Promise<EmailResponse> {
    const { to, language } = params
    const name = escapeHtml(params.name.slice(0, 100))
    const c: Record<EmailLanguage, { subject: string; title: string; body: string; cta: string }> = {
      en: { subject: 'Your AiTalk trial is now active', title: 'Trial activated', body: `Hi ${name}, your trial request has been approved. Sign in to start your 14-day trial.`, cta: 'Sign in' },
      de: { subject: 'Ihre AiTalk-Testphase ist jetzt aktiv', title: 'Testphase aktiviert', body: `Hallo ${name}, Ihre Testanfrage wurde genehmigt. Melden Sie sich an, um Ihre 14-tägige Testphase zu starten.`, cta: 'Anmelden' },
      fr: { subject: 'Votre essai AiTalk est maintenant actif', title: 'Essai activé', body: `Bonjour ${name}, votre demande d’essai a été approuvée. Connectez-vous pour démarrer votre essai de 14 jours.`, cta: 'Se connecter' },
      es: { subject: 'Tu prueba de AiTalk ya está activa', title: 'Prueba activada', body: `Hola ${name}, tu solicitud de prueba ha sido aprobada. Inicia sesión para comenzar tu prueba de 14 días.`, cta: 'Iniciar sesión' },
      ko: { subject: 'AiTalk 트라이얼이 활성화되었습니다', title: '트라이얼 활성화', body: `${name}님, 트라이얼 요청이 승인되었습니다. 로그인하여 14일 체험을 시작하세요.`, cta: '로그인' },
    }
    const m = c[language] || c.en
    const base = params.baseUrl || 'https://www.aitalk.ch'
    const url = params.source === 'app'
      ? `${base}/auth/open-app?lang=${language}`
      : `${base}/auth`
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111"><h2 style="color:#14B8A6">${m.title}</h2><p>${m.body}</p><p><a href="${url}" style="display:inline-block;background:#14B8A6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${m.cta}</a></p></div>`
    return this.sendEmail({ to, subject: m.subject, html, from: 'support@aitalk.ch' })
  }

  async sendTrialAutoActivatedAdminEmail(params: {
    email: string
    partnerCode: string
    partnerCountry?: string | null
    channel: 'web' | 'app'
  }): Promise<EmailResponse> {
    const email = escapeHtml(params.email.slice(0, 200))
    const code = escapeHtml(params.partnerCode.slice(0, 40))
    const country = escapeHtml((params.partnerCountry || '-').slice(0, 8))
    const channel = params.channel === 'app' ? 'App' : 'Web'
    const subject = `[AiTalk] 세일즈 코드 트라이얼 자동 활성화 — ${email}`
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111"><h2 style="color:#14B8A6">세일즈 코드 트라이얼 활성화</h2><p>세일즈(파트너) 코드 입력으로 14일 트라이얼이 자동 활성화되었습니다.</p><table style="border-collapse:collapse;font-size:14px"><tr><td style="padding:4px 12px 4px 0;color:#666">사용자</td><td style="padding:4px 0"><b>${email}</b></td></tr><tr><td style="padding:4px 12px 4px 0;color:#666">세일즈 코드</td><td style="padding:4px 0">${code}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#666">파트너 국가</td><td style="padding:4px 0">${country}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#666">채널</td><td style="padding:4px 0">${channel}</td></tr></table></div>`
    return this.sendEmail({ to: VENDOR_LEAD_INBOX, subject, html, from: 'support@aitalk.ch' })
  }

  async sendTrialWelcomeSetPasswordEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    token: string
    baseUrl: string
  }): Promise<EmailResponse> {
    const { to, language, token, baseUrl } = params
    const name = escapeHtml(params.name.slice(0, 100))
    const url = `${baseUrl}/auth/reset-password?token=${token}&lang=${language}`
    const c: Record<EmailLanguage, { subject: string; title: string; body: string; cta: string; expire: string; ignore: string }> = {
      en: { subject: 'Welcome to AiTalk — activate your trial', title: 'Welcome to AiTalk', body: `Hi ${name}, your trial account is ready. Set your password to sign in and start your 14-day trial.`, cta: 'Set your password', expire: 'This link will expire in 24 hours.', ignore: "If you weren't expecting this email, you can safely ignore it." },
      de: { subject: 'Willkommen bei AiTalk — Testphase aktivieren', title: 'Willkommen bei AiTalk', body: `Hallo ${name}, Ihr Testkonto ist bereit. Legen Sie Ihr Passwort fest, um sich anzumelden und Ihre 14-tägige Testphase zu starten.`, cta: 'Passwort festlegen', expire: 'Dieser Link läuft in 24 Stunden ab.', ignore: 'Falls Sie diese E-Mail nicht erwartet haben, können Sie sie ignorieren.' },
      fr: { subject: 'Bienvenue chez AiTalk — activez votre essai', title: 'Bienvenue chez AiTalk', body: `Bonjour ${name}, votre compte d’essai est prêt. Définissez votre mot de passe pour vous connecter et démarrer votre essai de 14 jours.`, cta: 'Définir mon mot de passe', expire: 'Ce lien expirera dans 24 heures.', ignore: 'Si vous n’attendiez pas cet e-mail, vous pouvez l’ignorer.' },
      es: { subject: 'Bienvenido a AiTalk — activa tu prueba', title: 'Bienvenido a AiTalk', body: `Hola ${name}, tu cuenta de prueba está lista. Establece tu contraseña para iniciar sesión y comenzar tu prueba de 14 días.`, cta: 'Establecer mi contraseña', expire: 'Este enlace caducará en 24 horas.', ignore: 'Si no esperabas este correo, puedes ignorarlo.' },
      ko: { subject: 'AiTalk에 오신 것을 환영합니다 — 트라이얼 활성화', title: 'AiTalk에 오신 것을 환영합니다', body: `${name}님, 트라이얼 계정이 준비되었습니다. 비밀번호를 설정하면 로그인하여 14일 체험을 시작할 수 있습니다.`, cta: '비밀번호 설정', expire: '이 링크는 24시간 후 만료됩니다.', ignore: '이 이메일을 요청하지 않으셨다면 무시하셔도 됩니다.' },
    }
    const m = c[language] || c.en
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background:#14B8A6;padding:32px 24px;text-align:center;border-radius:12px 12px 0 0">
    <div style="font-size:40px;line-height:1">🎉</div>
    <h1 style="color:#ffffff;margin:12px 0 0;font-size:22px">${m.title}</h1>
  </div>
  <div style="padding:28px 24px;color:#1f2937;font-size:15px;line-height:1.6">
    <p style="margin:0 0 16px">${m.body}</p>
    <div style="background:#fff7ed;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:6px;margin:0 0 22px">
      <span style="color:#b45309;font-size:13px">⏱ ${m.expire}</span>
    </div>
    <p style="text-align:center;margin:0 0 24px">
      <a href="${url}" style="display:inline-block;background:#14B8A6;color:#ffffff;padding:13px 30px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">${m.cta}</a>
    </p>
    <p style="color:#6b7280;font-size:12px;margin:0">${m.ignore}</p>
  </div>
  <div style="padding:16px 24px;border-top:1px solid #e5e7eb;text-align:center">
    <a href="https://www.aitalk.ch" style="color:#14B8A6;text-decoration:none;font-size:13px;font-weight:bold">AiTalk.ch</a>
    <p style="color:#9ca3af;font-size:11px;margin:6px 0 0">© 2026 M-BIZ Global AG. All rights reserved.</p>
  </div>
</div>`
    return this.sendEmail({ to, subject: m.subject, html, from: 'support@aitalk.ch' })
  }

  async sendGracePeriodCustomerEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    planName: string
    invoiceNumber: string
    amount: number
    currency: string
    suspendDate: Date
    invoiceId?: string
  }): Promise<EmailResponse> {
    const { to, name, language, planName, invoiceNumber, amount, currency, suspendDate, invoiceId } = params

    const t = appTranslations[language] || appTranslations.en

    const localeMap: Record<EmailLanguage, string> = {
      en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', ko: 'ko-KR'
    }
    const formattedSuspendDate = suspendDate.toLocaleDateString(localeMap[language], {
      year: 'numeric', month: 'long', day: 'numeric'
    })

    const html = this.generateGracePeriodHTML({
      t,
      name,
      planName,
      invoiceNumber,
      amount: `${currency.toUpperCase()} ${amount.toFixed(2)}`,
      suspendDate: formattedSuspendDate,
      language,
      invoiceId
    })

    return this.sendEmail({
      to,
      subject: t.email_grace_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendSoftFreeCustomerEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    previousPlan: string
    previousBillingCycle?: string | null
    deletionDate: Date
    reason?: 'payment' | 'cancelled'
  }): Promise<EmailResponse> {
    const { to, name, language, previousPlan, previousBillingCycle, deletionDate, reason = 'payment' } = params

    const t = appTranslations[language] || appTranslations.en

    const localeMap: Record<EmailLanguage, string> = {
      en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', ko: 'ko-KR'
    }
    const planName = previousBillingCycle
      ? `${previousPlan.charAt(0).toUpperCase() + previousPlan.slice(1)} (${previousBillingCycle})`
      : previousPlan.charAt(0).toUpperCase() + previousPlan.slice(1)
    const formattedDeletionDate = deletionDate.toLocaleDateString(localeMap[language], {
      year: 'numeric', month: 'long', day: 'numeric'
    })

    const html = this.generateSoftFreeHTML({
      t,
      name,
      previousPlanName: planName,
      deletionDate: formattedDeletionDate,
      language,
      message: reason === 'cancelled'
        ? ((t as unknown as Record<string, string | undefined>).email_softfree_message_cancelled ?? appTranslations.en.email_softfree_message_cancelled)
        : t.email_softfree_message,
    })

    return this.sendEmail({
      to,
      subject: t.email_softfree_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendUpgradeEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    previousPlan: string
    previousBillingCycle?: string | null
    newPlan: string
    newBillingCycle?: string | null
    upgradeDate: Date
    proratedCharge: string
    currency: string
    nextBillingDate?: Date | null
  }): Promise<EmailResponse> {
    const { to, name, language, previousPlan, previousBillingCycle, newPlan, newBillingCycle, upgradeDate, proratedCharge, currency, nextBillingDate } = params

    const t = appTranslations[language] || appTranslations.en

    const formatPlanName = (plan: string, cycle?: string | null) => {
      return cycle
        ? `${plan.charAt(0).toUpperCase() + plan.slice(1)} (${cycle})`
        : plan.charAt(0).toUpperCase() + plan.slice(1)
    }

    const formatDate = (date: Date) => {
      const localeMap: Record<EmailLanguage, string> = {
        en: 'en-US',
        de: 'de-DE',
        fr: 'fr-FR',
        es: 'es-ES',
        ko: 'ko-KR'
      }
      return date.toLocaleDateString(localeMap[language], {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    const html = this.generateUpgradeHTML({
      t,
      name,
      previousPlanName: formatPlanName(previousPlan, previousBillingCycle),
      newPlanName: formatPlanName(newPlan, newBillingCycle),
      upgradeDate: formatDate(upgradeDate),
      proratedCharge: `${currency.toUpperCase()} ${proratedCharge}`,
      nextBillingDate: nextBillingDate ? formatDate(nextBillingDate) : '-',
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_upgrade_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendDowngradeEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    currentPlan: string
    currentBillingCycle?: string | null
    newPlan: string
    newBillingCycle?: string | null
    effectiveDate: Date
  }): Promise<EmailResponse> {
    const { to, name, language, currentPlan, currentBillingCycle, newPlan, newBillingCycle, effectiveDate } = params

    const t = appTranslations[language] || appTranslations.en

    const formatPlanName = (plan: string, cycle?: string | null) => {
      return cycle
        ? `${plan.charAt(0).toUpperCase() + plan.slice(1)} (${cycle})`
        : plan.charAt(0).toUpperCase() + plan.slice(1)
    }

    const formatDate = (date: Date) => {
      const localeMap: Record<EmailLanguage, string> = {
        en: 'en-US',
        de: 'de-DE',
        fr: 'fr-FR',
        es: 'es-ES',
        ko: 'ko-KR'
      }
      return date.toLocaleDateString(localeMap[language], {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    const html = this.generateDowngradeHTML({
      t,
      name,
      currentPlanName: formatPlanName(currentPlan, currentBillingCycle),
      newPlanName: formatPlanName(newPlan, newBillingCycle),
      effectiveDate: formatDate(effectiveDate),
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_downgrade_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendRenewalSuccessEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    planType: string
    billingCycle?: string | null
    amount: string
    currency: string
    paymentDate: Date
    paymentNumber: string
    nextRenewalDate?: Date | null
  }): Promise<EmailResponse> {
    const { to, name, language, planType, billingCycle, amount, currency, paymentDate, paymentNumber, nextRenewalDate } = params

    const t = appTranslations[language] || appTranslations.en

    const planName = billingCycle
      ? `${planType.charAt(0).toUpperCase() + planType.slice(1)} (${billingCycle})`
      : planType.charAt(0).toUpperCase() + planType.slice(1)

    const formatDate = (date: Date) => {
      const localeMap: Record<EmailLanguage, string> = {
        en: 'en-US',
        de: 'de-DE',
        fr: 'fr-FR',
        es: 'es-ES',
        ko: 'ko-KR'
      }
      return date.toLocaleDateString(localeMap[language], {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    const formattedPaymentDate = formatDate(paymentDate)
    const formattedNextRenewal = nextRenewalDate ? formatDate(nextRenewalDate) : '-'

    const html = this.generateRenewalSuccessHTML({
      t,
      name,
      planName,
      amount: `${currency.toUpperCase()} ${amount}`,
      paymentDate: formattedPaymentDate,
      paymentNumber,
      nextRenewalDate: formattedNextRenewal,
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_renewal_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendPaymentFailedEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    planType: string
    billingCycle?: string | null
    failureDate: Date
    updatePaymentUrl?: string
  }): Promise<EmailResponse> {
    const { to, name, language, planType, billingCycle, failureDate, updatePaymentUrl } = params

    const t = appTranslations[language] || appTranslations.en

    const planName = billingCycle
      ? `${planType.charAt(0).toUpperCase() + planType.slice(1)} (${billingCycle})`
      : planType.charAt(0).toUpperCase() + planType.slice(1)

    const formatDate = (date: Date) => {
      const localeMap: Record<EmailLanguage, string> = {
        en: 'en-US',
        de: 'de-DE',
        fr: 'fr-FR',
        es: 'es-ES',
        ko: 'ko-KR'
      }
      return date.toLocaleDateString(localeMap[language], {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    const formattedDate = formatDate(failureDate)

    const html = this.generatePaymentFailedHTML({
      t,
      name,
      planName,
      failureDate: formattedDate,
      updatePaymentUrl: updatePaymentUrl || 'https://www.aitalk.ch/app/subscription',
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_payment_failed_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendSubscriptionEndedEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    previousPlan: string
    previousBillingCycle?: string | null
    endDate: Date
  }): Promise<EmailResponse> {
    const { to, name, language, previousPlan, previousBillingCycle, endDate } = params

    const t = appTranslations[language] || appTranslations.en

    const planName = previousBillingCycle
      ? `${previousPlan.charAt(0).toUpperCase() + previousPlan.slice(1)} (${previousBillingCycle})`
      : previousPlan.charAt(0).toUpperCase() + previousPlan.slice(1)

    const formatDate = (date: Date) => {
      const localeMap: Record<EmailLanguage, string> = {
        en: 'en-US',
        de: 'de-DE',
        fr: 'fr-FR',
        es: 'es-ES',
        ko: 'ko-KR'
      }
      return date.toLocaleDateString(localeMap[language], {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    const html = this.generateSubscriptionEndedHTML({
      t,
      name,
      previousPlanName: planName,
      endDate: formatDate(endDate),
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_ended_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  private generatePaymentSuccessHTML(params: {
    t: any
    name: string
    planName: string
    amount: string
    paymentDate: string
    paymentNumber: string
    nextRenewalDate: string
    language: EmailLanguage
  }): string {
    const { t, name, planName, amount, paymentDate, paymentNumber, nextRenewalDate, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_payment_success_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
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
    .website-link {
      display: inline-block;
      margin-top: 15px;
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
    }
    .website-link:hover {
      text-decoration: underline;
    }
    .footer {
      background-color: #f9f9f9;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
    }
    .footer-links {
      margin: 20px 0;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">✓</div>
      <h1>${t.email_payment_success_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_payment_success_greeting} ${name},</div>
      <div class="message">${t.email_payment_success_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_payment_success_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_payment_success_plan}</span>
          <span class="detail-value">${planName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_payment_success_amount}</span>
          <span class="detail-value">${amount}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_payment_success_date}</span>
          <span class="detail-value">${paymentDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_payment_success_payment_number}</span>
          <span class="detail-value">${paymentNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_payment_success_next_renewal}</span>
          <span class="detail-value">${nextRenewalDate}</span>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app" class="cta-button">${t.email_payment_success_cta}</a>
        <br>
        <a href="https://www.aitalk.ch" class="website-link">${t.email_payment_success_visit} →</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_payment_success_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-links">
        <a href="https://www.aitalk.ch" style="color: #667eea; text-decoration: none; margin: 0 10px;">www.aitalk.ch</a>
      </div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateCancellationHTML(params: {
    t: any
    name: string
    planName: string
    serviceEndDate: string
    language: EmailLanguage
  }): string {
    const { t, name, planName, serviceEndDate, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_cancellation_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .info-box {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .info-title {
      font-weight: 600;
      color: #856404;
      margin-bottom: 8px;
    }
    .info-text {
      color: #856404;
      font-size: 14px;
      line-height: 1.6;
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">⏸️</div>
      <h1>${t.email_cancellation_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_cancellation_greeting} ${name},</div>
      <div class="message">${t.email_cancellation_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_cancellation_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_cancellation_current_plan}</span>
          <span class="detail-value">${planName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_cancellation_service_until}</span>
          <span class="detail-value">${serviceEndDate}</span>
        </div>
      </div>

      <div class="info-box">
        <div class="info-title">${t.email_cancellation_what_happens}</div>
        <div class="info-text">${t.email_cancellation_what_happens_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app/subscription" class="cta-button">${t.email_cancellation_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_cancellation_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateSubscriptionExpiredHTML(params: {
    t: any
    name: string
    previousPlanName: string
    effectiveDate: string
    language: EmailLanguage
  }): string {
    const { t, name, previousPlanName, effectiveDate, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_expired_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .info-box {
      background-color: #e3f2fd;
      border-left: 4px solid #2196f3;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .info-title {
      font-weight: 600;
      color: #1565c0;
      margin-bottom: 8px;
    }
    .info-text {
      color: #1565c0;
      font-size: 14px;
      line-height: 1.6;
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">🔚</div>
      <h1>${t.email_expired_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_expired_greeting} ${name},</div>
      <div class="message">${t.email_expired_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_expired_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_expired_previous_plan}</span>
          <span class="detail-value">${previousPlanName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_expired_current_plan}</span>
          <span class="detail-value">Free</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_expired_effective_date}</span>
          <span class="detail-value">${effectiveDate}</span>
        </div>
      </div>

      <div class="info-box">
        <div class="info-title">${t.email_expired_free_limits_title}</div>
        <div class="info-text">${t.email_expired_free_limits_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app/subscription" class="cta-button">${t.email_expired_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_expired_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateGracePeriodHTML(params: {
    t: any
    name: string
    planName: string
    invoiceNumber: string
    amount: string
    suspendDate: string
    language: EmailLanguage
    invoiceId?: string
  }): string {
    const { t, name, planName, invoiceNumber, amount, suspendDate, language, invoiceId } = params
    const baseUrl = process.env.NEXTAUTH_URL || 'https://www.aitalk.ch'
    const ctaUrl = invoiceId
      ? `${baseUrl}/api/invoices/${invoiceId}/download`
      : 'https://www.aitalk.ch/app/subscription'

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_grace_title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
    .email-container { background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 40px 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 600; }
    .logo { margin-bottom: 15px; font-size: 48px; }
    .content { padding: 40px 30px; }
    .greeting { font-size: 18px; font-weight: 600; margin-bottom: 20px; color: #333; }
    .message { font-size: 16px; color: #555; margin-bottom: 30px; line-height: 1.8; }
    .details-box { background-color: #f9f9f9; border-left: 4px solid #f59e0b; border-radius: 4px; padding: 20px; margin-bottom: 30px; }
    .details-title { font-size: 18px; font-weight: 600; color: #d97706; margin-bottom: 15px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e0e0e0; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-weight: 600; color: #555; }
    .detail-value { color: #333; text-align: right; }
    .detail-value.highlight { color: #d97706; font-weight: 700; }
    .cta-button { display: inline-block; padding: 14px 30px; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; margin-bottom: 20px; }
    .footer { background-color: #f9f9f9; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0; }
    .footer-message { font-size: 14px; color: #666; margin-bottom: 20px; line-height: 1.6; }
    .footer-brand { font-size: 20px; font-weight: 700; color: #d97706; margin-bottom: 10px; }
    .footer-copyright { font-size: 12px; color: #999; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">⏳</div>
      <h1>${t.email_grace_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_grace_greeting} ${name},</div>
      <div class="message">${t.email_grace_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_grace_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_grace_plan}</span>
          <span class="detail-value">${planName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_grace_invoice_number}</span>
          <span class="detail-value">${invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_grace_amount}</span>
          <span class="detail-value">${amount}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_grace_suspend_date}</span>
          <span class="detail-value highlight">${suspendDate}</span>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="${ctaUrl}" class="cta-button">${t.email_grace_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_grace_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateSoftFreeHTML(params: {
    t: any
    name: string
    previousPlanName: string
    deletionDate: string
    language: EmailLanguage
    message: string
  }): string {
    const { t, name, previousPlanName, deletionDate, language, message } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_softfree_title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
    .email-container { background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: white; padding: 40px 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 600; }
    .logo { margin-bottom: 15px; font-size: 48px; }
    .content { padding: 40px 30px; }
    .greeting { font-size: 18px; font-weight: 600; margin-bottom: 20px; color: #333; }
    .message { font-size: 16px; color: #555; margin-bottom: 30px; line-height: 1.8; }
    .details-box { background-color: #f9f9f9; border-left: 4px solid #ef4444; border-radius: 4px; padding: 20px; margin-bottom: 30px; }
    .details-title { font-size: 18px; font-weight: 600; color: #b91c1c; margin-bottom: 15px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e0e0e0; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-weight: 600; color: #555; }
    .detail-value { color: #333; text-align: right; }
    .detail-value.highlight { color: #b91c1c; font-weight: 700; }
    .warning-box { background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px; padding: 15px 20px; margin-bottom: 30px; }
    .warning-title { font-weight: 600; color: #b91c1c; margin-bottom: 8px; }
    .warning-text { color: #b91c1c; font-size: 14px; line-height: 1.6; }
    .cta-button { display: inline-block; padding: 14px 30px; background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; margin-bottom: 20px; }
    .footer { background-color: #f9f9f9; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0; }
    .footer-message { font-size: 14px; color: #666; margin-bottom: 20px; line-height: 1.6; }
    .footer-brand { font-size: 20px; font-weight: 700; color: #b91c1c; margin-bottom: 10px; }
    .footer-copyright { font-size: 12px; color: #999; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">⚠️</div>
      <h1>${t.email_softfree_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_softfree_greeting} ${name},</div>
      <div class="message">${message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_softfree_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_softfree_previous_plan}</span>
          <span class="detail-value">${previousPlanName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_softfree_current_plan}</span>
          <span class="detail-value">${t.email_softfree_current_plan_value ?? appTranslations.en.email_softfree_current_plan_value}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_softfree_deletion_date}</span>
          <span class="detail-value highlight">${deletionDate}</span>
        </div>
      </div>

      <div class="warning-box">
        <div class="warning-title">${t.email_softfree_warning_title}</div>
        <div class="warning-text">${t.email_softfree_warning_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app/subscription" class="cta-button">${t.email_softfree_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_softfree_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateUpgradeHTML(params: {
    t: any
    name: string
    previousPlanName: string
    newPlanName: string
    upgradeDate: string
    proratedCharge: string
    nextBillingDate: string
    language: EmailLanguage
  }): string {
    const { t, name, previousPlanName, newPlanName, upgradeDate, proratedCharge, nextBillingDate, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_upgrade_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .info-box {
      background-color: #d1ecf1;
      border-left: 4px solid #17a2b8;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .info-title {
      font-weight: 600;
      color: #0c5460;
      margin-bottom: 8px;
    }
    .info-text {
      color: #0c5460;
      font-size: 14px;
      line-height: 1.6;
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">🚀</div>
      <h1>${t.email_upgrade_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_upgrade_greeting} ${name},</div>
      <div class="message">${t.email_upgrade_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_upgrade_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_upgrade_previous_plan}</span>
          <span class="detail-value">${previousPlanName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_upgrade_new_plan}</span>
          <span class="detail-value">${newPlanName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_upgrade_upgrade_date}</span>
          <span class="detail-value">${upgradeDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_upgrade_prorated_charge}</span>
          <span class="detail-value">${proratedCharge}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_upgrade_next_billing}</span>
          <span class="detail-value">${nextBillingDate}</span>
        </div>
      </div>

      <div class="info-box">
        <div class="info-title">${t.email_upgrade_whats_new}</div>
        <div class="info-text">${t.email_upgrade_whats_new_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app" class="cta-button">${t.email_upgrade_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_upgrade_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateDowngradeHTML(params: {
    t: any
    name: string
    currentPlanName: string
    newPlanName: string
    effectiveDate: string
    language: EmailLanguage
  }): string {
    const { t, name, currentPlanName, newPlanName, effectiveDate, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_downgrade_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .info-box {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .info-title {
      font-weight: 600;
      color: #856404;
      margin-bottom: 8px;
    }
    .info-text {
      color: #856404;
      font-size: 14px;
      line-height: 1.6;
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">📉</div>
      <h1>${t.email_downgrade_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_downgrade_greeting} ${name},</div>
      <div class="message">${t.email_downgrade_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_downgrade_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_downgrade_current_plan}</span>
          <span class="detail-value">${currentPlanName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_downgrade_new_plan}</span>
          <span class="detail-value">${newPlanName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_downgrade_effective_date}</span>
          <span class="detail-value">${effectiveDate}</span>
        </div>
      </div>

      <div class="info-box">
        <div class="info-title">${t.email_downgrade_what_changes}</div>
        <div class="info-text">${t.email_downgrade_what_changes_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app/subscription" class="cta-button">${t.email_downgrade_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_downgrade_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  async sendInvoiceEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    invoiceNumber: string
    planName: string
    amount: number
    currency: string
    dueDate: string
    invoiceId: string
  }): Promise<EmailResponse> {
    const { to, name, language, invoiceNumber, planName, amount, currency, dueDate, invoiceId } = params

    const t = appTranslations[language] || appTranslations.en

    const html = this.generateInvoiceHTML({
      t,
      name,
      invoiceNumber,
      planName,
      amount: `${currency.toUpperCase()} ${amount.toFixed(2)}`,
      dueDate,
      language,
      invoiceId
    })

    return this.sendEmail({
      to,
      subject: t.email_invoice_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendInvoiceUnpaidEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    invoiceNumber: string
    previousPlan: string
    currentPlan: string
    effectiveDate: string
  }): Promise<EmailResponse> {
    const { to, name, language, invoiceNumber, previousPlan, currentPlan, effectiveDate } = params

    const t = appTranslations[language] || appTranslations.en

    const html = this.generateInvoiceUnpaidHTML({
      t,
      name,
      invoiceNumber,
      previousPlan,
      currentPlan,
      effectiveDate,
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_invoice_unpaid_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendInvoicePaidEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    invoiceNumber: string
    planType: string
    billingCycle?: string | null
    amount: string
    currency: string
    paidDate: Date
    nextRenewalDate?: Date | null
  }): Promise<EmailResponse> {
    const { to, name, language, invoiceNumber, planType, billingCycle, amount, currency, paidDate, nextRenewalDate } = params

    const t = appTranslations[language] || appTranslations.en

    const planName = billingCycle
      ? `${planType.charAt(0).toUpperCase() + planType.slice(1)} (${billingCycle})`
      : planType.charAt(0).toUpperCase() + planType.slice(1)

    const formatDate = (date: Date) => {
      const localeMap: Record<EmailLanguage, string> = {
        en: 'en-US',
        de: 'de-DE',
        fr: 'fr-FR',
        es: 'es-ES',
        ko: 'ko-KR'
      }
      return date.toLocaleDateString(localeMap[language], {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    }

    const formattedPaidDate = formatDate(paidDate)
    const formattedNextRenewal = nextRenewalDate ? formatDate(nextRenewalDate) : '-'

    const html = this.generateInvoicePaidHTML({
      t,
      name,
      invoiceNumber,
      planName,
      amount: `${currency.toUpperCase()} ${amount}`,
      paidDate: formattedPaidDate,
      nextRenewalDate: formattedNextRenewal,
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_invoice_paid_subject.replace('{invoiceNumber}', invoiceNumber),
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  private generateSubscriptionEndedHTML(params: {
    t: any
    name: string
    previousPlanName: string
    endDate: string
    language: EmailLanguage
  }): string {
    const { t, name, previousPlanName, endDate, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_ended_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .info-box {
      background-color: #d1ecf1;
      border-left: 4px solid #17a2b8;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .info-title {
      font-weight: 600;
      color: #0c5460;
      margin-bottom: 8px;
    }
    .info-text {
      color: #0c5460;
      font-size: 14px;
      line-height: 1.6;
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">🔚</div>
      <h1>${t.email_ended_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_ended_greeting} ${name},</div>
      <div class="message">${t.email_ended_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_ended_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_ended_previous_plan}</span>
          <span class="detail-value">${previousPlanName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_ended_current_plan}</span>
          <span class="detail-value">Free</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_ended_end_date}</span>
          <span class="detail-value">${endDate}</span>
        </div>
      </div>

      <div class="info-box">
        <div class="info-title">${t.email_ended_what_now}</div>
        <div class="info-text">${t.email_ended_what_now_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app/subscription" class="cta-button">${t.email_ended_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_ended_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateRenewalSuccessHTML(params: {
    t: any
    name: string
    planName: string
    amount: string
    paymentDate: string
    paymentNumber: string
    nextRenewalDate: string
    language: EmailLanguage
  }): string {
    const { t, name, planName, amount, paymentDate, paymentNumber, nextRenewalDate, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_renewal_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
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
    .website-link {
      display: inline-block;
      margin-top: 15px;
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
    }
    .website-link:hover {
      text-decoration: underline;
    }
    .footer {
      background-color: #f9f9f9;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
    }
    .footer-links {
      margin: 20px 0;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">🔄</div>
      <h1>${t.email_renewal_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_renewal_greeting} ${name},</div>
      <div class="message">${t.email_renewal_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_renewal_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_renewal_plan}</span>
          <span class="detail-value">${planName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_renewal_amount}</span>
          <span class="detail-value">${amount}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_renewal_date}</span>
          <span class="detail-value">${paymentDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_renewal_payment_number}</span>
          <span class="detail-value">${paymentNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_renewal_next_renewal}</span>
          <span class="detail-value">${nextRenewalDate}</span>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app" class="cta-button">${t.email_renewal_cta}</a>
        <br>
        <a href="https://www.aitalk.ch" class="website-link">${t.email_renewal_visit} →</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_renewal_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-links">
        <a href="https://www.aitalk.ch" style="color: #667eea; text-decoration: none; margin: 0 10px;">www.aitalk.ch</a>
      </div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generatePaymentFailedHTML(params: {
    t: any
    name: string
    planName: string
    failureDate: string
    updatePaymentUrl: string
    language: EmailLanguage
  }): string {
    const { t, name, planName, failureDate, updatePaymentUrl, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_payment_failed_title}</title>
  <style>
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
      background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #e74c3c;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #e74c3c;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .warning-box {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .warning-title {
      font-weight: 600;
      color: #856404;
      margin-bottom: 8px;
    }
    .warning-text {
      color: #856404;
      font-size: 14px;
      line-height: 1.6;
    }
    .cta-button {
      display: inline-block;
      padding: 14px 30px;
      background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">⚠️</div>
      <h1>${t.email_payment_failed_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_payment_failed_greeting} ${name},</div>
      <div class="message">${t.email_payment_failed_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_payment_failed_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_payment_failed_plan}</span>
          <span class="detail-value">${planName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_payment_failed_date}</span>
          <span class="detail-value">${failureDate}</span>
        </div>
      </div>

      <div class="warning-box">
        <div class="warning-title">${t.email_payment_failed_what_happens}</div>
        <div class="warning-text">${t.email_payment_failed_what_happens_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="${updatePaymentUrl}" class="cta-button">${t.email_payment_failed_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_payment_failed_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateInvoiceHTML(params: {
    t: any
    name: string
    invoiceNumber: string
    planName: string
    amount: string
    dueDate: string
    language: EmailLanguage
    invoiceId: string
  }): string {
    const { t, name, invoiceNumber, planName, amount, dueDate, language, invoiceId } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_invoice_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .info-box {
      background-color: #d1ecf1;
      border-left: 4px solid #17a2b8;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .info-title {
      font-weight: 600;
      color: #0c5460;
      margin-bottom: 8px;
    }
    .info-text {
      color: #0c5460;
      font-size: 14px;
      line-height: 1.6;
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">📄</div>
      <h1>${t.email_invoice_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_invoice_greeting} ${name},</div>
      <div class="message">${t.email_invoice_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_invoice_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_number}</span>
          <span class="detail-value">${invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_plan}</span>
          <span class="detail-value">${planName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_amount}</span>
          <span class="detail-value">${amount}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_due_date}</span>
          <span class="detail-value">${dueDate}</span>
        </div>
      </div>

      <div class="info-box">
        <div class="info-title">${t.email_invoice_payment_instructions_title}</div>
        <div class="info-text">${t.email_invoice_payment_instructions_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="${process.env.NEXTAUTH_URL}/api/invoices/${invoiceId}/download" class="cta-button">${t.email_invoice_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_invoice_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateInvoicePaidHTML(params: {
    t: any
    name: string
    invoiceNumber: string
    planName: string
    amount: string
    paidDate: string
    nextRenewalDate: string
    language: EmailLanguage
  }): string {
    const { t, name, invoiceNumber, planName, amount, paidDate, nextRenewalDate, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_invoice_paid_title}</title>
  <style>
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
      background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #27ae60;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #27ae60;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .success-box {
      background-color: #d4edda;
      border-left: 4px solid #28a745;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .success-title {
      font-weight: 600;
      color: #155724;
      margin-bottom: 8px;
    }
    .success-text {
      color: #155724;
      font-size: 14px;
      line-height: 1.6;
    }
    .cta-button {
      display: inline-block;
      padding: 14px 30px;
      background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">✅</div>
      <h1>${t.email_invoice_paid_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_invoice_paid_greeting} ${name},</div>
      <div class="message">${t.email_invoice_paid_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_invoice_paid_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_paid_invoice_number}</span>
          <span class="detail-value">${invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_paid_plan}</span>
          <span class="detail-value">${planName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_paid_amount}</span>
          <span class="detail-value">${amount}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_paid_date}</span>
          <span class="detail-value">${paidDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_paid_next_renewal}</span>
          <span class="detail-value">${nextRenewalDate}</span>
        </div>
      </div>

      <div class="success-box">
        <div class="success-title">${t.email_invoice_paid_status}</div>
        <div class="success-text">${t.email_invoice_paid_status_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app" class="cta-button">${t.email_invoice_paid_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_invoice_paid_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateInvoiceUnpaidHTML(params: {
    t: any
    name: string
    invoiceNumber: string
    previousPlan: string
    currentPlan: string
    effectiveDate: string
    language: EmailLanguage
  }): string {
    const { t, name, invoiceNumber, previousPlan, currentPlan, effectiveDate, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_invoice_unpaid_title}</title>
  <style>
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
      background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #e74c3c;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #e74c3c;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .warning-box {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .warning-title {
      font-weight: 600;
      color: #856404;
      margin-bottom: 8px;
    }
    .warning-text {
      color: #856404;
      font-size: 14px;
      line-height: 1.6;
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">⚠️</div>
      <h1>${t.email_invoice_unpaid_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_invoice_unpaid_greeting} ${name},</div>
      <div class="message">${t.email_invoice_unpaid_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_invoice_unpaid_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_unpaid_invoice_number}</span>
          <span class="detail-value">${invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_unpaid_previous_plan}</span>
          <span class="detail-value">${previousPlan}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_unpaid_current_plan}</span>
          <span class="detail-value">${currentPlan}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_invoice_unpaid_effective_date}</span>
          <span class="detail-value">${effectiveDate}</span>
        </div>
      </div>

      <div class="warning-box">
        <div class="warning-title">${t.email_invoice_unpaid_what_happened_title}</div>
        <div class="warning-text">${t.email_invoice_unpaid_what_happened_text}</div>
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app/subscription" class="cta-button">${t.email_invoice_unpaid_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_invoice_unpaid_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  async sendEmailChangeVerificationEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    oldEmail: string
    newEmail: string
    verificationUrl: string
  }): Promise<EmailResponse> {
    const { to, name, language, oldEmail, newEmail, verificationUrl } = params

    const t = appTranslations[language] || appTranslations.en

    const html = this.generateEmailChangeHTML({
      t,
      name,
      oldEmail,
      newEmail,
      verificationUrl,
      language
    })

    return this.sendEmail({
      to,
      subject: t.email_change_subject,
      html,
      from: 'support@aitalk.ch'
    })
  }

  private generateEmailChangeHTML(params: {
    t: any
    name: string
    oldEmail: string
    newEmail: string
    verificationUrl: string
    language: EmailLanguage
  }): string {
    const { t, name, oldEmail, newEmail, verificationUrl, language } = params

    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_change_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .warning-box {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
    }
    .warning-text {
      color: #856404;
      font-size: 14px;
      line-height: 1.6;
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
    .expiry-text {
      font-size: 14px;
      color: #888;
      margin-top: 15px;
    }
    .footer {
      background-color: #f9f9f9;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
    }
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">📧</div>
      <h1>${t.email_change_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_change_greeting} ${name},</div>
      <div class="message">${t.email_change_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_change_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_change_old_email}</span>
          <span class="detail-value">${oldEmail}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_change_new_email}</span>
          <span class="detail-value">${newEmail}</span>
        </div>
      </div>

      <div class="warning-box">
        <div class="warning-text">${t.email_change_security_note}</div>
      </div>

      <div style="text-align: center;">
        <a href="${verificationUrl}" class="cta-button">${t.email_change_cta}</a>
        <div class="expiry-text">${t.email_change_expiry}</div>
      </div>
    </div>
    <div class="footer">
      <div class="footer-message">${t.email_change_footer}</div>
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">
        &copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}
      </div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  async sendScheduleCancelledEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    currentPlan: string
    cancelledPlan: string
    wasScheduledDate: string
  }): Promise<EmailResponse> {
    const { to, name, language, currentPlan, cancelledPlan, wasScheduledDate } = params

    const t = appTranslations[language] || appTranslations.en

    const html = `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_schedule_cancelled_title}</title>
  <style>
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
    .details-box {
      background-color: #f9f9f9;
      border-left: 4px solid #667eea;
      border-radius: 4px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
      text-align: right;
    }
    .info-box {
      background-color: #d4edda;
      border-left: 4px solid #28a745;
      border-radius: 4px;
      padding: 15px 20px;
      margin-bottom: 30px;
      color: #155724;
      font-size: 14px;
      line-height: 1.6;
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
    .footer-message {
      font-size: 14px;
      color: #666;
      margin-bottom: 20px;
      line-height: 1.6;
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
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">&#x2705;</div>
      <h1>${t.email_schedule_cancelled_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_schedule_cancelled_greeting} ${name},</div>
      <div class="message">${t.email_schedule_cancelled_message}</div>

      <div class="details-box">
        <div class="details-title">${t.email_schedule_cancelled_details_title}</div>
        <div class="detail-row">
          <span class="detail-label">${t.email_schedule_cancelled_current_plan}</span>
          <span class="detail-value">${currentPlan}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_schedule_cancelled_was_scheduled}</span>
          <span class="detail-value">${cancelledPlan}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_schedule_cancelled_was_scheduled_date}</span>
          <span class="detail-value">${wasScheduledDate}</span>
        </div>
      </div>

      <div class="info-box">
        ${t.email_schedule_cancelled_info}
      </div>

      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app" class="cta-button">${t.email_schedule_cancelled_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-message">${t.email_schedule_cancelled_footer}</div>
      <div class="footer-copyright">&copy; ${new Date().getFullYear()} M-BIZ GLOBAL AG. All rights reserved.</div>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to,
      subject: t.email_schedule_cancelled_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }
  async sendGracePeriodAdminAlert(params: {
    userId: string
    userEmail: string
    userName: string | null
    planType: string
    platform: string | null
    billingCycle: string | null
    serviceVariant: string | null
    endDate: Date
    graceStartedAt: Date
    daysSinceExpiry: number
    phase: 'grace' | 'soft_free' | 'hard_free_done'
    softFreeConvertedAt?: Date | null
  }): Promise<EmailResponse> {
    const {
      userId, userEmail, userName, planType, platform, billingCycle,
      serviceVariant, endDate, graceStartedAt, daysSinceExpiry, phase,
      softFreeConvertedAt
    } = params

    const consoleLink = `https://www.aitalk.ch/console/users/${userId}`
    const formatDate = (d: Date) => d.toISOString().split('T')[0]

    let subject: string
    let phaseLabel: string
    let statusColor: string
    let actionMessage: string

    if (phase === 'grace') {
      const daysRemaining = 5 - daysSinceExpiry
      subject = `[AITalk] Grace Period D+${daysSinceExpiry}: ${userEmail} (${planType})`
      phaseLabel = `Phase 1: Grace Period (Soft Free까지 ${daysRemaining}일 남음)`
      statusColor = '#f59e0b'
      actionMessage = `
        <li>결제 서비스 대시보드에서 결제 상태 확인</li>
        <li>Manual Invoice 입금 확인</li>
        <li>Console에서 end_date 연장 또는 유예 해제</li>
      `
    } else if (phase === 'soft_free') {
      const softDays = softFreeConvertedAt
        ? Math.floor((Date.now() - softFreeConvertedAt.getTime()) / (24 * 60 * 60 * 1000))
        : 0
      const daysToHard = 5 - softDays
      subject = `[AITalk] ⚠️ Soft Free → Hard Free D-${daysToHard}: ${userEmail}`
      phaseLabel = `Phase 2: Soft Free (Hard Free까지 ${daysToHard}일 — 데이터 삭제 예정!)`
      statusColor = '#ef4444'
      actionMessage = `
        <li><strong>긴급!</strong> Hard Free 전환 시 데이터가 삭제됩니다</li>
        <li>Managed: Azure AI Search 벡터 + Blob 전체 삭제</li>
        <li>Self: Agent 1개 외 나머지 삭제</li>
        <li>Console에서 유료 복구하면 모든 데이터 보존됩니다</li>
      `
    } else {
      subject = `[AITalk] Hard Free 전환 완료: ${userEmail}`
      phaseLabel = 'Phase 3: Hard Free 전환 완료 (데이터 정리됨)'
      statusColor = '#6b7280'
      actionMessage = `<li>데이터 정리가 완료되었습니다. 삭제된 데이터는 복구 불가합니다.</li>`
    }

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: ${statusColor}; color: white; padding: 12px 20px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0; font-size: 16px;">${phaseLabel}</h2>
  </div>
  <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 20px;">
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="padding: 6px 0; color: #6b7280;">User</td><td style="padding: 6px 0;"><strong>${userEmail}</strong> ${userName ? `(${userName})` : ''}</td></tr>
      <tr><td style="padding: 6px 0; color: #6b7280;">Plan</td><td style="padding: 6px 0;">${planType} (${serviceVariant || 'self'})</td></tr>
      <tr><td style="padding: 6px 0; color: #6b7280;">Platform</td><td style="padding: 6px 0;">${platform || 'N/A'}</td></tr>
      <tr><td style="padding: 6px 0; color: #6b7280;">Billing</td><td style="padding: 6px 0;">${billingCycle || 'N/A'}</td></tr>
      <tr><td style="padding: 6px 0; color: #6b7280;">만료일 (end_date)</td><td style="padding: 6px 0; color: #ef4444;"><strong>${formatDate(endDate)}</strong></td></tr>
      <tr><td style="padding: 6px 0; color: #6b7280;">유예 시작일</td><td style="padding: 6px 0;">${formatDate(graceStartedAt)}</td></tr>
      ${softFreeConvertedAt ? `<tr><td style="padding: 6px 0; color: #6b7280;">Soft Free 전환일</td><td style="padding: 6px 0;">${formatDate(softFreeConvertedAt)}</td></tr>` : ''}
    </table>

    <div style="margin-top: 16px; padding: 12px; background: #f9fafb; border-radius: 6px;">
      <strong>조치 필요:</strong>
      <ul style="margin: 8px 0; padding-left: 20px;">${actionMessage}</ul>
    </div>

    <div style="margin-top: 16px; text-align: center;">
      <a href="${consoleLink}" style="display: inline-block; padding: 10px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">Console에서 확인 →</a>
    </div>
  </div>
</body>
</html>
    `.trim()

    return this.sendEmail({
      to: VENDOR_LEAD_INBOX,
      subject,
      html,
      from: 'support@aitalk.ch'
    })
  }

  async sendBoosterPurchasedEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    packName: string
    cpaAmount: number
    expiresAt: Date
  }): Promise<EmailResponse> {
    const { to, name, language, packName, cpaAmount, expiresAt } = params
    const t = appTranslations[language] || appTranslations.en

    const localeMap: Record<EmailLanguage, string> = {
      en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', ko: 'ko-KR'
    }
    const formattedExpires = expiresAt.toLocaleDateString(localeMap[language], {
      year: 'numeric', month: 'long', day: 'numeric'
    })

    const html = this.generateBoosterPurchasedHTML({
      t, name, packName, cpaAmount, expiresAt: formattedExpires, language
    })

    return this.sendEmail({
      to,
      subject: t.email_booster_purchased_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  async sendBoosterExpiringEmail(params: {
    to: string
    name: string
    language: EmailLanguage
    remainingCpa: number
    expiresAt: Date
  }): Promise<EmailResponse> {
    const { to, name, language, remainingCpa, expiresAt } = params
    const t = appTranslations[language] || appTranslations.en

    const localeMap: Record<EmailLanguage, string> = {
      en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', ko: 'ko-KR'
    }
    const formattedExpires = expiresAt.toLocaleDateString(localeMap[language], {
      year: 'numeric', month: 'long', day: 'numeric'
    })

    const html = this.generateBoosterExpiringHTML({
      t, name, remainingCpa, expiresAt: formattedExpires, language
    })

    return this.sendEmail({
      to,
      subject: t.email_booster_expiring_subject,
      html,
      from: 'support@aitalk.ch',
      bcc: VENDOR_OPS_BCC
    })
  }

  private generateBoosterPurchasedHTML(params: {
    t: any
    name: string
    packName: string
    cpaAmount: number
    expiresAt: string
    language: EmailLanguage
  }): string {
    const { t, name, packName, cpaAmount, expiresAt, language } = params
    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_booster_purchased_title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
    .email-container { background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 40px 20px; text-align: center; }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; font-weight: 600; }
    .logo { margin-bottom: 15px; font-size: 48px; }
    .content { padding: 40px 30px; }
    .greeting { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
    .message { font-size: 16px; color: #555; margin-bottom: 30px; line-height: 1.8; }
    .details-box { background: #f9f9f9; border-left: 4px solid #667eea; border-radius: 4px; padding: 20px; margin-bottom: 30px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e0e0e0; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-weight: 600; color: #555; }
    .detail-value { color: #333; text-align: right; }
    .cta-button { display: inline-block; padding: 14px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; }
    .footer { background: #f9f9f9; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0; }
    .footer-brand { font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 10px; }
    .footer-copyright { font-size: 12px; color: #999; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">⚡</div>
      <h1>${t.email_booster_purchased_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_booster_purchased_greeting} ${name},</div>
      <div class="message">${t.email_booster_purchased_message}</div>
      <div class="details-box">
        <div class="detail-row">
          <span class="detail-label">${t.email_booster_pack_label}</span>
          <span class="detail-value">${packName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_booster_cpa_label}</span>
          <span class="detail-value">${cpaAmount.toLocaleString()}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_booster_expires_label}</span>
          <span class="detail-value">${expiresAt}</span>
        </div>
      </div>
      <div style="text-align: center;">
        <a href="https://www.aitalk.ch/app" class="cta-button">${t.email_booster_cta}</a>
      </div>
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">&copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}</div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }

  private generateBoosterExpiringHTML(params: {
    t: any
    name: string
    remainingCpa: number
    expiresAt: string
    language: EmailLanguage
  }): string {
    const { t, name, remainingCpa, expiresAt, language } = params
    return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.email_booster_expiring_title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
    .email-container { background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #f6ad55 0%, #dd6b20 100%); color: #fff; padding: 40px 20px; text-align: center; }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; font-weight: 600; }
    .logo { margin-bottom: 15px; font-size: 48px; }
    .content { padding: 40px 30px; }
    .greeting { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
    .message { font-size: 16px; color: #555; margin-bottom: 30px; line-height: 1.8; }
    .details-box { background: #fffaf0; border-left: 4px solid #dd6b20; border-radius: 4px; padding: 20px; margin-bottom: 30px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0e0d0; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-weight: 600; color: #555; }
    .detail-value { color: #333; text-align: right; }
    .cta-button { display: inline-block; padding: 14px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; }
    .footer { background: #f9f9f9; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0; }
    .footer-brand { font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 10px; }
    .footer-copyright { font-size: 12px; color: #999; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div class="logo">⏳</div>
      <h1>${t.email_booster_expiring_title}</h1>
    </div>
    <div class="content">
      <div class="greeting">${t.email_booster_expiring_greeting} ${name},</div>
      <div class="message">${t.email_booster_expiring_message}</div>
      <div class="details-box">
        <div class="detail-row">
          <span class="detail-label">${t.email_booster_remaining_label}</span>
          <span class="detail-value">${remainingCpa.toLocaleString()}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">${t.email_booster_expires_label}</span>
          <span class="detail-value">${expiresAt}</span>
        </div>
      </div>
      
    </div>
    <div class="footer">
      <div class="footer-brand">AITalk.ch</div>
      <div class="footer-copyright">&copy; ${new Date().getFullYear()} ${t.email_footer_company}. ${t.email_footer_rights}</div>
    </div>
  </div>
</body>
</html>
    `.trim()
  }
}

// Export singleton instance
export const emailServiceV2 = new EmailServiceV2()
