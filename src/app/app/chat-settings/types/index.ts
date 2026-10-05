import { HEADER_KEYS, VALID_TABS } from '../constants'
import type { WidgetSettings } from '@/lib/widget-settings'

// Header Types
export type HeaderKey = (typeof HEADER_KEYS)[number]['key']
export type HeaderTheme = 'light' | 'dark'

// Tab Types
export type TabType = (typeof VALID_TABS)[number]

// Editable Field Types (for Multi-language Modal)
export type EditableField =
  | 'welcomeMessage'
  | 'initialMessage'
  | 'inputPlaceholder'
  | 'privacyPolicyText'
  | 'privacyPolicyLinkText'
  | 'recommendedQuestion1'
  | 'recommendedQuestion2'
  | 'recommendedQuestion3'
  | 'recommendedQuestion4'

// Multi-language Modal Mode
export type MultiLangEditMode = 'list' | 'add' | 'edit' | 'apiKeyRequired'

// Chat Settings State
export interface ChatSettingsState {
  settings: WidgetSettings
  initialSettings: WidgetSettings
  loading: boolean
  saving: boolean
  agentId: string
  agentTitle: string
  userPlan: string
  planLoading: boolean
  activeTab: string
}

// Multi-language Modal State
export interface MultiLangModalState {
  editingField: EditableField | null
  isOpen: boolean
  editMode: MultiLangEditMode
  editingLanguageCode: string | null
  editingLanguageText: string
  isTranslating: boolean
}

// Crop Modal State
export interface CropModalState {
  imageSrc: string | null
  isOpen: boolean
  isCropping: boolean
  isDragOver: boolean
}

// Translation Function Type
export type TranslationFn = ((key: string) => string) & Record<string, string>

// Props Types for Components
export interface TabProps {
  settings: WidgetSettings
  onUpdate: (path: string, value: any) => void
  t: TranslationFn
  userPlan: string
}

export interface GeneralTabProps extends TabProps {
  agentTitle: string
  onOpenMultiLangModal: (field: EditableField) => void
}

export interface IconsTabProps extends TabProps {
  onOpenMultiLangModal: (field: EditableField) => void
}

export interface ExperienceTabProps extends TabProps {
  onOpenMultiLangModal: (field: EditableField) => void
}

export interface PrivacyTabProps extends TabProps {
  onOpenMultiLangModal: (field: EditableField) => void
}

export interface ChatButtonTabProps extends TabProps {
  onCustomIconUpload: () => void
  onCustomIconRemove: () => void
  customIconUploading: boolean
}

export interface PreviewCardProps {
  settings: WidgetSettings
  t: TranslationFn
  activeTab: string
}

export interface ChatPreviewProps {
  settings: WidgetSettings
  t: TranslationFn
}

export interface ChatButtonPreviewProps {
  settings: WidgetSettings
}

export interface CropModalProps {
  isOpen: boolean
  onClose: () => void
  imageSrc: string | null
  onCrop: () => void
  isCropping: boolean
  cropImageRef: React.RefObject<HTMLImageElement | null>
}

export interface MultiLangModalProps {
  isOpen: boolean
  onClose: () => void
  editingField: EditableField | null
  settings: WidgetSettings
  onUpdate: (path: string, value: any) => void
  t: TranslationFn
}

export interface ColorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  defaultColor?: string
}

export interface IconOptionButtonProps {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}
