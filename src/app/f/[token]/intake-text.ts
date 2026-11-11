export type IntakeLang = 'en' | 'de' | 'fr' | 'ko'

export const INTAKE_TEXT: Record<IntakeLang, Record<string, string>> = {
  en: {
    title: 'Send a request', required: 'required', choose: '— choose —', yes: 'Yes', no: 'No', currency: 'Currency', send: 'Send', sending: 'Sending…',
    done: 'Thank you — your request was received. A person on the team will look at it.', again: 'Send another request',
    missing: 'Please fill in: {fields}', invalid: 'Please check your entries ({detail}).', limit: 'Too many requests right now — please try again later.', taken: 'This time cannot be booked. Please choose another time.',
    expired: 'This page was open for a long time — please reload it and send again.', soon: 'Please check your entries and press Send again.',
    gone: 'This form is no longer available.', error: 'Something went wrong — please try again later.', note: 'Do not enter passwords, card numbers or other secrets.',
    notFoundTitle: 'Form not available', notFound: 'This link is not valid or the form was closed.',
  },
  de: {
    title: 'Anfrage senden', required: 'Pflichtfeld', choose: '— auswählen —', yes: 'Ja', no: 'Nein', currency: 'Währung', send: 'Senden', sending: 'Wird gesendet…',
    done: 'Danke — Ihre Anfrage ist eingegangen. Jemand aus dem Team schaut sie sich an.', again: 'Weitere Anfrage senden',
    missing: 'Bitte ausfüllen: {fields}', invalid: 'Bitte Eingaben prüfen ({detail}).', limit: 'Gerade zu viele Anfragen — bitte später nochmals versuchen.', taken: 'Diese Zeit kann nicht gebucht werden. Bitte eine andere Zeit wählen.',
    expired: 'Diese Seite war lange offen — bitte neu laden und nochmals senden.', soon: 'Bitte Eingaben prüfen und nochmals auf Senden drücken.',
    gone: 'Dieses Formular ist nicht mehr verfügbar.', error: 'Etwas ist schiefgelaufen — bitte später nochmals versuchen.', note: 'Bitte keine Passwörter, Kartennummern oder andere Geheimnisse eingeben.',
    notFoundTitle: 'Formular nicht verfügbar', notFound: 'Dieser Link ist ungültig oder das Formular wurde geschlossen.',
  },
  fr: {
    title: 'Envoyer une demande', required: 'obligatoire', choose: '— choisir —', yes: 'Oui', no: 'Non', currency: 'Devise', send: 'Envoyer', sending: 'Envoi…',
    done: 'Merci — votre demande a été reçue. Une personne de l’équipe va l’examiner.', again: 'Envoyer une autre demande',
    missing: 'Veuillez remplir : {fields}', invalid: 'Veuillez vérifier vos saisies ({detail}).', limit: 'Trop de demandes pour le moment — veuillez réessayer plus tard.', taken: 'Cette heure ne peut pas être réservée. Veuillez choisir une autre heure.',
    expired: 'Cette page est restée ouverte longtemps — veuillez la recharger et envoyer à nouveau.', soon: 'Veuillez vérifier vos saisies et appuyer à nouveau sur Envoyer.',
    gone: 'Ce formulaire n’est plus disponible.', error: 'Une erreur s’est produite — veuillez réessayer plus tard.', note: 'N’indiquez pas de mots de passe, numéros de carte ou autres secrets.',
    notFoundTitle: 'Formulaire indisponible', notFound: 'Ce lien n’est pas valide ou le formulaire a été fermé.',
  },
  ko: {
    title: '요청 보내기', required: '필수', choose: '— 고르기 —', yes: '예', no: '아니요', currency: '통화', send: '보내기', sending: '보내는 중…',
    done: '고맙습니다 — 요청을 받았습니다. 팀의 담당자가 확인합니다.', again: '다른 요청 보내기',
    missing: '채워 주세요: {fields}', invalid: '입력을 확인해 주세요({detail}).', limit: '지금은 요청이 너무 많습니다 — 잠시 뒤에 다시 해 주세요.', taken: '이 시간은 예약할 수 없습니다. 다른 시간을 골라 주세요.',
    expired: '이 화면을 오래 열어 두었습니다 — 새로 고친 뒤 다시 보내 주세요.', soon: '입력을 확인하고 보내기를 다시 눌러 주세요.',
    gone: '이 입력 화면은 더 이상 쓸 수 없습니다.', error: '문제가 생겼습니다 — 잠시 뒤에 다시 해 주세요.', note: '비밀번호 · 카드 번호 같은 비밀 정보는 적지 마세요.',
    notFoundTitle: '입력 화면 없음', notFound: '링크가 맞지 않거나 입력 화면이 닫혔습니다.',
  },
}

export function pickIntakeLang(accept: string | null | undefined): IntakeLang {
  for (const part of (accept ?? '').split(',')) {
    const l = part.trim().slice(0, 2).toLowerCase()
    if (l === 'en' || l === 'de' || l === 'fr' || l === 'ko') return l
  }
  return 'en'
}
