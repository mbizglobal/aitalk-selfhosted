
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function WorkflowsPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const redirectToWorkflows = async () => {
      const activeAgentId = localStorage.getItem('activeAgentId')

      if (activeAgentId) {
        router.replace(`/app/agents/${activeAgentId}/workflows`)
        return
      }

      try {
        const response = await fetch('/api/agents')
        const data = await response.json()

        if (data.success && data.agents?.length > 0) {
          const firstAgentId = data.agents[0].agentId
          localStorage.setItem('activeAgentId', firstAgentId)
          router.replace(`/app/agents/${firstAgentId}/workflows`)
        } else {
          router.replace('/app')
        }
      } catch (error) {
        console.error('Failed to fetch agents:', error)
        router.replace('/app')
      }
    }

    redirectToWorkflows()
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}
