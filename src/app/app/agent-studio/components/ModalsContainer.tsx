import {
  WidgetModal,
  InstructionsModal,
  ValidationDialog,
  ModelSettingsModal,
  ToolsModal,
  MiniAppModal,
  JsonSchemaModal,
  KnowledgeModal,
  TeamModal,
  TestModal,
  TemplateModal,
  PstnAdvancedSettingsModal,
  AcsSetupWizardModal,
  CalendarAdvancedSettingsModal,
  CalendarMonthlyPreviewModal,
  QuizStudyModal,
  VoiceQuizContentModal,
  VoiceQuizBankModal,
  VoiceQuizNoticeModal,
} from '../modals'
import { WhileToolsModal } from '../modals/WhileToolsModal'
import { SendGridBodyModal } from '../modals/SendGridBodyModal'
import { JsonOptionsModal } from '../modals/JsonOptionsModal'

export function ModalsContainer() {
  return (
    <>
      <WidgetModal />
      <InstructionsModal />
      <ValidationDialog />
      <ModelSettingsModal />
      <ToolsModal />
      <MiniAppModal />
      <WhileToolsModal />
      <JsonSchemaModal />
      <KnowledgeModal />
      <TeamModal />
      <TestModal />
      <TemplateModal mode="save" />
      <TemplateModal mode="load" />
      <SendGridBodyModal />
      <JsonOptionsModal />
      <PstnAdvancedSettingsModal />
      <AcsSetupWizardModal />
      <CalendarAdvancedSettingsModal />
      <CalendarMonthlyPreviewModal />
      <QuizStudyModal />
      <VoiceQuizContentModal />
      <VoiceQuizBankModal />
      <VoiceQuizNoticeModal />
    </>
  )
}
