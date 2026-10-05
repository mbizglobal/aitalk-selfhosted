'use client'

import { useState, useCallback, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Users, User, Plus, RefreshCw, Trash2, AlertCircle, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface TeamMember {
  id: number
  email: string
  displayName: string | null
  authMethod: string
  status: string
  joinedAt: string
  lastSeenAt: string | null
  planSuspendedAt: string | null
}

interface TeamInvitation {
  id: number
  email: string
  status: string
  expiresAt: string | null
  createdAt: string
}

interface ProductionWorkflow {
  workflowId: string
  name: string
}

interface TeamTabProps {
  agentId: string | null
  t: (key: string) => string
}

export default function TeamTab({ agentId, t }: TeamTabProps) {
  // Team members state
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamInvitations, setTeamInvitations] = useState<TeamInvitation[]>([])
  const [isLoadingTeam, setIsLoadingTeam] = useState(false)
  const [teamInviteEmail, setTeamInviteEmail] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  const [resendingId, setResendingId] = useState<number | null>(null)
  const [teamMessage, setTeamMessage] = useState('')
  const [isTeamError, setIsTeamError] = useState(false)

  // Member limit state
  const [memberLimit, setMemberLimit] = useState<number | null>(null)
  const [usedSeats, setUsedSeats] = useState<number | null>(null)
  const seatsFull = memberLimit !== null && usedSeats !== null && usedSeats >= memberLimit

  // Production workflows state
  const [productionWorkflows, setProductionWorkflows] = useState<ProductionWorkflow[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(true)

  // Fetch team members
  const fetchTeamMembers = useCallback(async () => {
    if (!agentId) return
    setIsLoadingTeam(true)
    try {
      const invitationsResponse = await fetch(`/api/agents/${agentId}/team/invitations`)
      if (invitationsResponse.ok) {
        const invitationsData = await invitationsResponse.json()
        // Filter only pending invitations
        const pendingInvitations = (invitationsData.invitations || []).filter(
          (inv: TeamInvitation) => inv.status === 'pending'
        )
        setTeamInvitations(pendingInvitations)
      }

      // Fetch members
      const membersResponse = await fetch(`/api/agents/${agentId}/team/members`)
      if (membersResponse.ok) {
        const membersData = await membersResponse.json()
        setTeamMembers(membersData.members || [])
        setMemberLimit(typeof membersData.memberLimit === 'number' ? membersData.memberLimit : null)
        setUsedSeats(typeof membersData.usedSeats === 'number' ? membersData.usedSeats : null)
      }
    } catch (error) {
      console.error('Failed to fetch team members:', error)
    } finally {
      setIsLoadingTeam(false)
    }
  }, [agentId])

  // Fetch production workflows
  const fetchProductionWorkflows = useCallback(async () => {
    if (!agentId) return
    setIsLoadingWorkflows(true)
    try {
      const response = await fetch(`/api/agents/${agentId}/workflows`)
      if (response.ok) {
        const data = await response.json()
        // Filter only production workflows
        const prodWorkflows = (data.workflows || [])
          .filter((wf: any) => wf.status === 'production')
          .map((wf: any) => ({
            workflowId: wf.workflowId,
            name: wf.name
          }))
        setProductionWorkflows(prodWorkflows)
        // Auto-select if only one workflow
        if (prodWorkflows.length === 1) {
          setSelectedWorkflowId(prodWorkflows[0].workflowId)
        }
      }
    } catch (error) {
      console.error('Failed to fetch workflows:', error)
    } finally {
      setIsLoadingWorkflows(false)
    }
  }, [agentId])

  // Load team members and workflows on mount
  useEffect(() => {
    if (agentId) {
      fetchTeamMembers()
      fetchProductionWorkflows()
    } else {
      setIsLoadingWorkflows(false)
    }
  }, [agentId, fetchTeamMembers, fetchProductionWorkflows])

  const handleInviteTeamMember = async () => {
    if (!agentId || !teamInviteEmail.trim()) return

    // Check if production workflow exists
    if (productionWorkflows.length === 0) {
      setTeamMessage(t('settings_team_no_production_workflow') || 'Please create and publish a workflow first')
      setIsTeamError(true)
      setTimeout(() => setTeamMessage(''), 5000)
      return
    }

    // Check if workflow is selected (for multiple workflows)
    if (productionWorkflows.length > 1 && !selectedWorkflowId) {
      setTeamMessage(t('settings_team_select_workflow') || 'Please select a workflow')
      setIsTeamError(true)
      setTimeout(() => setTeamMessage(''), 3000)
      return
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(teamInviteEmail.trim())) {
      setTeamMessage(t('settings_team_invalid_email') || 'Invalid email format')
      setIsTeamError(true)
      setTimeout(() => setTeamMessage(''), 3000)
      return
    }

    setIsInviting(true)
    setTeamMessage('')
    setIsTeamError(false)

    // Determine workflowId to send
    const workflowIdToSend = productionWorkflows.length === 1
      ? productionWorkflows[0].workflowId
      : selectedWorkflowId

    try {
      const response = await fetch(`/api/agents/${agentId}/team/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: teamInviteEmail.trim(),
          workflowId: workflowIdToSend
        })
      })

      const result = await response.json()

      if (response.ok) {
        const failed = result.emailSent === false
        setTeamMessage(failed
          ? (t('settings_team_invite_email_failed') || 'Invitation saved, but the email could not be sent. Try "Resend".')
          : (t('settings_team_invite_sent') || 'Invitation sent successfully'))
        setIsTeamError(failed)
        setTeamInviteEmail('')
        fetchTeamMembers()
      } else {
        setTeamMessage(result.error || t('settings_team_invite_failed') || 'Failed to send invitation')
        setIsTeamError(true)
      }
    } catch (error) {
      setTeamMessage(t('settings_team_invite_failed') || 'Failed to send invitation')
      setIsTeamError(true)
    } finally {
      setIsInviting(false)
      setTimeout(() => setTeamMessage(''), 5000)
    }
  }

  const handleRemoveTeamMember = async (memberId: number) => {
    if (!agentId) return
    if (!confirm(t('settings_team_remove_confirm') || 'Are you sure you want to remove this member?')) return

    try {
      const response = await fetch(`/api/agents/${agentId}/team/members?id=${memberId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        setTeamMessage(t('settings_team_member_removed') || 'Member removed successfully')
        setIsTeamError(false)
        fetchTeamMembers()
      } else {
        const result = await response.json()
        setTeamMessage(result.error || t('settings_team_remove_failed') || 'Failed to remove member')
        setIsTeamError(true)
      }
    } catch (error) {
      setTeamMessage(t('settings_team_remove_failed') || 'Failed to remove member')
      setIsTeamError(true)
    }
    setTimeout(() => setTeamMessage(''), 3000)
  }

  const handleRevokeInvitation = async (invitationId: number) => {
    if (!agentId) return
    if (!confirm(t('settings_team_revoke_confirm') || 'Are you sure you want to revoke this invitation?')) return

    try {
      const response = await fetch(`/api/agents/${agentId}/team/invitations?id=${invitationId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        setTeamMessage(t('settings_team_invitation_revoked') || 'Invitation revoked successfully')
        setIsTeamError(false)
        fetchTeamMembers()
      } else {
        const result = await response.json()
        setTeamMessage(result.error || t('settings_team_revoke_failed') || 'Failed to revoke invitation')
        setIsTeamError(true)
      }
    } catch (error) {
      setTeamMessage(t('settings_team_revoke_failed') || 'Failed to revoke invitation')
      setIsTeamError(true)
    }
    setTimeout(() => setTeamMessage(''), 3000)
  }

  const handleResendInvitation = async (email: string, invitationId: number) => {
    if (!agentId || resendingId !== null) return

    // Check if production workflow exists
    if (productionWorkflows.length === 0) {
      setTeamMessage(t('settings_team_no_production_workflow') || 'Please create and publish a workflow first')
      setIsTeamError(true)
      setTimeout(() => setTeamMessage(''), 5000)
      return
    }

    // Determine workflowId to send
    const workflowIdToSend = productionWorkflows.length === 1
      ? productionWorkflows[0].workflowId
      : selectedWorkflowId || productionWorkflows[0].workflowId

    setResendingId(invitationId)

    try {
      const response = await fetch(`/api/agents/${agentId}/team/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, workflowId: workflowIdToSend })
      })

      if (response.ok) {
        const result = await response.json()
        const failed = result.emailSent === false
        setTeamMessage(failed
          ? (t('settings_team_invite_email_failed') || 'Invitation saved, but the email could not be sent. Try "Resend".')
          : (t('settings_team_invite_resent') || 'Invitation resent successfully'))
        setIsTeamError(failed)
        fetchTeamMembers()
      } else {
        const result = await response.json()
        setTeamMessage(result.error || t('settings_team_resend_failed') || 'Failed to resend invitation')
        setIsTeamError(true)
      }
    } catch (error) {
      setTeamMessage(t('settings_team_resend_failed') || 'Failed to resend invitation')
      setIsTeamError(true)
    } finally {
      setResendingId(null)
    }
    setTimeout(() => setTeamMessage(''), 3000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          {t('settings_team_members_title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Initial Loading State */}
        {isLoadingWorkflows ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">{t('loading') || 'Loading...'}</span>
          </div>
        ) : (
          <>
        {/* Team Members Description with Limit Info */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {t('settings_team_members_description')}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t('settings_team_member_count') || 'Members'}:
            </span>
            <Badge variant={seatsFull ? 'destructive' : 'secondary'} className="text-xs font-medium">
              {usedSeats ?? '–'}/{memberLimit ?? '–'}
            </Badge>
          </div>
        </div>

        {/* Message Display */}
        {teamMessage && (
          <div className={`p-3 rounded-lg text-sm ${isTeamError ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-400' : 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/20 dark:border-green-800 dark:text-green-400'}`}>
            {teamMessage}
          </div>
        )}

        {/* Member Limit Warning */}
        {seatsFull && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-700">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                {t('settings_team_limit_reached_title') || 'Member Limit Reached'}
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                {t('settings_team_limit_reached_description') || 'Upgrade your plan to add more team members.'}
              </p>
            </div>
          </div>
        )}

        {/* No Production Workflow Warning */}
        {productionWorkflows.length === 0 && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/50 dark:border-amber-700">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-300 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {t('settings_team_no_workflow_title') || 'No Published Workflow'}
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                {t('settings_team_no_workflow_description_1') || 'Create a workflow in'}{' '}
                <Link
                  href="/app/workflows"
                  className="inline-flex items-center gap-1 font-medium text-amber-800 dark:text-amber-100 underline underline-offset-2 hover:text-amber-900 dark:hover:text-white"
                >
                  {t('settings_team_workflows_link') || 'Workflows'}
                  <ExternalLink className="h-3 w-3" />
                </Link>
                {' '}{t('settings_team_no_workflow_description_2') || 'and set its status to "Active" to invite team members.'}
              </p>
            </div>
          </div>
        )}

        {/* Invite Form */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-3">
              {/* Workflow Selection (only if multiple production workflows) */}
              {productionWorkflows.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-muted-foreground">
                    {t('settings_team_select_workflow_label') || 'Select initial workflow'}
                  </label>
                  <Select
                    value={selectedWorkflowId}
                    onValueChange={setSelectedWorkflowId}
                    disabled={isInviting}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('settings_team_workflow_placeholder') || 'Choose a workflow...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {productionWorkflows.map((wf) => (
                        <SelectItem key={wf.workflowId} value={wf.workflowId}>
                          {wf.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Single workflow indicator */}
              {productionWorkflows.length === 1 && (
                <div className="text-sm text-muted-foreground">
                  {t('settings_team_using_workflow') || 'Using workflow'}: <span className="font-medium">{productionWorkflows[0].name}</span>
                </div>
              )}

              {/* Email and Invite Button */}
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  type="email"
                  placeholder={t('settings_team_email_placeholder') || 'Enter email address'}
                  value={teamInviteEmail}
                  onChange={(e) => setTeamInviteEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleInviteTeamMember()
                    }
                  }}
                  disabled={isInviting || productionWorkflows.length === 0 || seatsFull}
                  className="flex-1"
                />
                <Button
                  onClick={handleInviteTeamMember}
                  disabled={
                    isInviting ||
                    !teamInviteEmail.trim() ||
                    productionWorkflows.length === 0 ||
                    (productionWorkflows.length > 1 && !selectedWorkflowId) ||
                    seatsFull
                  }
                  size="default"
                >
                  {isInviting ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  {t('settings_team_members_invite_btn')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading State */}
        {isLoadingTeam && (
          <div className="flex items-center justify-center py-4">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">{t('loading') || 'Loading...'}</span>
          </div>
        )}

        {/* Members List */}
        {!isLoadingTeam && teamMembers.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                {t('settings_team_members_list') || 'Team Members'} ({teamMembers.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {teamMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{member.displayName || member.email}</p>
                      {member.displayName && (
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={member.status === 'active' ? 'default' : member.planSuspendedAt ? 'destructive' : 'secondary'}
                      className="text-xs"
                      title={member.status !== 'active' && member.planSuspendedAt
                        ? (t('settings_team_plan_suspended_hint') || 'Suspended because the plan limit was exceeded. Upgrade to restore automatically.')
                        : undefined}
                    >
                      {member.status !== 'active' && member.planSuspendedAt
                        ? (t('settings_team_plan_suspended') || 'plan limit')
                        : member.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveTeamMember(member.id)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Pending Invitations */}
        {!isLoadingTeam && teamInvitations.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                {t('settings_team_pending_invitations') || 'Pending Invitations'} ({teamInvitations.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {teamInvitations.map((invitation) => (
                <div key={invitation.id} className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center">
                      <RefreshCw className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{invitation.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('settings_team_invited') || 'Invited'}: {new Date(invitation.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleResendInvitation(invitation.email, invitation.id)}
                      disabled={resendingId !== null}
                      className="h-8 px-2 text-xs"
                    >
                      {t('settings_team_resend') || 'Resend'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeInvitation(invitation.id)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!isLoadingTeam && teamMembers.length === 0 && teamInvitations.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="pt-6 pb-6 text-center">
              <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {t('settings_team_no_members') || 'No team members yet. Invite someone to get started!'}
              </p>
            </CardContent>
          </Card>
        )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
