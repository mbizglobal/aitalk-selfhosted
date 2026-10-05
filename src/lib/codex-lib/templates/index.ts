import { receiptExtractionTemplate } from './receipt-extraction';
import { conditionalApprovalTemplate } from './conditional-approval';
import { textGenerationTemplate } from './text-generation';
import { complexSchemaTemplate } from './complex-schema';
import { WorkflowTemplate } from '../types';

export const allTemplates: WorkflowTemplate[] = [
  receiptExtractionTemplate,
  conditionalApprovalTemplate,
  textGenerationTemplate,
  complexSchemaTemplate,
];

export {
  receiptExtractionTemplate,
  conditionalApprovalTemplate,
  textGenerationTemplate,
  complexSchemaTemplate
};
