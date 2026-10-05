
export interface StepBudget {
  consume(): boolean
  readonly limit: number
}

export function defaultStepLimit(nodeCount: number): number {
  return Math.max(nodeCount * 10, 100)
}

export function rewindLimit(loopToolCount: number): number {
  return Math.max(loopToolCount * 50, 200)
}

export function createStepBudget(limit: number): StepBudget {
  let used = 0
  return {
    limit,
    consume() {
      used += 1
      return used <= limit
    },
  }
}

export function stepBudgetExceededMessage(limit: number): string {
  return `Workflow exceeded the maximum of ${limit} steps and was stopped. The graph most likely contains a cycle.`
}

export function clampMaxIterations(raw: unknown, mode: 'while' | 'forEach'): number {
  const hardMax = mode === 'forEach' ? 1000 : 100
  const fallback = mode === 'forEach' ? 100 : 10

  if (!raw) return fallback

  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(Math.ceil(n), hardMax)
}

export function clampRestoredIteration(raw: unknown, maxIterations: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.floor(n), maxIterations)
}
