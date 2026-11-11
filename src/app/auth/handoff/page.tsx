import type { Metadata } from 'next'
import HandoffClient from './HandoffClient'

export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } }

export default function HandoffPage() {
  return <HandoffClient />
}
