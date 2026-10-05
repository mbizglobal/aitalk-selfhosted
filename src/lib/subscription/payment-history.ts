const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export async function hasEverPaidById(_userId: string): Promise<boolean> {
  return unavailable('Payment history')
}
