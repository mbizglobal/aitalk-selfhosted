'use client'

import 'cropperjs/dist/cropper.css'
import { useChatSettingsState, useCropImage, useMultiLang } from './hooks'
import { ChatSettingsLayout } from './components'

export default function ChatSettingsClient() {
  const {
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
    t,
    currentLanguage,
  } = useChatSettingsState()

  const {
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
    openFileDialog,
  } = useCropImage({
    settings,
    agentId,
    userPlan,
    handleUpdate,
    t,
  })

  const {
    editingField,
    isMultiLangModalOpen,
    openMultiLangModal,
    closeMultiLangModal,
    getFieldValue,
    setFieldValue,
    getFieldLabel,
  } = useMultiLang({
    settings,
    handleUpdate,
    t,
  })

  // closeCropModal function
  const closeCropModal = () => {
    handleCropCancel()
  }

  return (
    <ChatSettingsLayout
      settings={settings}
      loading={loading}
      saving={saving}
      isDirty={isDirty}
      agentId={agentId}
      agentTitle={agentTitle}
      userPlan={userPlan}
      userServiceVariant={userServiceVariant}
      poweredByRule={poweredByRule}
      planLoading={planLoading}
      activeTab={activeTab || 'general'}
      handleTabChange={handleTabChange}
      handleUpdate={handleUpdate}
      handleSave={handleSave}
      handleReset={handleReset}
      handleDiscard={handleDiscard}
      openMultiLangModal={openMultiLangModal}
      getFieldValue={getFieldValue}
      setFieldValue={setFieldValue}
      getFieldLabel={getFieldLabel}
      isMultiLangModalOpen={isMultiLangModalOpen}
      editingField={editingField}
      closeMultiLangModal={closeMultiLangModal}
      fileInputRef={fileInputRef}
      cropImageRef={cropImageRef}
      cropImageSrc={cropImageSrc}
      isCropModalOpen={isCropModalOpen}
      isCropping={isCropping}
      isDragOver={isDragOver}
      handleCropImageLoad={handleCropImageLoad}
      handleCropCancel={handleCropCancel}
      handleCropConfirm={handleCropConfirm}
      handleIconFileChange={handleIconFileChange}
      handleDragOver={handleDragOver}
      handleDragLeave={handleDragLeave}
      handleDrop={handleDrop}
      handleRemoveCustomIcon={handleRemoveCustomIcon}
      closeCropModal={closeCropModal}
      t={t}
      currentLanguage={currentLanguage}
    />
  )
}
