
export type WidgetLang = 'en' | 'de' | 'fr' | 'ko'
export const WIDGET_LANGS: WidgetLang[] = ['en', 'de', 'fr', 'ko']

export function normalizeWidgetLang(raw: unknown): WidgetLang | null {
  if (typeof raw !== 'string') return null
  const base = raw.trim().toLowerCase().split(/[-_]/)[0]
  return (WIDGET_LANGS as string[]).includes(base) ? (base as WidgetLang) : null
}

export const BCP47: Record<WidgetLang, string> = { en: 'en-GB', de: 'de-CH', fr: 'fr-CH', ko: 'ko-KR' }

export interface WidgetText {
  onlineBooking: string
  openingTimes: string
  guests: (n: number) => string
  date: string
  time: string
  guestsLabel: string
  today: string
  tomorrow: string
  chooseTime: string
  noTimes: string
  loading: string
  next: string
  back: string
  confirm: string
  reservationDetails: string
  checkout: string
  firstName: string
  lastName: string
  email: string
  phone: string
  messageLabel: string
  messagePlaceholder: string
  honeypotLabel: string
  consent: string
  required: string
  invalidEmail: string
  invalidPhone: string
  checkEmailTitle: string
  checkEmailBody: (email: string, minutes: number) => string
  confirming: string
  bookAgain: string
  doneTitle: string
  doneBody: (when: string, party: number | null) => string
  doneEmail: (email: string) => string
  contactToChange: string
  contactToChangePhone: (phone: string) => string
  largeGroup: (max: number, phone: string | null) => string
  unavailableTitle: string
  unavailableBody: string
  errors: Record<string, string>
  poweredBy: string
  emailSubject: (title: string) => string
  emailHello: (name: string) => string
  emailIntro: (title: string) => string
  emailTable: string
  emailMessage: string
  confirmEmailSubject: (title: string) => string
  confirmEmailHeading: string
  confirmEmailIntro: (title: string, minutes: number) => string
  confirmEmailButton: string
  confirmEmailIgnore: string
}

const en: WidgetText = {
  onlineBooking: 'Online booking',
  openingTimes: 'Opening times',
  guests: (n) => (n === 1 ? '1 guest' : `${n} guests`),
  date: 'Date',
  time: 'Time',
  guestsLabel: 'Guests',
  today: 'Today',
  tomorrow: 'Tomorrow',
  chooseTime: 'Choose a time',
  noTimes: 'No free times on this day. Please pick another date.',
  loading: 'Loading…',
  next: 'Next',
  back: 'Back',
  confirm: 'Confirm booking',
  reservationDetails: 'Reservation details',
  checkout: 'Your details',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  messageLabel: 'Message (optional)',
  messagePlaceholder: 'Special requests or notes',
  honeypotLabel: 'Do not fill out this field',
  consent: 'By confirming, you agree that your details are passed to the business to handle this booking.',
  required: 'Required',
  invalidEmail: 'Please enter a valid email address.',
  invalidPhone: 'Please enter a valid phone number.',
  checkEmailTitle: 'Check your email',
  checkEmailBody: (email, minutes) => `We sent a link to ${email}. Click it within ${minutes} minutes to confirm your booking.`,
  confirming: 'Confirming your booking…',
  bookAgain: 'Book again',
  doneTitle: 'Your booking is confirmed',
  doneBody: (when, party) => (party ? `${when} · ${party === 1 ? '1 guest' : `${party} guests`}` : when),
  doneEmail: (email) => `A confirmation has been sent to ${email}.`,
  contactToChange: 'To change or cancel, please contact the business directly.',
  contactToChangePhone: (phone) => `To change or cancel, please call ${phone}.`,
  largeGroup: (max, phone) => `For more than ${max} guests, please ${phone ? `call ${phone}` : 'contact the business directly'}.`,
  unavailableTitle: 'Online booking is not available right now',
  unavailableBody: 'Please contact the business directly.',
  errors: {
    slot_taken: 'Sorry, this time was just taken. Please choose another time.',
    party_too_large: 'This group size cannot be booked online. Please contact the business.',
    closed: 'The business is closed at this time. Please choose another time.',
    outside_window: 'This date is too far ahead for online booking.',
    already_booked: 'There is already an upcoming booking for these contact details. Please contact the business to change it.',
    unavailable: 'Online booking is not available right now. Please try again later or contact the business.',
    invalid: 'Please check your details and try again.',
    rate_limited: 'Too many attempts. Please wait a while and try again.',
    link_expired: 'This link has expired or was already used. Please book again.',
    network: 'Connection problem. Please try again.',
  },
  poweredBy: 'Powered by AI Talk',
  emailSubject: (title) => `Your booking at ${title}`,
  emailHello: (name) => `Hello ${name},`,
  emailIntro: (title) => `Your booking at ${title} is confirmed.`,
  emailTable: 'Table',
  emailMessage: 'Your message',
  confirmEmailSubject: (title) => `Please confirm your booking at ${title}`,
  confirmEmailHeading: 'One click to confirm',
  confirmEmailIntro: (title, minutes) => `Click the button below within ${minutes} minutes to confirm your booking at ${title}.`,
  confirmEmailButton: 'Confirm booking',
  confirmEmailIgnore: "If you didn't make this request, just ignore this email — nothing will be booked.",
}

const de: WidgetText = {
  onlineBooking: 'Online-Reservierung',
  openingTimes: 'Öffnungszeiten',
  guests: (n) => (n === 1 ? '1 Person' : `${n} Personen`),
  date: 'Datum',
  time: 'Uhrzeit',
  guestsLabel: 'Personen',
  today: 'Heute',
  tomorrow: 'Morgen',
  chooseTime: 'Uhrzeit wählen',
  noTimes: 'An diesem Tag sind keine Zeiten frei. Bitte wählen Sie ein anderes Datum.',
  loading: 'Wird geladen…',
  next: 'Weiter',
  back: 'Zurück',
  confirm: 'Reservierung bestätigen',
  reservationDetails: 'Reservierungsdetails',
  checkout: 'Ihre Angaben',
  firstName: 'Vorname',
  lastName: 'Nachname',
  email: 'E-Mail',
  phone: 'Telefon',
  messageLabel: 'Nachricht (optional)',
  messagePlaceholder: 'Besondere Wünsche oder Hinweise',
  honeypotLabel: 'Dieses Feld bitte nicht ausfüllen',
  consent: 'Mit der Bestätigung stimmen Sie zu, dass Ihre Angaben zur Bearbeitung dieser Reservierung an den Betrieb weitergegeben werden.',
  required: 'Pflichtfeld',
  invalidEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
  invalidPhone: 'Bitte geben Sie eine gültige Telefonnummer ein.',
  checkEmailTitle: 'Bitte prüfen Sie Ihre E-Mails',
  checkEmailBody: (email, minutes) => `Wir haben einen Link an ${email} gesendet. Klicken Sie innerhalb von ${minutes} Minuten darauf, um die Reservierung zu bestätigen.`,
  confirming: 'Reservierung wird bestätigt…',
  bookAgain: 'Erneut reservieren',
  doneTitle: 'Ihre Reservierung ist bestätigt',
  doneBody: (when, party) => (party ? `${when} · ${party === 1 ? '1 Person' : `${party} Personen`}` : when),
  doneEmail: (email) => `Eine Bestätigung wurde an ${email} gesendet.`,
  contactToChange: 'Für Änderungen oder Stornierungen wenden Sie sich bitte direkt an den Betrieb.',
  contactToChangePhone: (phone) => `Für Änderungen oder Stornierungen rufen Sie bitte ${phone} an.`,
  largeGroup: (max, phone) => (phone ? `Für mehr als ${max} Personen rufen Sie bitte ${phone} an.` : `Für mehr als ${max} Personen wenden Sie sich bitte direkt an den Betrieb.`),
  unavailableTitle: 'Online-Reservierung ist derzeit nicht möglich',
  unavailableBody: 'Bitte wenden Sie sich direkt an den Betrieb.',
  errors: {
    slot_taken: 'Diese Zeit wurde gerade vergeben. Bitte wählen Sie eine andere Zeit.',
    party_too_large: 'Diese Gruppengrösse kann nicht online reserviert werden. Bitte kontaktieren Sie den Betrieb.',
    closed: 'Zu dieser Zeit ist geschlossen. Bitte wählen Sie eine andere Zeit.',
    outside_window: 'Dieses Datum liegt zu weit in der Zukunft für eine Online-Reservierung.',
    already_booked: 'Für diese Kontaktdaten besteht bereits eine Reservierung. Bitte wenden Sie sich für Änderungen an den Betrieb.',
    unavailable: 'Online-Reservierung ist derzeit nicht möglich. Bitte später erneut versuchen oder den Betrieb kontaktieren.',
    invalid: 'Bitte prüfen Sie Ihre Angaben und versuchen Sie es erneut.',
    rate_limited: 'Zu viele Versuche. Bitte warten Sie einen Moment.',
    link_expired: 'Dieser Link ist abgelaufen oder wurde bereits verwendet. Bitte reservieren Sie erneut.',
    network: 'Verbindungsproblem. Bitte erneut versuchen.',
  },
  poweredBy: 'Powered by AI Talk',
  emailSubject: (title) => `Ihre Reservierung bei ${title}`,
  emailHello: (name) => `Guten Tag ${name}`,
  emailIntro: (title) => `Ihre Reservierung bei ${title} ist bestätigt.`,
  emailTable: 'Tisch',
  emailMessage: 'Ihre Nachricht',
  confirmEmailSubject: (title) => `Bitte bestätigen Sie Ihre Reservierung bei ${title}`,
  confirmEmailHeading: 'Mit einem Klick bestätigen',
  confirmEmailIntro: (title, minutes) => `Klicken Sie innerhalb von ${minutes} Minuten auf den Button, um Ihre Reservierung bei ${title} zu bestätigen.`,
  confirmEmailButton: 'Reservierung bestätigen',
  confirmEmailIgnore: 'Wenn Sie das nicht angefragt haben, ignorieren Sie diese E-Mail einfach — es wird nichts reserviert.',
}

const fr: WidgetText = {
  onlineBooking: 'Réservation en ligne',
  openingTimes: "Heures d'ouverture",
  guests: (n) => (n === 1 ? '1 personne' : `${n} personnes`),
  date: 'Date',
  time: 'Heure',
  guestsLabel: 'Personnes',
  today: "Aujourd'hui",
  tomorrow: 'Demain',
  chooseTime: 'Choisissez une heure',
  noTimes: 'Aucun créneau libre ce jour-là. Veuillez choisir une autre date.',
  loading: 'Chargement…',
  next: 'Suivant',
  back: 'Retour',
  confirm: 'Confirmer la réservation',
  reservationDetails: 'Détails de la réservation',
  checkout: 'Vos coordonnées',
  firstName: 'Prénom',
  lastName: 'Nom',
  email: 'E-mail',
  phone: 'Téléphone',
  messageLabel: 'Message (facultatif)',
  messagePlaceholder: 'Demandes particulières ou remarques',
  honeypotLabel: 'Ne remplissez pas ce champ',
  consent: "En confirmant, vous acceptez que vos coordonnées soient transmises à l'établissement pour traiter cette réservation.",
  required: 'Obligatoire',
  invalidEmail: 'Veuillez saisir une adresse e-mail valide.',
  invalidPhone: 'Veuillez saisir un numéro de téléphone valide.',
  checkEmailTitle: 'Vérifiez vos e-mails',
  checkEmailBody: (email, minutes) => `Nous avons envoyé un lien à ${email}. Cliquez dessus dans les ${minutes} minutes pour confirmer votre réservation.`,
  confirming: 'Confirmation de votre réservation…',
  bookAgain: 'Réserver à nouveau',
  doneTitle: 'Votre réservation est confirmée',
  doneBody: (when, party) => (party ? `${when} · ${party === 1 ? '1 personne' : `${party} personnes`}` : when),
  doneEmail: (email) => `Une confirmation a été envoyée à ${email}.`,
  contactToChange: "Pour modifier ou annuler, veuillez contacter directement l'établissement.",
  contactToChangePhone: (phone) => `Pour modifier ou annuler, veuillez appeler le ${phone}.`,
  largeGroup: (max, phone) => (phone ? `Pour plus de ${max} personnes, veuillez appeler le ${phone}.` : `Pour plus de ${max} personnes, veuillez contacter directement l'établissement.`),
  unavailableTitle: "La réservation en ligne n'est pas disponible pour le moment",
  unavailableBody: "Veuillez contacter directement l'établissement.",
  errors: {
    slot_taken: 'Ce créneau vient d’être pris. Veuillez choisir une autre heure.',
    party_too_large: "Cette taille de groupe ne peut pas être réservée en ligne. Veuillez contacter l'établissement.",
    closed: "L'établissement est fermé à cette heure. Veuillez choisir une autre heure.",
    outside_window: 'Cette date est trop éloignée pour une réservation en ligne.',
    already_booked: "Une réservation à venir existe déjà pour ces coordonnées. Veuillez contacter l'établissement pour la modifier.",
    unavailable: "La réservation en ligne n'est pas disponible. Réessayez plus tard ou contactez l'établissement.",
    invalid: 'Veuillez vérifier vos informations et réessayer.',
    rate_limited: 'Trop de tentatives. Veuillez patienter un moment.',
    link_expired: 'Ce lien a expiré ou a déjà été utilisé. Veuillez réserver à nouveau.',
    network: 'Problème de connexion. Veuillez réessayer.',
  },
  poweredBy: 'Powered by AI Talk',
  emailSubject: (title) => `Votre réservation chez ${title}`,
  emailHello: (name) => `Bonjour ${name},`,
  emailIntro: (title) => `Votre réservation chez ${title} est confirmée.`,
  emailTable: 'Table',
  emailMessage: 'Votre message',
  confirmEmailSubject: (title) => `Veuillez confirmer votre réservation chez ${title}`,
  confirmEmailHeading: 'Confirmez en un clic',
  confirmEmailIntro: (title, minutes) => `Cliquez sur le bouton ci-dessous dans les ${minutes} minutes pour confirmer votre réservation chez ${title}.`,
  confirmEmailButton: 'Confirmer la réservation',
  confirmEmailIgnore: "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail — rien ne sera réservé.",
}

const ko: WidgetText = {
  onlineBooking: '온라인 예약',
  openingTimes: '영업시간',
  guests: (n) => `${n}명`,
  date: '날짜',
  time: '시간',
  guestsLabel: '인원',
  today: '오늘',
  tomorrow: '내일',
  chooseTime: '시간 선택',
  noTimes: '이날은 예약 가능한 시간이 없습니다. 다른 날짜를 골라 주세요.',
  loading: '불러오는 중…',
  next: '다음',
  back: '이전',
  confirm: '예약 확정',
  reservationDetails: '예약 내용',
  checkout: '예약자 정보',
  firstName: '이름',
  lastName: '성',
  email: '이메일',
  phone: '전화번호',
  messageLabel: '메시지 (선택)',
  messagePlaceholder: '요청 사항이나 메모',
  honeypotLabel: '이 칸은 비워 두세요',
  consent: '확정하면 이 예약을 처리하기 위해 입력한 정보가 가게에 전달되는 것에 동의하게 됩니다.',
  required: '필수',
  invalidEmail: '올바른 이메일 주소를 입력해 주세요.',
  invalidPhone: '올바른 전화번호를 입력해 주세요.',
  checkEmailTitle: '메일을 확인해 주세요',
  checkEmailBody: (email, minutes) => `${email} 로 링크를 보냈습니다. ${minutes}분 안에 링크를 누르면 예약이 확정됩니다.`,
  confirming: '예약을 확정하는 중…',
  bookAgain: '다시 예약하기',
  doneTitle: '예약이 확정되었습니다',
  doneBody: (when, party) => (party ? `${when} · ${party}명` : when),
  doneEmail: (email) => `${email} 로 확인 메일을 보냈습니다.`,
  contactToChange: '변경이나 취소는 가게로 직접 연락해 주세요.',
  contactToChangePhone: (phone) => `변경이나 취소는 ${phone} 로 전화해 주세요.`,
  largeGroup: (max, phone) => (phone ? `${max}명보다 많으면 ${phone} 로 전화해 주세요.` : `${max}명보다 많으면 가게로 직접 연락해 주세요.`),
  unavailableTitle: '지금은 온라인 예약을 받을 수 없습니다',
  unavailableBody: '가게로 직접 연락해 주세요.',
  errors: {
    slot_taken: '방금 이 시간이 마감되었습니다. 다른 시간을 골라 주세요.',
    party_too_large: '이 인원은 온라인으로 예약할 수 없습니다. 가게로 연락해 주세요.',
    closed: '이 시간에는 영업하지 않습니다. 다른 시간을 골라 주세요.',
    outside_window: '이 날짜는 온라인 예약을 받기에 너무 먼 날입니다.',
    already_booked: '이 연락처로 이미 예정된 예약이 있습니다. 변경은 가게로 연락해 주세요.',
    unavailable: '지금은 온라인 예약을 받을 수 없습니다. 잠시 뒤 다시 시도하거나 가게로 연락해 주세요.',
    invalid: '입력한 내용을 확인하고 다시 시도해 주세요.',
    rate_limited: '시도가 너무 많습니다. 잠시 뒤 다시 시도해 주세요.',
    link_expired: '링크가 만료되었거나 이미 사용되었습니다. 다시 예약해 주세요.',
    network: '연결에 문제가 있습니다. 다시 시도해 주세요.',
  },
  poweredBy: 'Powered by AI Talk',
  emailSubject: (title) => `${title} 예약 확인`,
  emailHello: (name) => `${name} 님, 안녕하세요.`,
  emailIntro: (title) => `${title} 예약이 확정되었습니다.`,
  emailTable: '테이블',
  emailMessage: '남기신 메시지',
  confirmEmailSubject: (title) => `${title} 예약을 확정해 주세요`,
  confirmEmailHeading: '버튼 한 번으로 확정',
  confirmEmailIntro: (title, minutes) => `${minutes}분 안에 아래 버튼을 누르면 ${title} 예약이 확정됩니다.`,
  confirmEmailButton: '예약 확정하기',
  confirmEmailIgnore: '직접 요청하지 않으셨다면 이 메일은 무시하세요 — 아무것도 예약되지 않습니다.',
}

export const WIDGET_TEXT: Record<WidgetLang, WidgetText> = { en, de, fr, ko }
