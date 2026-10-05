'use client'

import { isUnsupportedLocaleValue, UnsupportedLocaleItem, UnsupportedLocaleNotice } from '../UnsupportedLocale'
import React, { useEffect } from 'react'
import type { Node } from 'reactflow'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Phone } from 'lucide-react'
import { LANGUAGES, getAzureVoicesForLanguage, getVoiceGroupsForLanguage, REALTIME_VOICES, REALTIME_LANGUAGES, isRealtimeVoice, isHdVoice, toRealtimeFamilyLocale } from '../../constants/voice-constants'
import { isRealtimeAiNode, findFirstAiNodeFrom } from '../../utils/nodeUtils'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const PstnPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { workflow } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const targetPhoneNumber = node.data.targetPhoneNumber || ''
  const greeting = node.data.greeting || ''
  const language = node.data.language || 'de-CH'
  const voiceName = node.data.voiceName || 'coral'
  const maxDurationMinutes = node.data.maxDurationMinutes || 10
  const callScript = node.data.callScript || ''

  const connectedAiNode = findFirstAiNodeFrom(node.id, workflow.nodes, workflow.edges)
  const isRealtimeMode = isRealtimeAiNode(connectedAiNode)
  const voiceOptions = isRealtimeMode ? REALTIME_VOICES : getAzureVoicesForLanguage(language)
  const voiceGroups = getVoiceGroupsForLanguage(language)

  useEffect(() => {
    if (isRealtimeMode) {
      const patch: Record<string, any> = {}
      if (!isRealtimeVoice(voiceName)) {
        patch.voiceName = REALTIME_VOICES[0].value
      }
      const familyLocale = toRealtimeFamilyLocale(language)
      if (familyLocale !== null && familyLocale !== language) {
        patch.language = familyLocale
      }
      if (Object.keys(patch).length > 0) updateNodeData(patch)
      return
    }
    if (isRealtimeVoice(voiceName)) {
      const azureDefault = getAzureVoicesForLanguage(language)[0]?.value
      if (azureDefault) updateNodeData({ voiceName: azureDefault })
      return
    }
    const validValues = getAzureVoicesForLanguage(language).map((v) => v.value)
    if (!validValues.includes(voiceName)) {
      const defaultVoice = getAzureVoicesForLanguage(language)[0]?.value
      if (defaultVoice) updateNodeData({ voiceName: defaultVoice })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, isRealtimeMode])

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 bg-teal-500/10 border border-teal-500/20 rounded-lg">
        <Phone className="w-4 h-4 text-teal-400 mt-0.5 shrink-0" />
        <p className="text-xs text-gray-300">
          {t.pstn_out_hint || 'Places an outbound call to the given number and starts an AI voice conversation. Template variables are supported.'}
        </p>
      </div>

      {/* Target Phone Number */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          {t.pstn_phone_number || 'Phone Number'} <span className="text-red-400">*</span>
        </label>
        <Input
          value={targetPhoneNumber}
          onChange={(e) => updateNodeData({ targetPhoneNumber: e.target.value })}
          placeholder="+41791234567 or {{context.phoneNumber}}"
          className="bg-[#1e1e2e] border-gray-700 text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">{t.pstn_out_phone_hint || 'E.164 format or a template variable'}</p>
      </div>

      {/* Language */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          {t.pstn_language || 'Language'}
        </label>
        <Select
          value={language}
          onValueChange={(val) => updateNodeData({ language: val })}
        >
          <SelectTrigger className="bg-[#1e1e2e] border-gray-700 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {isUnsupportedLocaleValue(language, isRealtimeMode ? REALTIME_LANGUAGES : LANGUAGES) && (
              <UnsupportedLocaleItem value={language} />
            )}
            {(isRealtimeMode ? REALTIME_LANGUAGES : LANGUAGES).map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isUnsupportedLocaleValue(language, isRealtimeMode ? REALTIME_LANGUAGES : LANGUAGES) && (
          <UnsupportedLocaleNotice text={t.pstn_language_unsupported || 'This language is no longer supported — please pick another one.'} />
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          {t.pstn_voice || 'Voice'}
        </label>
        <Select
          value={voiceName}
          onValueChange={(val) => updateNodeData({ voiceName: val })}
        >
          <SelectTrigger className="bg-[#1e1e2e] border-gray-700 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {isRealtimeMode ? (
              <SelectGroup>
                <SelectLabel className="text-xs text-teal-400">Realtime (OpenAI native, multilingual)</SelectLabel>
                {REALTIME_VOICES.map((voice) => (
                  <SelectItem key={voice.value} value={voice.value}>
                    {voice.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : (
              <>
                {voiceGroups.hd.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-xs text-amber-400">HD (premium)</SelectLabel>
                    {voiceGroups.hd.map((voice) => (
                      <SelectItem key={voice.value} value={voice.value}>
                        {voice.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {voiceGroups.standard.length > 0 && (
                  <SelectGroup>
                    {voiceGroups.hd.length > 0 && (
                      <SelectLabel className="text-xs text-gray-500">Standard</SelectLabel>
                    )}
                    {voiceGroups.standard.map((voice) => (
                      <SelectItem key={voice.value} value={voice.value}>
                        {voice.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {voiceGroups.standard.length === 0 && voiceGroups.hd.length === 0 && (
                  voiceOptions.map((voice) => (
                    <SelectItem key={voice.value} value={voice.value}>
                      {voice.label}
                    </SelectItem>
                  ))
                )}
              </>
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500 mt-1">
          {isRealtimeMode
            ? 'OpenAI Realtime — multilingual auto-switch'
            : isHdVoice(voiceName)
              ? 'Azure Neural — DragonHD (Sweden Central)'
              : 'Azure Neural — Standard (Switzerland North)'}
        </p>
      </div>

      {/* Greeting */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          {t.pstn_greeting || 'Greeting Message'}
        </label>
        <Textarea
          value={greeting}
          onChange={(e) => updateNodeData({ greeting: e.target.value })}
          placeholder="Hallo, hier ist AI Talk."
          className="bg-[#1e1e2e] border-gray-700 text-sm min-h-[60px]"
        />
        <p className="text-xs text-gray-500 mt-1">{t.pstn_out_greeting_hint || 'First message once the call connects'}</p>
      </div>

      {/* Max Duration */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          {t.pstn_out_max_duration || 'Max Duration (minutes)'}
        </label>
        <Input
          type="number"
          value={maxDurationMinutes}
          onChange={(e) => updateNodeData({ maxDurationMinutes: parseInt(e.target.value) || 10 })}
          min={1}
          max={60}
          className="bg-[#1e1e2e] border-gray-700 text-sm"
        />
      </div>

      {/* Call Script */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          {t.pstn_out_call_script || 'Call Script (optional)'}
        </label>
        <Textarea
          value={callScript}
          onChange={(e) => updateNodeData({ callScript: e.target.value })}
          placeholder={t.pstn_out_call_script_placeholder || 'Extra instructions for the AI during the call...'}
          className="bg-[#1e1e2e] border-gray-700 text-sm min-h-[80px]"
        />
        <p className="text-xs text-gray-500 mt-1">{t.pstn_out_call_script_hint || 'Appended to the AI system prompt'}</p>
      </div>
    </div>
  )
}
