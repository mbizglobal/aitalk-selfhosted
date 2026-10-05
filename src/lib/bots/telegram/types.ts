
export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from: {
      id: number
      first_name?: string
      last_name?: string
      username?: string
    }
    chat: {
      id: number
      type: 'private' | 'group' | 'supergroup' | 'channel'
    }
    date: number
    text?: string
  }
  callback_query?: {
    id: string
    from: {
      id: number
      first_name?: string
      username?: string
    }
    message?: {
      chat: {
        id: number
      }
    }
    data?: string
  }
}

export interface TelegramBotInfo {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
}

export interface ExtractedMessage {
  chatId: number
  text: string
  userId: number
  username: string
}
