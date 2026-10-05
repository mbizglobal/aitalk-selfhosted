'use client'

import { useEdition } from '@/components/EditionProvider'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Plus, Shield, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WidgetSettings } from '@/lib/widget-settings'
import { WELCOME_MESSAGE_LANGUAGES } from '../constants'
import type { EditableField, MultiLangEditMode, TranslationFn } from '../types'

interface MultiLangModalProps {
  isOpen: boolean
  onClose: () => void
  editingField: EditableField | null
  settings: WidgetSettings
  onUpdate: (path: string, value: unknown) => void
  t: TranslationFn
  currentLanguage: string
  getFieldValue: (field: EditableField) => Record<string, string> | null
  setFieldValue: (field: EditableField, value: Record<string, string> | null) => void
  getFieldLabel: (field: EditableField) => {
    title: string
    description: string
    placeholder: string
    maxLength: number
  }
  agentId: string
  userServiceVariant: string
}

export function MultiLangModal({
  isOpen,
  onClose,
  editingField,
  settings,
  onUpdate,
  t,
  currentLanguage,
  getFieldValue,
  setFieldValue,
  getFieldLabel,
  agentId,
  userServiceVariant,
}: MultiLangModalProps) {
  const isManaged = userServiceVariant === 'managed'
  const selfHosted = useEdition() === 'selfhosted'
  const router = useRouter()
  const [editMode, setEditMode] = useState<MultiLangEditMode>('list')
  const [editingLanguageCode, setEditingLanguageCode] = useState<string | null>(null)
  const [editingLanguageText, setEditingLanguageText] = useState('')
  const [isTranslating, setIsTranslating] = useState(false)

  const handleClose = () => {
    setEditMode('list')
    setEditingLanguageCode(null)
    setEditingLanguageText('')
    onClose()
  }

  if (!editingField) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        {editMode === 'apiKeyRequired' ? (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                {t.chat_settings_error_api_key_dialog_title}
              </DialogTitle>
              <DialogDescription className="pt-2 text-base">
                {t.chat_settings_error_api_key_dialog_description}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/50 dark:text-blue-200">
              {t.chat_settings_error_api_key_required}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditMode('list')}
              >
                {t.chat_settings_modal_cancel}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setEditMode('list')
                  handleClose()
                  router.push('/app/settings?tab=api-key')
                }}
              >
                {t.chat_settings_error_api_key_dialog_button}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {editMode === 'list'
                  ? t.chat_settings_modal_title_manage.replace(
                      '{field}',
                      getFieldLabel(editingField).title
                    )
                  : editMode === 'add'
                    ? t.chat_settings_modal_title_add.replace(
                        '{field}',
                        getFieldLabel(editingField).title
                      )
                    : t.chat_settings_modal_title_edit.replace(
                        '{field}',
                        getFieldLabel(editingField).title
                      )}
              </DialogTitle>
              <DialogDescription>
                {editMode === 'list'
                  ? t.chat_settings_modal_description_list
                  : editMode === 'add'
                    ? t.chat_settings_modal_description_add
                    : t.chat_settings_modal_description_edit}
              </DialogDescription>
            </DialogHeader>

            {editMode === 'list' && (
              <div className="space-y-4">
                {Object.entries(getFieldValue(editingField) || {}).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(getFieldValue(editingField) || {}).map(
                      ([langCode, text]) => {
                        const langInfo = WELCOME_MESSAGE_LANGUAGES.find(
                          (l) => l.code === langCode
                        )
                        return (
                          <div
                            key={langCode}
                            className="flex items-center gap-3 p-3 border rounded-lg"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium uppercase">
                                  {langCode}
                                </span>
                                {langInfo && (
                                  <span className="text-xs text-muted-foreground">
                                    ({langInfo.nativeName})
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground truncate">
                                {text}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingLanguageCode(langCode)
                                  setEditingLanguageText(text)
                                  setEditMode('edit')
                                }}
                              >
                                {t.chat_settings_button_edit}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const currentValue = {
                                    ...(getFieldValue(editingField) || {}),
                                  }
                                  delete currentValue[langCode]
                                  setFieldValue(
                                    editingField,
                                    Object.keys(currentValue).length > 0
                                      ? currentValue
                                      : null
                                  )
                                  toast.success(
                                    t.chat_settings_success_language_removed
                                  )
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )
                      }
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    {t.chat_settings_modal_no_languages_added}
                  </div>
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setEditMode('add')
                    setEditingLanguageCode(null)
                    setEditingLanguageText('')
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t.chat_settings_modal_add_another_language}
                </Button>
              </div>
            )}

            {editMode === 'add' && (
              <div className="space-y-4">
                {!getFieldValue(editingField) ||
                Object.keys(getFieldValue(editingField) || {}).length === 0 ? (
                  // First language: use current menu language
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium mb-2 block">
                        {t.chat_settings_modal_language_label}
                        {currentLanguage.toUpperCase()}
                      </Label>
                      <p className="text-xs text-muted-foreground mb-3">
                        {t.chat_settings_modal_first_language_help.replace(
                          '{language}',
                          currentLanguage
                        )}
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="field-text">
                        {getFieldLabel(editingField).title}
                      </Label>
                      <Textarea
                        id="field-text"
                        value={editingLanguageText}
                        onChange={(e) => setEditingLanguageText(e.target.value)}
                        placeholder={getFieldLabel(editingField).placeholder}
                        rows={3}
                        maxLength={getFieldLabel(editingField).maxLength}
                        className="mt-2"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {editingLanguageText.length}/
                        {getFieldLabel(editingField).maxLength}{' '}
                        {t.chat_settings_character_count}
                      </p>
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditMode('list')
                          setEditingLanguageText('')
                        }}
                      >
                        {t.chat_settings_modal_cancel}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          if (!editingLanguageText.trim()) {
                            toast.error(t.chat_settings_error_please_enter_text)
                            return
                          }
                          const newValue = {
                            ...(getFieldValue(editingField) || {}),
                            [currentLanguage]: editingLanguageText.trim(),
                          }
                          setFieldValue(editingField, newValue)
                          toast.success(t.chat_settings_success_text_added)
                          setEditMode('list')
                          setEditingLanguageText('')
                        }}
                      >
                        {t.chat_settings_modal_add_message}
                      </Button>
                    </DialogFooter>
                  </div>
                ) : (
                  // Additional languages: show language grid
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium mb-2 block">
                        {t.chat_settings_modal_select_language}
                      </Label>
                      <p className="text-xs text-muted-foreground mb-3">
                        {t.chat_settings_modal_translation_help}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto p-2 border rounded-lg">
                      {WELCOME_MESSAGE_LANGUAGES.filter(
                        (lang) =>
                          !getFieldValue(editingField) ||
                          !getFieldValue(editingField)?.[lang.code]
                      ).map((lang) => (
                        <Button
                          key={lang.code}
                          type="button"
                          variant="outline"
                          className="justify-start h-auto py-3 px-3"
                          onClick={async () => {
                            if (selfHosted) {
                              const currentFieldValue = getFieldValue(editingField) || {}
                              const sourceText = Object.values(currentFieldValue).find((v) => typeof v === 'string' && v.trim()) || ''
                              setFieldValue(editingField, { ...currentFieldValue, [lang.code]: sourceText })
                              toast.success(
                                t.chat_settings_success_text_added_for_language.replace('{language}', lang.nativeName)
                              )
                              setEditMode('list')
                              return
                            }
                            setIsTranslating(true)
                            try {
                              const currentFieldValue =
                                getFieldValue(editingField) || {}
                              const sourceLang = Object.keys(currentFieldValue)[0]
                              const sourceText = currentFieldValue[sourceLang] || ''

                              const response = await fetch(
                                '/api/translate-welcome-message',
                                {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    sourceLanguage: sourceLang,
                                    targetLanguage: lang.code,
                                    text: sourceText,
                                    agentId,
                                  }),
                                }
                              )

                              let data
                              try {
                                data = await response.json()
                              } catch (parseError) {
                                toast.error(t.chat_settings_error_translation_failed)
                                setIsTranslating(false)
                                return
                              }

                              if (
                                !isManaged &&
                                data?.errorCode === 'API_KEY_NOT_CONFIGURED'
                              ) {
                                setIsTranslating(false)
                                setEditMode('apiKeyRequired')
                                return
                              }

                              if (data?.errorCode === 'INSUFFICIENT_CPA') {
                                toast.error(t.chat_settings_error_insufficient_cpa)
                                setIsTranslating(false)
                                return
                              }

                              if (
                                data?.errorCode === 'MANAGED_REGION_MISSING' ||
                                data?.errorCode === 'MANAGED_UNAVAILABLE'
                              ) {
                                console.error(
                                  '[chat-settings] managed translation unavailable:',
                                  data?.errorCode
                                )
                                toast.error(
                                  t.chat_settings_error_translation_service_unavailable
                                )
                                setIsTranslating(false)
                                return
                              }

                              if (
                                data?.errorCode === 'AGENT_ID_REQUIRED' ||
                                data?.errorCode === 'AGENT_NOT_FOUND'
                              ) {
                                console.error(
                                  '[chat-settings] managed translation agent error:',
                                  data?.errorCode
                                )
                                toast.error(t.chat_settings_error_translation_failed)
                                setIsTranslating(false)
                                return
                              }

                              if (
                                !response.ok ||
                                data?.error ||
                                data?.success === false
                              ) {
                                toast.error(t.chat_settings_error_translation_failed)
                                setIsTranslating(false)
                                return
                              }

                              const translatedText = data.translatedText

                              const newValue = {
                                ...currentFieldValue,
                                [lang.code]: translatedText,
                              }
                              setFieldValue(editingField, newValue)
                              toast.success(
                                t.chat_settings_success_text_added_for_language.replace(
                                  '{language}',
                                  lang.nativeName
                                )
                              )
                              setEditMode('list')
                            } catch (error) {
                              if (
                                error instanceof Error &&
                                error.message.includes('API key')
                              ) {
                                setEditMode('apiKeyRequired')
                              } else {
                                toast.error(t.chat_settings_error_translation_failed)
                              }
                            } finally {
                              setIsTranslating(false)
                            }
                          }}
                          disabled={isTranslating}
                        >
                          <div className="text-left">
                            <div className="font-medium text-sm">
                              {lang.code.toUpperCase()}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {lang.nativeName}
                            </div>
                          </div>
                        </Button>
                      ))}
                    </div>
                    {isTranslating && (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-6 w-6 animate-spin mr-2" />
                        <span className="text-sm text-muted-foreground">
                          {t.chat_settings_modal_translating}
                        </span>
                      </div>
                    )}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditMode('list')
                        }}
                      >
                        {t.chat_settings_modal_back_to_list}
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </div>
            )}

            {editMode === 'edit' && editingLanguageCode && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium mb-2 block">
                    Language: {editingLanguageCode.toUpperCase()}
                  </Label>
                </div>
                <div>
                  <Label htmlFor="edit-field-text">
                    {getFieldLabel(editingField).title}
                  </Label>
                  <Textarea
                    id="edit-field-text"
                    value={editingLanguageText}
                    onChange={(e) => setEditingLanguageText(e.target.value)}
                    placeholder={getFieldLabel(editingField).placeholder}
                    rows={3}
                    maxLength={getFieldLabel(editingField).maxLength}
                    className="mt-2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {editingLanguageText.length}/
                    {getFieldLabel(editingField).maxLength}{' '}
                    {t.chat_settings_character_count}
                  </p>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditMode('list')
                      setEditingLanguageCode(null)
                      setEditingLanguageText('')
                    }}
                  >
                    {t.chat_settings_modal_cancel}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      if (!editingLanguageText.trim()) {
                        toast.error(t.chat_settings_error_please_enter_text)
                        return
                      }
                      const newValue = {
                        ...(getFieldValue(editingField) || {}),
                        [editingLanguageCode]: editingLanguageText.trim(),
                      }
                      setFieldValue(editingField, newValue)
                      toast.success(t.chat_settings_success_text_updated)
                      setEditMode('list')
                      setEditingLanguageCode(null)
                      setEditingLanguageText('')
                    }}
                  >
                    {t.chat_settings_modal_update_message}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
