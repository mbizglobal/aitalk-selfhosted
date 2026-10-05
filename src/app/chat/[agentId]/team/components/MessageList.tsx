import React, { useRef, useEffect, useState, useMemo } from 'react'
import { MessageContent } from '@/components/chat/MessageContent'
import type { Message } from '../types'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

interface MessageListProps {
  isMobile: boolean
  messages: Message[]
  streamingContent: string
  isLoading: boolean
  lang?: SupportedLang
  memberName?: string
  welcomeMessage?: string
}

const MessageItem: React.FC<{ message: Message }> = ({ message }) => {
  const [hasTable, setHasTable] = useState(false)

  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`${hasTable ? 'w-full' : 'max-w-[85%]'} rounded-lg px-4 py-3 ${
        message.role === 'user'
          ? 'bg-[#2A2A2A] text-white'
          : message.role === 'error'
          ? 'bg-red-900/20 text-red-400'
          : 'bg-transparent text-gray-200'
      }`}>
        <div className="prose prose-invert prose-sm max-w-none">
          <MessageContent
            content={message.content}
            role={message.role}
            theme="dark"
            size="sm"
            onHasTable={setHasTable}
          />
        </div>
      </div>
    </div>
  )
}

export const MessageList: React.FC<MessageListProps> = ({
  isMobile,
  messages,
  streamingContent,
  isLoading,
  lang,
  memberName,
  welcomeMessage
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)

  const getTimeBasedGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) {
      return t('team_greeting_morning')
    } else if (hour < 18) {
      return t('team_greeting_afternoon')
    } else {
      return t('team_greeting_evening')
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  return (
    <div className={`flex-1 overflow-y-auto ${isMobile ? 'px-2' : 'px-4'}`}>
      <div className={`${isMobile ? 'max-w-full' : 'max-w-7xl'} mx-auto ${isMobile ? 'py-4' : 'py-8'} space-y-6`}>
        {messages.length === 1 && (
          <div className={`text-center ${isMobile ? 'py-6' : 'py-12'}`}>
            <h1 className={`${isMobile ? 'text-xl' : 'text-3xl'} font-light ${isMobile ? 'mb-4' : 'mb-8'}`}>
              🌟 {welcomeMessage
                ? (memberName ? `${welcomeMessage.replace(/\?$/, '')}, ${memberName}` : welcomeMessage)
                : (memberName ? `${getTimeBasedGreeting().replace('?', '')}, ${memberName}` : getTimeBasedGreeting())
              }
            </h1>
          </div>
        )}

        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}

        {streamingContent && (
          <div className="flex justify-start">
            <div className="w-full rounded-lg px-4 py-3 bg-transparent text-gray-200">
              <div className="prose prose-invert prose-sm max-w-none">
                <MessageContent content={streamingContent} role="assistant" theme="dark" size="sm" isStreaming={true} />
              </div>
            </div>
          </div>
        )}

        {isLoading && !streamingContent && (
          <div className="flex justify-start">
            <div className="flex gap-1 px-4 py-3">
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '200ms' }}></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '400ms' }}></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
