import { emailService } from './email'
import { Language } from './translations'

interface EmailJob {
  type: 'welcome' | 'verification' | 'password-reset' | 'feedback'
  email: string
  name?: string
  language?: Language
  token?: string
  baseUrl?: string
  source?: string
  feedbackContent?: string
}

export function sendEmailInBackground(job: EmailJob) {
  setImmediate(async () => {
    try {
      switch (job.type) {
        case 'welcome':
          if (job.name) {
            await emailService.sendWelcomeEmail(
              job.email,
              job.name,
              job.language || 'en',
              job.source,
              job.baseUrl,
            )
          }
          break
          
        case 'verification':
          if (job.token && job.baseUrl) {
            await emailService.sendVerificationEmail(
              job.email,
              job.token,
              job.baseUrl,
              job.language || 'en',
              job.source,
            )
          }
          break
          
        case 'password-reset':
          if (job.token && job.baseUrl) {
            await emailService.sendPasswordResetEmail(
              job.email,
              job.token,
              job.baseUrl,
              job.language || 'en'
            )
          }
          break

        case 'feedback':
          if (job.feedbackContent) {
            await emailService.sendFeedbackEmail(
              job.email,
              job.feedbackContent
            )
          }
          break
      }
    } catch (error) {
      console.error(`Background email failed (${job.type}):`, {
        email: job.email,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })
}

export function sendWelcomeEmailBackground(email: string, name: string, language: Language = 'en', source?: string, baseUrl?: string) {
  sendEmailInBackground({
    type: 'welcome',
    email,
    name,
    language,
    source,
    baseUrl,
  })
}

export function sendVerificationEmailBackground(
  email: string,
  token: string,
  baseUrl: string,
  language: Language = 'en',
  source?: string,
) {
  sendEmailInBackground({
    type: 'verification',
    email,
    token,
    baseUrl,
    language,
    source,
  })
}

export function sendPasswordResetEmailBackground(
  email: string,
  token: string,
  baseUrl: string,
  language: Language = 'en'
) {
  sendEmailInBackground({
    type: 'password-reset',
    email,
    token,
    baseUrl,
    language
  })
}

export function sendFeedbackEmailBackground(
  email: string,
  feedbackContent: string
) {
  sendEmailInBackground({
    type: 'feedback',
    email,
    feedbackContent
  })
}