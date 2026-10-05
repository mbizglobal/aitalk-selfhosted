'use client'

import { Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { WidgetSettings } from '@/lib/widget-settings'
import { TabNavigation } from './TabNavigation'
import { PreviewCard } from './PreviewCard'
import { GeneralTab, IconsTab, ExperienceTab, PrivacyTab, ChatButtonTab } from './tabs'
import { CropModal } from '../modals/CropModal'
import { MultiLangModal } from '../modals/MultiLangModal'
import type { EditableField, TranslationFn } from '../types'
import type { PoweredByRule } from '@/lib/selfhosted-policy'

interface ChatSettingsLayoutProps {
  // Settings state
  settings: WidgetSettings
  loading: boolean
  saving: boolean
  isDirty: boolean

  // Agent info
  agentId: string
  agentTitle: string
  userPlan: string
  userServiceVariant: string
  poweredByRule: PoweredByRule
  planLoading: boolean

  // Tab state
  activeTab: string
  handleTabChange: (tab: string) => void

  // Settings handlers
  handleUpdate: (path: string, value: unknown) => void
  handleSave: () => Promise<void>
  handleReset: () => void
  handleDiscard: () => void

  // Multi-language
  openMultiLangModal: (field: EditableField) => void
  getFieldValue: (field: EditableField) => Record<string, string> | null
  setFieldValue: (field: EditableField, value: Record<string, string> | null) => void
  getFieldLabel: (field: EditableField) => {
    title: string
    description: string
    placeholder: string
    maxLength: number
  }

  // Multi-lang modal state
  isMultiLangModalOpen: boolean
  editingField: EditableField | null
  closeMultiLangModal: () => void

  // Crop image
  fileInputRef: React.RefObject<HTMLInputElement | null>
  cropImageRef: React.RefObject<HTMLImageElement | null>
  cropImageSrc: string | null
  isCropModalOpen: boolean
  isCropping: boolean
  isDragOver: boolean
  handleCropImageLoad: () => void
  handleCropCancel: () => void
  handleCropConfirm: () => void
  handleIconFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleDragOver: (e: React.DragEvent) => void
  handleDragLeave: (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent) => void
  handleRemoveCustomIcon: () => void
  closeCropModal: () => void

  // Translations
  t: TranslationFn
  currentLanguage: string
}

export function ChatSettingsLayout({
  settings,
  loading,
  saving,
  isDirty,
  agentId,
  agentTitle,
  userPlan,
  userServiceVariant,
  poweredByRule,
  planLoading,
  activeTab,
  handleTabChange,
  handleUpdate,
  handleSave,
  handleReset,
  handleDiscard,
  openMultiLangModal,
  getFieldValue,
  setFieldValue,
  getFieldLabel,
  isMultiLangModalOpen,
  editingField,
  closeMultiLangModal,
  fileInputRef,
  cropImageRef,
  cropImageSrc,
  isCropModalOpen,
  isCropping,
  isDragOver,
  handleCropImageLoad,
  handleCropCancel,
  handleCropConfirm,
  handleIconFileChange,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleRemoveCustomIcon,
  closeCropModal,
  t,
  currentLanguage,
}: ChatSettingsLayoutProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t('chat_settings_title')}
          </h1>
          <p className="text-muted-foreground">{t('chat_settings_description')}</p>
        </div>
        <Card>
          <CardContent className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          {t('chat_settings_title')}
        </h1>
        {agentTitle && (
          <p className="text-sm text-muted-foreground">
            {t.chat_settings_ai_assistant_label}{' '}
            <span className="font-medium text-foreground">{agentTitle}</span>
          </p>
        )}
      </div>

      <TabNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        t={t}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {activeTab === 'general' && (
            <GeneralTab
              settings={settings}
              onUpdate={handleUpdate}
              t={t}
              userPlan={userPlan}
              agentTitle={agentTitle}
              onOpenMultiLangModal={openMultiLangModal}
              currentLanguage={currentLanguage}
              loading={loading}
              onReset={handleReset}
            />
          )}

          {activeTab === 'icons' && (
            <IconsTab
              settings={settings}
              onUpdate={handleUpdate}
              t={t}
              userPlan={userPlan}
              poweredByRule={poweredByRule}
              onOpenMultiLangModal={openMultiLangModal}
              currentLanguage={currentLanguage}
              planLoading={planLoading}
              onReset={handleReset}
              fileInputRef={fileInputRef}
              isDragOver={isDragOver}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onFileChange={handleIconFileChange}
              onRemoveCustomIcon={handleRemoveCustomIcon}
            />
          )}

          {activeTab === 'experience' && (
            <ExperienceTab
              settings={settings}
              onUpdate={handleUpdate}
              t={t}
              userPlan={userPlan}
              onOpenMultiLangModal={openMultiLangModal}
              currentLanguage={currentLanguage}
              onReset={handleReset}
              getFieldValue={getFieldValue}
            />
          )}

          {activeTab === 'privacy' && (
            <PrivacyTab
              settings={settings}
              onUpdate={handleUpdate}
              t={t}
              userPlan={userPlan}
              onOpenMultiLangModal={openMultiLangModal}
              currentLanguage={currentLanguage}
              onReset={handleReset}
            />
          )}

          {activeTab === 'chat-button' && (
            <ChatButtonTab
              settings={settings}
              onUpdate={handleUpdate}
              t={t}
              userPlan={userPlan}
              onCustomIconUpload={() => fileInputRef.current?.click()}
              onCustomIconRemove={handleRemoveCustomIcon}
              customIconUploading={false}
              currentLanguage={currentLanguage}
              onReset={handleReset}
              onOpenMultiLangModal={openMultiLangModal}
            />
          )}
        </div>

        <PreviewCard
          settings={settings}
          t={t}
          activeTab={activeTab}
          loading={loading}
          isDirty={isDirty}
          saving={saving}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      </div>

      {/* Modals */}
      <CropModal
        isOpen={isCropModalOpen}
        onClose={closeCropModal}
        imageSrc={cropImageSrc}
        onCrop={handleCropConfirm}
        onCancel={handleCropCancel}
        isCropping={isCropping}
        cropImageRef={cropImageRef}
        onImageLoad={handleCropImageLoad}
        t={t}
      />

      <MultiLangModal
        isOpen={isMultiLangModalOpen}
        onClose={closeMultiLangModal}
        editingField={editingField}
        settings={settings}
        onUpdate={handleUpdate}
        t={t}
        currentLanguage={currentLanguage}
        getFieldValue={getFieldValue}
        setFieldValue={setFieldValue}
        getFieldLabel={getFieldLabel}
        agentId={agentId}
        userServiceVariant={userServiceVariant}
      />
    </div>
  )
}
