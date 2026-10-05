'use client'

import {
  Bot,
  Brain,
  Cat,
  CircleCheckBig,
  CircleHelp,
  CornerDownLeft,
  Hand,
  Laugh,
  MessageCircle,
  MessageCircleMore,
  MessageCircleQuestion,
  MessageSquare,
  MessageSquareMore,
  Send,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WidgetSettings } from '@/lib/widget-settings'
import { safeColorValue } from '../utils'

// Helper function to extract text from multi-language objects for preview
function getPreviewText(
  multiLangObj: Record<string, string> | string | null | undefined,
  fallback: string = ''
): string {
  if (!multiLangObj) return fallback
  if (typeof multiLangObj === 'string') return multiLangObj

  const firstKey = Object.keys(multiLangObj)[0]
  return multiLangObj[firstKey] || fallback
}

interface ChatButtonPreviewProps {
  settings: WidgetSettings
}

export function ChatButtonPreview({ settings }: ChatButtonPreviewProps) {
  const { chatButton } = settings

  const getShadowStyle = () => {
    const intensity = chatButton.shadowIntensity
    const color = safeColorValue(chatButton.shadowColor, '#000000')

    const hexToRgba = (hex: string, alpha: number) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }

    const shadowColor = hexToRgba(color, intensity)

    switch (chatButton.shadowDirection) {
      case 'bottom-right':
        return `4px 4px 12px ${shadowColor}`
      case 'bottom':
        return `0 4px 12px ${shadowColor}`
      case 'right':
        return `4px 0 12px ${shadowColor}`
      case 'all':
        return `0 0 12px ${shadowColor}`
      default:
        return `4px 4px 12px ${shadowColor}`
    }
  }

  const getIconComponent = () => {
    const iconProps = {
      className: 'w-full h-full',
      style: { color: chatButton.iconColor },
    }

    switch (chatButton.iconType) {
      case 'message-square':
        return <MessageSquare {...iconProps} />
      case 'bot':
        return <Bot {...iconProps} />
      case 'send':
        return <Send {...iconProps} />
      case 'corner-down-left':
        return <CornerDownLeft {...iconProps} />
      case 'user':
        return <User {...iconProps} />
      case 'brain':
        return <Brain {...iconProps} />
      case 'cat':
        return <Cat {...iconProps} />
      case 'hand':
        return <Hand {...iconProps} />
      case 'laugh':
        return <Laugh {...iconProps} />
      case 'circle-check-big':
        return <CircleCheckBig {...iconProps} />
      case 'circle-help':
        return <CircleHelp {...iconProps} />
      case 'message-circle-more':
        return <MessageCircleMore {...iconProps} />
      case 'message-circle-question':
        return <MessageCircleQuestion {...iconProps} />
      case 'message-square-more':
        return <MessageSquareMore {...iconProps} />
      case 'message-circle':
      default:
        return <MessageCircle {...iconProps} />
    }
  }

  const getBackgroundClass = () => {
    if (chatButton.previewTheme === 'dark') {
      return 'bg-gradient-to-br from-gray-800 to-gray-900'
    }
    return 'bg-gradient-to-br from-gray-50 to-gray-100'
  }

  const getPositionStyles = () => {
    const styles: React.CSSProperties = {
      position: 'absolute',
      bottom: `${chatButton.verticalGap}px`,
    }

    if (chatButton.position === 'left') {
      styles.left = `${chatButton.horizontalGap}px`
    } else {
      styles.right = `${chatButton.horizontalGap}px`
    }

    return styles
  }

  const getWelcomeMessagePositionStyles = () => {
    const buttonSizeMultiplier = (chatButton.buttonSize || 100) / 100
    const buttonWidth = 64 * buttonSizeMultiplier
    const styles: React.CSSProperties = {
      position: 'absolute',
      bottom: `${chatButton.verticalGap + buttonWidth + 10}px`,
    }

    if (chatButton.position === 'left') {
      styles.left = `${chatButton.horizontalGap}px`
    } else {
      styles.right = `${chatButton.horizontalGap}px`
    }

    return styles
  }

  const buttonSizeMultiplier = (chatButton.buttonSize || 100) / 100

  const welcomeMessageText = getPreviewText(settings.welcomeMessage, '')
  const welcomeBgColor = settings.welcomeMessageBackgroundColor || '#ffffff'
  const welcomeTextColor = settings.welcomeMessageTextColor || '#1f2937'

  return (
    <div
      className={cn(
        'relative min-h-[500px] rounded-lg overflow-hidden',
        getBackgroundClass()
      )}
    >
      {/* Welcome Message Bubble */}
      {welcomeMessageText && (
        <div
          style={{
            ...getWelcomeMessagePositionStyles(),
            backgroundColor: safeColorValue(welcomeBgColor, '#ffffff'),
            color: safeColorValue(welcomeTextColor, '#1f2937'),
            maxWidth: '280px',
            padding: '12px 16px',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            fontSize: '14px',
            lineHeight: '1.4',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
          }}
        >
          {welcomeMessageText}
        </div>
      )}

      {/* Chat Button */}
      <button
        className="rounded-full transition-transform hover:scale-110 cursor-pointer"
        style={{
          ...getPositionStyles(),
          backgroundColor: safeColorValue(
            chatButton.backgroundColor,
            '#000000'
          ),
          boxShadow: getShadowStyle(),
          width: `${64 * buttonSizeMultiplier}px`,
          height: `${64 * buttonSizeMultiplier}px`,
          padding: `${16 * buttonSizeMultiplier}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: `${32 * buttonSizeMultiplier}px`,
            height: `${32 * buttonSizeMultiplier}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {getIconComponent()}
        </div>
      </button>
    </div>
  )
}
