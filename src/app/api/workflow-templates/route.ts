
import { findEditionOffParts } from '@/lib/workflow/edition-guard'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getLocalTemplates, getLocalCategories } from '@/lib/local-templates';
import { readStoredBundleVersion } from '@/lib/workflow/bundle-template';
import { describeCaughtError, safeLogToken } from '@/lib/log-mask';
import { VENDOR_DEV_HOSTS } from '@/lib/vendor-site';

const DEV_HOSTS = [...VENDOR_DEV_HOSTS, 'localhost', '127.0.0.1'];

function isDevServer(request: NextRequest): boolean {
  const host = request.headers.get('host') || '';
  return DEV_HOSTS.some(devHost => host.includes(devHost));
}

function parseField(raw: string | null, fallback: string, field: string, templateId: string) {
  try {
    return JSON.parse(raw || fallback);
  } catch (e) {
    console.error(
      `[Templates] JSON parse failed — field=${field} template=${safeLogToken(templateId)}`
    );
    throw e;
  }
}

function includedInEdition(t: { workflowJson: unknown }): boolean {
  return findEditionOffParts(t.workflowJson).length === 0
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const categoryCode = searchParams.get('category');
    const search = searchParams.get('search')?.toLowerCase();

    if (isDevServer(request)) {
      const localTemplates = getLocalTemplates();
      const localCategories = getLocalCategories();

      const categoryMap = new Map(localCategories.map(c => [c.code, c.name]));

      let filtered = localTemplates.map(t => ({
        templateId: t.templateId,
        name: t.name,
        description: t.description,
        categoryCode: t.categoryCode,
        categoryName: categoryMap.get(t.categoryCode) || t.categoryCode,
        complexity: t.complexity,
        keywords: t.keywords,
        nodeTypes: t.nodeTypes,
        features: t.features,
        workflowJson: parseField(t.workflowJson, '{}', 'workflowJson', t.templateId),
        explanation: t.explanation,
        sortOrder: t.sortOrder,
        dataSheetSchema: t.dataSheetSchema,
        bundleVersion: (t as { bundleVersion?: number }).bundleVersion,
      }));

      if (categoryCode) {
        filtered = filtered.filter(t => t.categoryCode === categoryCode);
      }

      if (search) {
        filtered = filtered.filter(t =>
          t.name.toLowerCase().includes(search) ||
          t.description.toLowerCase().includes(search) ||
          t.keywords.some(k => k.toLowerCase().includes(search))
        );
      }

      filtered.sort((a, b) => a.sortOrder - b.sortOrder);

      return NextResponse.json({ templates: filtered.filter(includedInEdition), source: 'local' });
    }

    const where: {
      categoryCode?: string;
      OR?: Array<{
        name?: { contains: string };
        description?: { contains: string };
        keywords?: { contains: string };
      }>;
    } = {};

    if (categoryCode) {
      where.categoryCode = categoryCode;
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
        { keywords: { contains: search } },
      ];
    }

    const templates = await prisma.workflowTemplate.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        category: true,
      },
    });

    const parsed = templates.map((t) => ({
      id: t.id,
      templateId: t.templateId,
      name: t.name,
      description: t.description,
      categoryCode: t.categoryCode,
      categoryName: t.category.name,
      complexity: t.complexity,
      keywords: parseField(t.keywords, '[]', 'keywords', t.templateId),
      nodeTypes: parseField(t.nodeTypes, '[]', 'nodeTypes', t.templateId),
      features: parseField(t.features, '[]', 'features', t.templateId),
      workflowJson: parseField(t.workflowJson, '{}', 'workflowJson', t.templateId),
      explanation: t.explanation,
      isBuiltIn: t.isBuiltIn,
      sortOrder: t.sortOrder,
      bundleVersion: readStoredBundleVersion(t.bundleJson),
    }));

    return NextResponse.json({ templates: parsed.filter(includedInEdition), source: 'database' });
  } catch (error) {
    console.error('Get templates error:', describeCaughtError(error));
    return NextResponse.json(
      { error: 'Failed to get templates' },
      { status: 500 }
    );
  }
}
