import { UserRequestAnalysis } from './types';

export function analyzeUserRequest(userInput: string, existingWorkflow?: any): UserRequestAnalysis {
  const lowerInput = userInput.toLowerCase();

  const keywords: string[] = [];
  const keywordPatterns = [
    { pattern: /영수증|receipt/i, keyword: 'receipt' },
    { pattern: /이미지|image|사진|photo/i, keyword: 'image' },
    { pattern: /날짜|date/i, keyword: 'date' },
    { pattern: /금액|amount|price|cost/i, keyword: 'amount' },
    { pattern: /승인|approval|approve/i, keyword: 'approval' },
    { pattern: /조건|condition|if/i, keyword: 'condition' },
    { pattern: /반복|loop|while|여러|multiple|배치|batch/i, keyword: 'loop' },
    { pattern: /검색|search|찾기|find/i, keyword: 'search' },
    { pattern: /PDF/i, keyword: 'pdf' },
    { pattern: /JSON/i, keyword: 'json' },
  ];

  keywordPatterns.forEach(({ pattern, keyword }) => {
    if (pattern.test(userInput)) {
      keywords.push(keyword);
    }
  });

  const nodeTypes: string[] = ['start'];

  if (keywords.includes('condition') || keywords.includes('approval') || lowerInput.includes('넘으면') || lowerInput.includes('초과')) {
    nodeTypes.push('condition');
  }

  if (keywords.includes('loop') || lowerInput.includes('여러') || lowerInput.includes('배치')) {
    nodeTypes.push('while');
  }

  if (keywords.includes('search') || lowerInput.includes('vector') || lowerInput.includes('파일')) {
    nodeTypes.push('file-search');
  }

  nodeTypes.push('ai');
  nodeTypes.push('end');

  const features: string[] = [];

  if (keywords.includes('image') || keywords.includes('receipt')) {
    features.push('imageInput', 'vision');
  }

  if (keywords.includes('pdf')) {
    features.push('pdfInput');
  }

  if (keywords.includes('json') || lowerInput.includes('추출') || lowerInput.includes('구조화')) {
    features.push('json-output', 'structured-output');
  }

  let intent: 'create' | 'modify' | 'add' = 'create';
  if (existingWorkflow && existingWorkflow.nodes && existingWorkflow.nodes.length > 0) {
    if (lowerInput.includes('추가') || lowerInput.includes('add')) {
      intent = 'add';
    } else {
      intent = 'modify';
    }
  }

  let complexity: 'simple' | 'medium' | 'complex' = 'simple';
  const nodeTypeCount = new Set(nodeTypes).size;
  if (nodeTypeCount > 4 || keywords.includes('loop')) {
    complexity = 'complex';
  } else if (nodeTypeCount > 3 || keywords.includes('condition')) {
    complexity = 'medium';
  }

  return {
    keywords,
    nodeTypes,
    features,
    intent,
    complexity
  };
}
