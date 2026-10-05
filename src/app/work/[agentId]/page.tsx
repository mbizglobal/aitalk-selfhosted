import { redirect } from 'next/navigation'

export default async function OldWorkPage({ params, searchParams }: { params: Promise<{ agentId: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { agentId } = await params
  const { lang } = await searchParams
  redirect(`/chat/${encodeURIComponent(agentId)}/app${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`)
}
