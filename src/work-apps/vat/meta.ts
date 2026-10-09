
import type { WorkAppMeta } from '@/lib/work/package-api'
import { vatI18nEn } from './i18n/en'
import { vatI18nDe } from './i18n/de'
import { vatI18nFr } from './i18n/fr'
import { vatI18nKo } from './i18n/ko'

export const vatWorkAppMeta: WorkAppMeta = {
  id: 'vat',
  appTemplateKinds: ['vat'],
  i18n: { en: vatI18nEn, de: vatI18nDe, fr: vatI18nFr, ko: vatI18nKo },
  features: {
    vat: {
      available: [
        { id: 'vat.boxes', module: true, label: { en: 'VAT return boxes', de: 'MWST-Abrechnungsziffern', fr: 'Chiffres du décompte TVA', ko: 'VAT 신고 칸 숫자' } },
        { id: 'bank.import', module: true, label: { en: 'Bank statement import', de: 'Kontoauszug einlesen', fr: 'Import de relevé bancaire', ko: '은행 거래 가져오기' } },
        { id: 'bank.balance-check', module: true, label: { en: 'Bank balance check', de: 'Saldoabgleich', fr: 'Contrôle des soldes', ko: '계좌 잔액 대조' } },
        { id: 'bank-readers', partOf: 'bank.import', label: { en: 'UBS directly · any other bank CSV with a reader the AI writes', de: 'UBS direkt · jede andere Bank-CSV mit einer Leseanleitung der KI', fr: 'UBS directement · tout autre CSV bancaire avec une notice de lecture écrite par l’IA', ko: 'UBS 는 바로 · 그 밖의 은행 CSV 는 AI 가 읽는 법을 만든다' } },
        { id: 'classification-rules', partOf: 'bank.import', label: { en: 'Classification rules applied on import', de: 'Klassifizierungsregeln beim Import', fr: 'Règles de classement appliquées à l’import', ko: '가져올 때 분류 규칙 적용' } },
        { id: 'estv-fx', partOf: 'vat.boxes', label: { en: 'ESTV monthly average exchange rates fetched automatically', de: 'ESTV-Monatsmittelkurse automatisch', fr: 'Cours moyens mensuels AFC automatiques', ko: 'ESTV 월평균 환율 자동 수집' } },
        { id: 'receipt-matching', label: { en: 'AI reads receipts and invoices (PDF, scans, photos) and attaches them to transactions', de: 'KI liest Belege und Rechnungen (PDF, Scans, Fotos) und ordnet sie Buchungen zu', fr: 'L’IA lit reçus et factures (PDF, scans, photos) et les rattache aux transactions', ko: 'AI 가 영수증·인보이스(PDF·스캔·사진)를 읽고 거래에 붙인다' } },
      ],
      planned: [],
    },
  },
}
