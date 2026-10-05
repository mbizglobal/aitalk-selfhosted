
import { describeCaughtError, describeUpstreamError } from '@/lib/log-mask'
import type { TelegramUpdate, TelegramBotInfo, ExtractedMessage } from './types'

const TELEGRAM_API = 'https://api.telegram.org/bot'
const TELEGRAM_MAX_LENGTH = 4096

function splitMessage(text: string, maxLength: number = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text]

  const parts: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining)
      break
    }

    let splitIndex = remaining.lastIndexOf('\n\n', maxLength)
    if (splitIndex > 0) {
      parts.push(remaining.substring(0, splitIndex))
      remaining = remaining.substring(splitIndex + 2)
      continue
    }

    splitIndex = remaining.lastIndexOf('\n', maxLength)
    if (splitIndex > 0) {
      parts.push(remaining.substring(0, splitIndex))
      remaining = remaining.substring(splitIndex + 1)
      continue
    }

    parts.push(remaining.substring(0, maxLength))
    remaining = remaining.substring(maxLength)
  }

  return parts
}

export function convertToTelegramHTML(text: string): string {
  let result = text

  const codeBlocks: string[] = []
  result = result.replace(/```(?:\w*\n)?([\s\S]*?)```/g, (_, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    codeBlocks.push(`<pre>${escaped.trim()}</pre>`)
    return `\x00CB${codeBlocks.length - 1}\x00`
  })

  const inlineCodes: string[] = []
  result = result.replace(/`([^`]+)`/g, (_, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    inlineCodes.push(`<code>${escaped}</code>`)
    return `\x00IC${inlineCodes.length - 1}\x00`
  })

  result = result.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // 4. Bold: **text** → <b>text</b>
  result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')

  // 5. Italic: *text* → <i>text</i>
  result = result.replace(/\*([^*]+)\*/g, '<i>$1</i>')

  // 6. Strikethrough: ~~text~~ → <s>text</s>
  result = result.replace(/~~([^~]+)~~/g, '<s>$1</s>')

  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  inlineCodes.forEach((code, i) => {
    result = result.replace(`\x00IC${i}\x00`, code)
  })
  codeBlocks.forEach((block, i) => {
    result = result.replace(`\x00CB${i}\x00`, block)
  })

  return result
}

export function escapeMarkdownV2Chars(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

export function convertToTelegramMarkdownV2(text: string): string {
  let result = text

  const PH = 'TGMDPH'

  const codeBlocks: string[] = []
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `${PH}CODEBLOCK${codeBlocks.length - 1}${PH}`
  })

  const inlineCodes: string[] = []
  result = result.replace(/`[^`]+`/g, (match) => {
    inlineCodes.push(match)
    return `${PH}INLINECODE${inlineCodes.length - 1}${PH}`
  })

  const links: string[] = []
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match) => {
    links.push(match)
    return `${PH}LINK${links.length - 1}${PH}`
  })

  const bolds: string[] = []
  result = result.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
    const escaped = escapeMarkdownV2Chars(content)
    bolds.push(`*${escaped}*`)
    return `${PH}BOLD${bolds.length - 1}${PH}`
  })

  const italics: string[] = []
  result = result.replace(/\*([^*]+)\*/g, (_, content) => {
    const escaped = escapeMarkdownV2Chars(content)
    italics.push(`_${escaped}_`)
    return `${PH}ITALIC${italics.length - 1}${PH}`
  })

  result = escapeMarkdownV2Chars(result)

  italics.forEach((italic, i) => {
    result = result.replace(`${PH}ITALIC${i}${PH}`, italic)
  })
  bolds.forEach((bold, i) => {
    result = result.replace(`${PH}BOLD${i}${PH}`, bold)
  })
  links.forEach((link, i) => {
    const linkMatch = link.match(/\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      const escapedText = escapeMarkdownV2Chars(linkMatch[1])
      result = result.replace(`${PH}LINK${i}${PH}`, `[${escapedText}](${linkMatch[2]})`)
    }
  })
  inlineCodes.forEach((code, i) => {
    result = result.replace(`${PH}INLINECODE${i}${PH}`, code)
  })
  codeBlocks.forEach((block, i) => {
    result = result.replace(`${PH}CODEBLOCK${i}${PH}`, block)
  })

  return result
}

export async function sendTypingIndicator(
  botToken: string,
  chatId: number
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${botToken}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action: 'typing'
      })
    })
  } catch (error) {
    console.warn('[Telegram] Failed to send typing indicator:', describeCaughtError(error))
  }
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
  parseMode: string = 'HTML'
): Promise<boolean> {
  try {
    if (!text || text.trim().length === 0) {
      console.warn('[Telegram] Skipping empty message')
      return true
    }
    let processedText = text
    if (parseMode === 'MarkdownV2') {
      processedText = convertToTelegramMarkdownV2(text)
    } else if (parseMode === 'HTML') {
      processedText = convertToTelegramHTML(text)
    }

    const parts = splitMessage(processedText)

    for (const part of parts) {
      const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: part,
          parse_mode: parseMode
        })
      })

      const result = await response.json()
      if (!result.ok) {
        console.error('[Telegram] Failed to send message:', describeUpstreamError(response.status, JSON.stringify(result)))
        return false
      }
    }
    return true
  } catch (error) {
    console.error('[Telegram] Error sending message:', describeCaughtError(error))
    return false
  }
}

export function extractTelegramMessage(update: TelegramUpdate): ExtractedMessage | null {
  const message = update.message
  if (!message?.text) return null

  return {
    chatId: message.chat.id,
    text: message.text,
    userId: message.from.id,
    username: message.from.username || message.from.first_name || 'User'
  }
}

export async function validateBotToken(token: string): Promise<TelegramBotInfo | null> {
  try {
    const response = await fetch(`${TELEGRAM_API}${token}/getMe`)
    const result = await response.json()
    if (!result.ok) return null
    return result.result as TelegramBotInfo
  } catch {
    return null
  }
}

export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken?: string
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query']
    }
    if (secretToken) {
      body.secret_token = secretToken
    }

    const response = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    const result = await response.json()
    if (!result.ok) {
      console.error('[Telegram] Failed to set webhook:', describeUpstreamError(response.status, JSON.stringify(result)))
      return false
    }
    return true
  } catch (error) {
    console.error('[Telegram] Error setting webhook:', describeCaughtError(error))
    return false
  }
}

export async function sendTelegramMessageWithKeyboard(
  botToken: string,
  chatId: number,
  text: string,
  inlineKeyboard: { text: string; callback_data: string }[][],
): Promise<boolean> {
  try {
    const processedText = convertToTelegramMarkdownV2(text)

    const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: processedText,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      }),
    })

    const result = await response.json()
    if (!result.ok) {
      console.error('[Telegram] Failed to send message with keyboard:', describeUpstreamError(response.status, JSON.stringify(result)))
      return false
    }
    return true
  } catch (error) {
    console.error('[Telegram] Error sending message with keyboard:', describeCaughtError(error))
    return false
  }
}

export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
      }),
    })
  } catch (error) {
    console.warn('[Telegram] Failed to answer callback query:', describeCaughtError(error))
  }
}

export async function deleteTelegramMessage(
  botToken: string,
  chatId: number,
  messageId: number
): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId
      })
    })
    const result = await response.json()
    if (!result.ok) {
      console.warn('[Telegram] Failed to delete message:', describeUpstreamError(response.status, JSON.stringify(result)))
      return false
    }
    return true
  } catch (error) {
    console.warn('[Telegram] Error deleting message:', describeCaughtError(error))
    return false
  }
}

export async function deleteTelegramWebhook(botToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    const result = await response.json()
    return result.ok === true
  } catch (error) {
    console.error('[Telegram] Error deleting webhook:', describeCaughtError(error))
    return false
  }
}
