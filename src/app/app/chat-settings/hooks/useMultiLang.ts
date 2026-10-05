'use client'

import { useState, useCallback } from 'react'
import type { WidgetSettings } from '@/lib/widget-settings'
import type { EditableField, MultiLangEditMode, TranslationFn } from '../types'

interface UseMultiLangProps {
  settings: WidgetSettings
  handleUpdate: (path: string, value: unknown) => void
  t: TranslationFn
}

export function useMultiLang({ settings, handleUpdate, t }: UseMultiLangProps) {
  const [editingField, setEditingField] = useState<EditableField | null>(null)
  const [isMultiLangModalOpen, setIsMultiLangModalOpen] = useState(false)
  const [multiLangEditMode, setMultiLangEditMode] =
    useState<MultiLangEditMode>('list')
  const [editingLanguageCode, setEditingLanguageCode] = useState<string | null>(
    null
  )
  const [editingLanguageText, setEditingLanguageText] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)

  // Get field value from settings
  const getFieldValue = useCallback(
    (field: EditableField): Record<string, string> | null => {
      switch (field) {
        case 'welcomeMessage':
          return settings.welcomeMessage || null
        case 'initialMessage':
          return settings.initialMessage || null
        case 'inputPlaceholder':
          return settings.inputPlaceholder || null
        case 'privacyPolicyText':
          return settings.privacyPolicy?.text || null
        case 'privacyPolicyLinkText':
          return settings.privacyPolicy?.linkText || null
        case 'recommendedQuestion1':
          return settings.recommendedQuestions?.[0] || null
        case 'recommendedQuestion2':
          return settings.recommendedQuestions?.[1] || null
        case 'recommendedQuestion3':
          return settings.recommendedQuestions?.[2] || null
        case 'recommendedQuestion4':
          return settings.recommendedQuestions?.[3] || null
        default:
          return null
      }
    },
    [settings]
  )

  // Set field value in settings
  const setFieldValue = useCallback(
    (field: EditableField, value: Record<string, string> | null) => {
      switch (field) {
        case 'welcomeMessage':
          handleUpdate('welcomeMessage', value)
          break
        case 'initialMessage':
          handleUpdate('initialMessage', value)
          break
        case 'inputPlaceholder':
          handleUpdate('inputPlaceholder', value)
          break
        case 'privacyPolicyText':
          handleUpdate('privacyPolicy.text', value)
          break
        case 'privacyPolicyLinkText':
          handleUpdate('privacyPolicy.linkText', value)
          break
        case 'recommendedQuestion1':
          handleUpdate('recommendedQuestions.0', value)
          break
        case 'recommendedQuestion2':
          handleUpdate('recommendedQuestions.1', value)
          break
        case 'recommendedQuestion3':
          handleUpdate('recommendedQuestions.2', value)
          break
        case 'recommendedQuestion4':
          handleUpdate('recommendedQuestions.3', value)
          break
      }
    },
    [handleUpdate]
  )

  // Get field labels
  const getFieldLabel = useCallback(
    (
      field: EditableField
    ): {
      title: string
      description: string
      placeholder: string
      maxLength: number
    } => {
      switch (field) {
        case 'welcomeMessage':
          return {
            title: t.chat_settings_field_welcome_message_title,
            description: t.chat_settings_field_welcome_message_description,
            placeholder: t.chat_settings_field_welcome_message_placeholder,
            maxLength: 200,
          }
        case 'initialMessage':
          return {
            title: t.chat_settings_field_initial_message_title,
            description: t.chat_settings_field_initial_message_description,
            placeholder: t.chat_settings_field_initial_message_placeholder,
            maxLength: 500,
          }
        case 'inputPlaceholder':
          return {
            title: t.chat_settings_field_input_placeholder_title,
            description: t.chat_settings_field_input_placeholder_description,
            placeholder: t.chat_settings_field_input_placeholder_placeholder,
            maxLength: 100,
          }
        case 'privacyPolicyText':
          return {
            title: t.chat_settings_field_privacy_policy_text_title,
            description: t.chat_settings_field_privacy_policy_text_description,
            placeholder: t.chat_settings_field_privacy_policy_text_placeholder,
            maxLength: 200,
          }
        case 'privacyPolicyLinkText':
          return {
            title: t.chat_settings_field_privacy_policy_link_text_title,
            description:
              t.chat_settings_field_privacy_policy_link_text_description,
            placeholder:
              t.chat_settings_field_privacy_policy_link_text_placeholder,
            maxLength: 50,
          }
        case 'recommendedQuestion1':
          return {
            title: t.chat_settings_field_recommended_question_1_title,
            description:
              t.chat_settings_field_recommended_question_1_description,
            placeholder: t.chat_settings_field_recommended_question_placeholder,
            maxLength: 100,
          }
        case 'recommendedQuestion2':
          return {
            title: t.chat_settings_field_recommended_question_2_title,
            description:
              t.chat_settings_field_recommended_question_2_description,
            placeholder: t.chat_settings_field_recommended_question_placeholder,
            maxLength: 100,
          }
        case 'recommendedQuestion3':
          return {
            title: t.chat_settings_field_recommended_question_3_title,
            description:
              t.chat_settings_field_recommended_question_3_description,
            placeholder: t.chat_settings_field_recommended_question_placeholder,
            maxLength: 100,
          }
        case 'recommendedQuestion4':
          return {
            title: t.chat_settings_field_recommended_question_4_title,
            description:
              t.chat_settings_field_recommended_question_4_description,
            placeholder: t.chat_settings_field_recommended_question_placeholder,
            maxLength: 100,
          }
        default:
          return {
            title: t.chat_settings_field_default_title,
            description: '',
            placeholder: '',
            maxLength: 200,
          }
      }
    },
    [t]
  )

  // Open multi-language modal
  const openMultiLangModal = useCallback((field: EditableField) => {
    setEditingField(field)
    setMultiLangEditMode('list')
    setIsMultiLangModalOpen(true)
  }, [])

  // Close multi-language modal
  const closeMultiLangModal = useCallback(() => {
    setIsMultiLangModalOpen(false)
    setEditingField(null)
    setMultiLangEditMode('list')
    setEditingLanguageCode(null)
    setEditingLanguageText('')
  }, [])

  return {
    // State
    editingField,
    isMultiLangModalOpen,
    multiLangEditMode,
    editingLanguageCode,
    editingLanguageText,
    isTranslating,

    // Setters
    setEditingField,
    setIsMultiLangModalOpen,
    setMultiLangEditMode,
    setEditingLanguageCode,
    setEditingLanguageText,
    setIsTranslating,

    // Helpers
    getFieldValue,
    setFieldValue,
    getFieldLabel,

    // Actions
    openMultiLangModal,
    closeMultiLangModal,
  }
}
