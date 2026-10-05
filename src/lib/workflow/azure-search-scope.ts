

export function managedIndexName(regionId: string): string {
  return `managed-${regionId.replace(/[^a-z0-9-]/gi, '').toLowerCase()}`
}
