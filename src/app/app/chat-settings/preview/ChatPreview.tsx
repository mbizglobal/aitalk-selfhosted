'use client'

import { useEdition } from '@/components/EditionProvider'
import { brandAssets } from '@/lib/brand-assets'
import {
  ArrowDownRight,
  ArrowUpLeft,
  ChevronDown,
  ChevronsLeftRight,
  ChevronsRightLeft,
  CircleX,
  CornerDownLeft,
  Expand,
  LogOut,
  MessageCirclePlus,
  Navigation,
  RefreshCw,
  RotateCcw,
  Send,
  SendHorizontal,
  Shrink,
} from 'lucide-react'
import type { WidgetSettings } from '@/lib/widget-settings'
import { normalizeRecommendedQuestions } from '@/lib/widget-settings'
import { HEADER_KEYS } from '../constants'
import { safeColorValue, sendIconThemeFromFilename } from '../utils'
import type { TranslationFn } from '../types'

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

interface ChatPreviewProps {
  settings: WidgetSettings
  t: TranslationFn
}

export function ChatPreview({ settings, t }: ChatPreviewProps) {
  const recommendedQuestions = normalizeRecommendedQuestions(
    settings.recommendedQuestions
  )
  const sendTheme = sendIconThemeFromFilename(settings.sendIcon)
  const borderColor = safeColorValue(settings.borderColor, '#ccc')
  const headerBackgroundColor = safeColorValue(
    settings.headerBackgroundColor,
    '#1c1c1c'
  )
  const headerTextColor = safeColorValue(settings.headerTextColor, '#ffffff')
  const assistantBackgroundColor = safeColorValue(
    settings.initialMessageBackgroundColor,
    '#f1f3f5'
  )
  const assistantTextColor = safeColorValue(
    settings.initialMessageTextColor,
    '#000000'
  )
  const userBackgroundColor = safeColorValue(
    settings.userMessageBackgroundColor,
    '#000000'
  )
  const userTextColor = safeColorValue(settings.userMessageTextColor, '#ffffff')
  const loadingDotColor = safeColorValue(settings.loadingIconColor, '#999999')
  const loadingTextColor = safeColorValue(settings.loadingTextColor, '#666666')
  const scrollbarThumbColor = safeColorValue(
    settings.scrollbarThumbColor,
    '#C7C7C7'
  )
  const scrollbarTrackColor = safeColorValue(
    settings.scrollbarTrackColor,
    '#dbdbdb'
  )
  const inputBackgroundColor = safeColorValue(
    settings.inputBackgroundColor,
    '#ffffff'
  )
  const inputBorderColor = safeColorValue(settings.inputBorderColor, '#ccc')
  const inputFocusBorderColor = safeColorValue(
    settings.inputFocusBorderColor,
    '#000000'
  )
  const inputTextColor = safeColorValue(settings.inputTextColor, '#000000')
  const chatWindowBackgroundColor = safeColorValue(
    settings.chatWindowBackgroundColor,
    '#DBDBDB'
  )
  const assets = brandAssets(useEdition())
  const logoSrc =
    settings.customIconData ||
    assets.widgetIcon

  const initialMessageText = getPreviewText(settings.initialMessage)
  const inputPlaceholderText = getPreviewText(
    settings.inputPlaceholder,
    t('default_input_placeholder')
  )
  const privacyNoticeText = getPreviewText(
    settings.privacyPolicy?.text,
    t('privacy_policy_notice')
  )
  const privacyLinkText = getPreviewText(
    settings.privacyPolicy?.linkText,
    t('privacy_policy_link_text')
  )
  const recommendedQuestionsText = recommendedQuestions.map((q) =>
    getPreviewText(q)
  )

  const headerIconElements = HEADER_KEYS.map(({ key, icon: IconComponent }) => {
    const filename = settings.headerIcons[key]
    const iconColor = safeColorValue(settings.headerIconColors[key], '#ffffff')

    let ActualIcon = IconComponent
    if (key === 'newConversation' && filename.includes('rotate')) {
      ActualIcon = RotateCcw
    }
    if (key === 'newConversation' && filename.includes('circle')) {
      ActualIcon = MessageCirclePlus
    }
    if (key === 'newConversation' && filename.includes('refresh')) {
      ActualIcon = RefreshCw
    }
    if (key === 'maximize' && filename.includes('expand')) {
      ActualIcon = Expand
    }
    if (key === 'maximize' && filename.includes('arrow')) {
      ActualIcon = ArrowUpLeft
    }
    if (key === 'maximize' && filename.includes('chevrons')) {
      ActualIcon = ChevronsLeftRight
    }
    if (key === 'minimize' && filename.includes('shrink')) {
      ActualIcon = Shrink
    }
    if (key === 'minimize' && filename.includes('arrow')) {
      ActualIcon = ArrowDownRight
    }
    if (key === 'minimize' && filename.includes('chevrons')) {
      ActualIcon = ChevronsRightLeft
    }
    if (key === 'close' && filename.includes('logout')) {
      ActualIcon = LogOut
    }
    if (key === 'close' && filename.includes('chevron')) {
      ActualIcon = ChevronDown
    }
    if (key === 'close' && filename.includes('circle-x')) {
      ActualIcon = CircleX
    }

    return (
      <span
        key={key}
        className="flex h-8 w-8 items-center justify-center text-sm"
        style={{ color: iconColor }}
      >
        <ActualIcon className="h-4 w-4" />
      </span>
    )
  })

  const sendAccentStyles = {
    color: safeColorValue(settings.sendIconColor, '#6b7280'),
  }
  const assistantTimestampColor = safeColorValue(
    settings.aiMessageTimeColor,
    '#999999'
  )
  const userTimestampColor = safeColorValue(
    settings.userMessageTimeColor,
    '#cccccc'
  )
  const inputPlaceholderColor =
    inputTextColor.toLowerCase() === '#ffffff'
      ? 'rgba(255,255,255,0.6)'
      : 'rgba(0,0,0,0.5)'

  return (
    <div
      className="overflow-hidden rounded-2xl border shadow-sm"
      style={{ borderColor }}
    >
      <style>{`
        .chat-preview-scroll::-webkit-scrollbar { width: 8px; }
        .chat-preview-scroll::-webkit-scrollbar-thumb { background-color: ${scrollbarThumbColor}; border-radius: 999px; }
        .chat-preview-scroll::-webkit-scrollbar-track { background-color: ${scrollbarTrackColor}; }
        .chat-preview-input::placeholder { color: ${inputPlaceholderColor} !important; }
        .chat-preview-input-container:focus-within { border-color: ${inputFocusBorderColor} !important; }
        .chat-preview-input {
          padding: 6px 16px;
          line-height: 18px;
          box-sizing: border-box;
          height: 30px;
        }
      `}</style>
      <div
        className="flex h-[700px] flex-col"
        style={{ backgroundColor: chatWindowBackgroundColor }}
      >
        <header
          className="flex items-center justify-between px-4 py-3"
          style={{ backgroundColor: headerBackgroundColor }}
        >
          <div className="flex items-center space-x-2">
            <img
              src={logoSrc}
              alt={t.chat_settings_image_alt_aitalk}
              className="h-8 w-8 rounded-md object-contain"
            />
            <div className="leading-tight">
              <p
                className="text-sm font-bold"
                style={{ color: headerTextColor }}
              >
                {settings.headerTitle || ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-white">
            {headerIconElements}
          </div>
        </header>

        <div
          className="chat-preview-scroll flex-1 overflow-y-auto px-4 py-4"
          style={{
            backgroundColor: chatWindowBackgroundColor,
            scrollbarColor: `${scrollbarThumbColor} ${scrollbarTrackColor}`,
          }}
        >
          <div className="mx-auto flex max-w-4xl flex-col space-y-4">
            {initialMessageText && (
              <div className="flex justify-start">
                <div
                  className="max-w-[90%] rounded-lg rounded-bl-none px-3 py-2 text-sm shadow-sm"
                  style={{
                    backgroundColor: assistantBackgroundColor,
                    color: assistantTextColor,
                  }}
                >
                  <div className="whitespace-pre-wrap">{initialMessageText}</div>
                  <p
                    className="mt-1 text-xs"
                    style={{ color: assistantTimestampColor }}
                  >
                    09:30
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <div
                className="max-w-[90%] rounded-lg rounded-br-none px-3 py-2 text-sm shadow-sm"
                style={{
                  backgroundColor: userBackgroundColor,
                  color: userTextColor,
                }}
              >
                <div className="whitespace-pre-wrap">
                  {t('preview_user_message_1')}
                </div>
                <p
                  className="mt-1 text-xs"
                  style={{ color: userTimestampColor }}
                >
                  09:31
                </p>
              </div>
            </div>

            <div className="flex justify-start">
              <div className="rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{
                          backgroundColor: loadingDotColor,
                          animationDelay: `${dot * 200}ms`,
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className="text-xs italic"
                    style={{ color: loadingTextColor }}
                  >
                    {t('preview_loading_message')}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-start">
              <div
                className="max-w-[90%] rounded-lg rounded-bl-none px-3 py-2 text-sm shadow-sm"
                style={{
                  backgroundColor: assistantBackgroundColor,
                  color: assistantTextColor,
                }}
              >
                <div className="whitespace-pre-wrap">
                  {t('preview_assistant_message_1')}
                </div>
                <p
                  className="mt-1 text-xs"
                  style={{ color: assistantTimestampColor }}
                >
                  09:32
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <div
                className="max-w-[90%] rounded-lg rounded-br-none px-3 py-2 text-sm shadow-sm"
                style={{
                  backgroundColor: userBackgroundColor,
                  color: userTextColor,
                }}
              >
                <div className="whitespace-pre-wrap">
                  {t('preview_user_message_2')}
                </div>
                <p
                  className="mt-1 text-xs"
                  style={{ color: userTimestampColor }}
                >
                  09:33
                </p>
              </div>
            </div>

            <div className="flex justify-start">
              <div
                className="max-w-[90%] rounded-lg rounded-bl-none px-3 py-2 text-sm shadow-sm"
                style={{
                  backgroundColor: assistantBackgroundColor,
                  color: assistantTextColor,
                }}
              >
                <div className="whitespace-pre-wrap">
                  {t('preview_assistant_message_2')}
                </div>
                <p
                  className="mt-1 text-xs"
                  style={{ color: assistantTimestampColor }}
                >
                  09:34
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <div
                className="max-w-[90%] rounded-lg rounded-br-none px-3 py-2 text-sm shadow-sm"
                style={{
                  backgroundColor: userBackgroundColor,
                  color: userTextColor,
                }}
              >
                <div className="whitespace-pre-wrap">
                  {t('preview_user_message_3')}
                </div>
                <p
                  className="mt-1 text-xs"
                  style={{ color: userTimestampColor }}
                >
                  09:35
                </p>
              </div>
            </div>

            <div className="flex justify-start">
              <div
                className="max-w-[90%] rounded-lg rounded-bl-none px-3 py-2 text-sm shadow-sm"
                style={{
                  backgroundColor: assistantBackgroundColor,
                  color: assistantTextColor,
                }}
              >
                <div className="whitespace-pre-wrap">
                  {t('preview_assistant_message_3')
                    .split('\n')
                    .map((line: string, index: number) => {
                      if (
                        line === 'Snowboard Options:' ||
                        line === 'Essential Equipment:'
                      ) {
                        return (
                          <div key={index} className="font-bold">
                            {line}
                          </div>
                        )
                      }
                      return <div key={index}>{line || '\u00A0'}</div>
                    })}
                </div>
                <p
                  className="mt-1 text-xs"
                  style={{ color: assistantTimestampColor }}
                >
                  09:36
                </p>
              </div>
            </div>
          </div>
        </div>

        {recommendedQuestionsText.some((question) => question) && (
          <div
            className="flex flex-wrap gap-2 border-t px-4 py-3 justify-end"
            style={{ borderColor: chatWindowBackgroundColor }}
          >
            {recommendedQuestionsText.map((question, index) =>
              question ? (
                <span
                  key={index}
                  className="rounded-full px-3 py-1 text-xs font-medium shadow-sm"
                  style={{
                    backgroundColor: safeColorValue(
                      settings.recommendedQuestionsBackgroundColor,
                      '#ffffff'
                    ),
                    color: safeColorValue(
                      settings.recommendedQuestionsTextColor,
                      '#000000'
                    ),
                    border: `1px solid ${borderColor}`,
                  }}
                >
                  {question}
                </span>
              ) : null
            )}
          </div>
        )}

        <div
          className="border-t px-4 py-3 text-xs"
          style={{
            borderColor: chatWindowBackgroundColor,
            backgroundColor: safeColorValue(
              settings.privacyPolicy.backgroundColor,
              '#f8f8f8'
            ),
            color: safeColorValue(settings.privacyPolicy.textColor, '#555555'),
          }}
        >
          {privacyNoticeText}{' '}
          <a
            href={settings.privacyPolicy.url || '#'}
            onClick={(event) => event.preventDefault()}
            className="underline"
            style={{
              color: safeColorValue(
                settings.privacyPolicy.linkColor,
                '#007bff'
              ),
            }}
          >
            {privacyLinkText}
          </a>
        </div>

        <div
          className="border-t p-3"
          style={{
            borderColor: chatWindowBackgroundColor,
            backgroundColor: chatWindowBackgroundColor,
          }}
        >
          <div className="mx-auto max-w-4xl">
            <div
              className="chat-preview-input-container flex items-center rounded-xl border shadow-sm"
              style={{
                backgroundColor: inputBackgroundColor,
                borderColor: inputBorderColor,
              }}
            >
              <textarea
                readOnly
                placeholder={inputPlaceholderText}
                className="chat-preview-input flex-1 min-h-[30px] max-h-[105px] resize-none bg-transparent border-none text-sm focus:outline-none focus:ring-0"
                style={{ color: inputTextColor }}
              />
              <div className="mr-1 flex h-8 w-16 items-center justify-center">
                <span
                  className="flex h-6 w-6 items-center justify-center"
                  style={sendAccentStyles}
                >
                  {settings.sendIcon.includes('corner-down-left') ? (
                    <CornerDownLeft className="h-4 w-4" />
                  ) : settings.sendIcon.includes('navigation') ? (
                    <Navigation className="h-4 w-4" />
                  ) : settings.sendIcon.includes('send-horizontal') ? (
                    <SendHorizontal className="h-4 w-4" />
                  ) : (
                    <Send className="h-4 w-4 translate-x-0.5 translate-y-0.5" />
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {settings.poweredByImage !== 'none' && (
          <div
            className="border-t px-5 py-2"
            style={{
              borderColor: chatWindowBackgroundColor,
              backgroundColor: chatWindowBackgroundColor,
            }}
          >
            <div className="flex items-center justify-center">
              <a
                href="https://www.aitalk.ch"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs no-underline"
                style={{
                  color: safeColorValue(settings.poweredByTextColor, '#666666'),
                }}
              >
                <span>Powered by</span>
                <img
                  src={
                    settings.poweredByImage === 'AITalk02_w.png'
                      ? assets.poweredByWhite
                      : assets.poweredByBlack
                  }
                  alt={t.chat_settings_image_alt_aitalk}
                  className="h-3.5"
                />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
