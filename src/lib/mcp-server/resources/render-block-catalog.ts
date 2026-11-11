import { blocksForEdition, COMPUTED_BLOCKS, SPEC_LIMITS, SPEC_STORED_KINDS } from '@/lib/work/assembled'

const KINDS = [...SPEC_STORED_KINDS, 'computed'] as const

export function blockCatalogData() {
  return {
    blocks: blocksForEdition().filter((b) => b.available).map((b) => ({ id: b.id, field: b.field, about: b.about })),
    columnKinds: [...KINDS],
    computedBlocks: [...COMPUTED_BLOCKS],
    limits: { ...SPEC_LIMITS },
  }
}

export function renderBlockCatalog(): string {
  const d = blockCatalogData()
  const lines = [
    '# AiTalk Assembled App — Block Catalog',
    '',
    'Version: 1 · Rendered from the same source the server validates against. How to assemble: aitalk://work-app-guide.',
    '',
    '## Blocks',
    '',
    ...d.blocks.flatMap((b) => [`### ${b.id}`, '', `Field: ${b.field ? `\`${b.field}\`` : '(always on)'}`, '', b.about, '']),
    '## Column kinds',
    '',
    d.columnKinds.map((k) => `\`${k}\``).join(' · '),
    '',
    `Computed blocks: ${d.computedBlocks.map((k) => `\`${k}\``).join(' · ')}`,
    '',
    '## Limits',
    '',
    ...Object.entries(d.limits).map(([k, v]) => `- ${k}: ${v}`),
    '',
  ]
  return lines.join('\n')
}
