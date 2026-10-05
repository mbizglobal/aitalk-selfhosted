export interface ResolvedPartner {
  id: string
  code: string
  country: string
}
export async function resolveActivePartner(_code: string): Promise<ResolvedPartner | null> {
  return null
}
