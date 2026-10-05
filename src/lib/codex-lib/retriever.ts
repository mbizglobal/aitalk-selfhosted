import { UserRequestAnalysis, WorkflowTemplate } from './types';
import { allTemplates } from './templates';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';

export type TemplateSource = 'local' | 'db';

const CODEX_PATTERNS_DIR = path.join(process.cwd(), 'src/data/codex-patterns');

interface CodexPatternFile {
  templateId: string;
  name: string;
  description: string;
  keywords: string[];
  nodeTypes: string[];
  features: string[];
  explanation: string;
  workflowJson: string;
}

function convertPatternToTemplate(pattern: CodexPatternFile): WorkflowTemplate {
  let nodes: any[] = [];
  let edges: any[] = [];

  try {
    const workflow = JSON.parse(pattern.workflowJson);
    nodes = workflow.nodes || [];
    edges = workflow.edges || [];
  } catch (error) {
    console.error(`Error parsing workflowJson for ${pattern.templateId}:`, error);
  }

  return {
    id: pattern.templateId,
    name: pattern.name,
    description: pattern.description,
    keywords: pattern.keywords,
    nodeTypes: pattern.nodeTypes,
    features: pattern.features,
    example: { nodes, edges },
    explanation: pattern.explanation
  };
}

function getCodexPatterns(): WorkflowTemplate[] {
  if (!fs.existsSync(CODEX_PATTERNS_DIR)) {
    console.warn('Codex patterns directory not found:', CODEX_PATTERNS_DIR);
    return [];
  }

  const files = fs.readdirSync(CODEX_PATTERNS_DIR);
  const patterns: WorkflowTemplate[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }

    try {
      const filePath = path.join(CODEX_PATTERNS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const pattern = JSON.parse(content) as CodexPatternFile;
      patterns.push(convertPatternToTemplate(pattern));
    } catch (error) {
      console.error(`Error reading codex pattern file ${file}:`, error);
    }
  }

  return patterns;
}

async function getTemplatesFromDb(): Promise<WorkflowTemplate[]> {
  try {
    const templates = await prisma.workflowTemplate.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    return templates.map(t => {
      let nodes: any[] = [];
      let edges: any[] = [];

      try {
        const workflow = JSON.parse(t.workflowJson || '{}');
        nodes = workflow.nodes || [];
        edges = workflow.edges || [];
      } catch (error) {
        console.error(`Error parsing workflowJson for ${t.templateId}:`, error);
      }

      return {
        id: t.templateId,
        name: t.name,
        description: t.description,
        keywords: JSON.parse(t.keywords || '[]'),
        nodeTypes: JSON.parse(t.nodeTypes || '[]'),
        features: JSON.parse(t.features || '[]'),
        example: { nodes, edges },
        explanation: t.explanation,
      };
    });
  } catch (error) {
    console.error('Error fetching templates from DB:', error);
    return [];
  }
}

function getTemplatesFromLocal(): WorkflowTemplate[] {
  let codexPatterns: WorkflowTemplate[] = [];
  try {
    codexPatterns = getCodexPatterns();
  } catch (error) {
    console.warn('Codex patterns not available (client-side or error):', error);
  }

  if (codexPatterns.length === 0) {
    console.warn('No codex patterns found, falling back to built-in templates');
    return allTemplates;
  }

  return codexPatterns;
}

export async function getAllTemplates(source: TemplateSource = 'local'): Promise<WorkflowTemplate[]> {
  if (source === 'db') {
    const dbTemplates = await getTemplatesFromDb();
    if (dbTemplates.length === 0) {
      console.warn('No templates in DB, falling back to built-in templates');
      return allTemplates;
    }
    return dbTemplates;
  }

  return getTemplatesFromLocal();
}

export async function retrieveRelevantTemplates(
  analysis: UserRequestAnalysis,
  maxResults: number = 2,
  source: TemplateSource = 'local'
): Promise<WorkflowTemplate[]> {
  const templates = await getAllTemplates(source);

  const scoredTemplates = templates.map(template => {
    let score = 0;

    const keywordMatches = analysis.keywords.filter(keyword =>
      template.keywords.some(tk => tk.toLowerCase().includes(keyword.toLowerCase()))
    );
    score += keywordMatches.length * 10;

    const nodeTypeMatches = analysis.nodeTypes.filter(nodeType =>
      template.nodeTypes.includes(nodeType)
    );
    score += nodeTypeMatches.length * 5;

    const featureMatches = analysis.features.filter(feature =>
      template.features.includes(feature)
    );
    score += featureMatches.length * 8;

    return {
      template,
      score,
      matches: {
        keywords: keywordMatches,
        nodeTypes: nodeTypeMatches,
        features: featureMatches
      }
    };
  });

  return scoredTemplates
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .filter(item => item.score > 0)
    .map(item => item.template);
}

export async function debugTemplateMatching(
  analysis: UserRequestAnalysis,
  source: TemplateSource = 'local'
): Promise<void> {
  console.log('📊 Template Matching Scores:');
  const templates = await getAllTemplates(source);

  templates.forEach(template => {
    let score = 0;
    const matches: string[] = [];

    analysis.keywords.forEach(kw => {
      if (template.keywords.some(tk => tk.toLowerCase().includes(kw.toLowerCase()))) {
        score += 10;
        matches.push(`keyword:${kw}`);
      }
    });

    analysis.nodeTypes.forEach(nt => {
      if (template.nodeTypes.includes(nt)) {
        score += 5;
        matches.push(`nodeType:${nt}`);
      }
    });

    analysis.features.forEach(f => {
      if (template.features.includes(f)) {
        score += 8;
        matches.push(`feature:${f}`);
      }
    });

    console.log(`  ${template.name}: ${score} points`, matches);
  });
}
