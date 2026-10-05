import { Metadata } from 'next'
import AnalyticsClient from './client'

export const metadata: Metadata = {
  title: 'Analytics | AITalk',
}

export default function AnalyticsPage() {
  const websiteUrl = process.env.NEXTAUTH_URL || ''

  return <AnalyticsClient websiteUrl={websiteUrl} />
}
