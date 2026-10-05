import { isSelfHosted } from '@/lib/edition'
import { VENDOR_FEEDBACK_TO } from '@/lib/vendor-contacts'

export interface InstallationBrand {
  productName: string
  footer: string
}

export function getInstallationBrand(env: Record<string, string | undefined> = process.env): InstallationBrand {
  return {
    productName: env.BRAND_NAME?.trim() || 'AI Talk',
    footer: env.BRAND_FOOTER?.trim() || '',
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function brandEmail(mail: { subject: string; html: string }, brand: InstallationBrand): { subject: string; html: string } {
  const name = escapeHtml(brand.productName)
  const footer = escapeHtml(brand.footer)
  const swapName = (s: string, value: string) => s.replace(/A[Ii][Tt]alk\.ch/g, () => value)
  const copyright = footer ? `&copy; ${new Date().getFullYear()} ${footer}` : ''
  const html = swapName(mail.html, name)
    .replace(/&copy;\s*\d{4}\s*M-BIZ Global AG\.?(\s*All rights reserved\.)?/g, () => copyright)
    .replace(/M-BIZ Global AG/g, () => footer)
  return { subject: swapName(mail.subject, brand.productName), html }
}

export function getFeedbackRecipient(env: Record<string, string | undefined> = process.env): string | null {
  if (!isSelfHosted(env)) return VENDOR_FEEDBACK_TO
  return env.FEEDBACK_EMAIL?.trim() || null
}
