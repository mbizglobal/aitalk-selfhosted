import React, { useState } from 'react'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  X,
  Plus,
  Users,
  User,
  Mail,
  Shield,
  Settings,
  Trash2,
  UserPlus,
  Bot,
  GripHorizontal
} from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'

interface TeamMember {
  id: string
  name: string
  email: string
  role: 'admin' | 'editor' | 'viewer'
  avatar?: string
}

export const TeamModal: React.FC = () => {
  const { ui, agent } = useWorkflowContext()
  const [activeTab, setActiveTab] = useState('members')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [selectedRole, setSelectedRole] = useState<'admin' | 'editor' | 'viewer'>('viewer')
  const [inviteList, setInviteList] = useState<string[]>([])

  const handleInviteMember = () => {
    if (newMemberEmail && !inviteList.includes(newMemberEmail)) {
      setInviteList([...inviteList, newMemberEmail])
      agent.setTeamMembers([...agent.teamMembers, newMemberEmail])
      setNewMemberEmail('')
    }
  }

  const handleRemoveMember = (email: string) => {
    setInviteList(inviteList.filter(e => e !== email))
    agent.setTeamMembers(agent.teamMembers.filter(m => m !== email))
  }

  const handleAddAgent = (agentId: string, agentName: string) => {
    const newAgent = { id: agentId, name: agentName }
    if (!agent.teamAgents.some(a => a.id === agentId)) {
      agent.setTeamAgents([...agent.teamAgents, newAgent])
    }
  }

  const handleRemoveAgent = (agentId: string) => {
    agent.setTeamAgents(agent.teamAgents.filter(a => a.id !== agentId))
  }

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showTeamModal })

  if (!ui.showTeamModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => e.stopPropagation()}>
      <div className="w-[600px] max-h-[80vh] bg-white rounded-lg shadow-lg overflow-hidden" style={dragStyle}>
        <div
          className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-400" />
            <h2 className="text-lg font-semibold">팀 설정</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => ui.setShowTeamModal(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto scrollbar-thin max-h-[60vh]">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="members" className="flex-1">
                <Users className="w-4 h-4 mr-2" />
                팀 멤버
              </TabsTrigger>
              <TabsTrigger value="agents" className="flex-1">
                <Bot className="w-4 h-4 mr-2" />
                팀 Agents
              </TabsTrigger>
              <TabsTrigger value="permissions" className="flex-1">
                <Shield className="w-4 h-4 mr-2" />
                권한 설정
              </TabsTrigger>
            </TabsList>

            {/* Members Tab */}
            <TabsContent value="members" className="space-y-4 mt-4">
              {/* Widget Type */}
              <div>
                <Label>위젯 접근 권한</Label>
                <select
                  className="w-full mt-2 p-2 border rounded"
                  value={agent.accessMode}
                  onChange={(e) => agent.setAccessMode(e.target.value as 'public' | 'team')}
                >
                  <option value="public">공개 - 누구나 접근 가능</option>
                  <option value="team">팀 전용 - 팀 멤버만 접근 가능</option>
                </select>
              </div>

              {agent.accessMode === 'team' && (
                <>
                  {/* Invite Member */}
                  <div>
                    <Label>팀 멤버 초대</Label>
                    <div className="flex gap-2 mt-2">
                      <Input
                        type="email"
                        value={newMemberEmail}
                        onChange={(e) => setNewMemberEmail(e.target.value)}
                        placeholder="이메일 주소"
                      />
                      <select
                        className="px-3 py-2 border rounded"
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value as any)}
                      >
                        <option value="viewer">뷰어</option>
                        <option value="editor">편집자</option>
                        <option value="admin">관리자</option>
                      </select>
                      <Button onClick={handleInviteMember}>
                        <UserPlus className="w-4 h-4 mr-1" />
                        초대
                      </Button>
                    </div>
                  </div>

                  {/* Members List */}
                  {agent.teamMembers.length > 0 && (
                    <div className="space-y-2">
                      <Label>팀 멤버 ({agent.teamMembers.length}명)</Label>
                      {agent.teamMembers.map((member, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                              <User className="w-4 h-4 text-gray-600" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{member}</p>
                              <p className="text-xs text-gray-500">뷰어</p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMember(member)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Pending Invites */}
                  {inviteList.length > 0 && (
                    <div className="space-y-2">
                      <Label>대기 중인 초대 ({inviteList.length})</Label>
                      {inviteList.map((email, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2 bg-yellow-50 rounded">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-yellow-600" />
                            <span className="text-sm">{email}</span>
                            <span className="text-xs text-yellow-600">초대 대기중</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMember(email)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* Agents Tab */}
            <TabsContent value="agents" className="space-y-4 mt-4">
              <div>
                <Label>팀 Agents</Label>
                <p className="text-sm text-gray-600 mt-1">
                  팀 멤버가 액세스할 수 있는 Agent를 선택하세요.
                </p>
              </div>

              {/* Add Agent Button */}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleAddAgent(`agent-${Date.now()}`, `New Agent ${agent.teamAgents.length + 1}`)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Agent 추가
              </Button>

              {/* Agents List */}
              {agent.teamAgents.length > 0 && (
                <div className="space-y-2">
                  {agent.teamAgents.map((teamAgent) => (
                    <div key={teamAgent.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                      <div className="flex items-center gap-3">
                        <Bot className="w-5 h-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium">{teamAgent.name}</p>
                          <p className="text-xs text-gray-500">ID: {teamAgent.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm">
                          <Settings className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveAgent(teamAgent.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Permissions Tab */}
            <TabsContent value="permissions" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <Label>권한 설정</Label>
                  <p className="text-sm text-gray-600 mt-1">
                    팀 멤버의 권한을 관리합니다.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="p-3 border rounded">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">관리자</p>
                        <p className="text-sm text-gray-600">
                          모든 설정 변경 및 멤버 관리 가능
                        </p>
                      </div>
                      <Shield className="w-5 h-5 text-red-500" />
                    </div>
                  </div>

                  <div className="p-3 border rounded">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">편집자</p>
                        <p className="text-sm text-gray-600">
                          Agent 수정 및 테스트 가능
                        </p>
                      </div>
                      <Shield className="w-5 h-5 text-yellow-500" />
                    </div>
                  </div>

                  <div className="p-3 border rounded">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">뷰어</p>
                        <p className="text-sm text-gray-600">
                          읽기 전용, 채팅 사용 가능
                        </p>
                      </div>
                      <Shield className="w-5 h-5 text-green-500" />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Footer */}
        <div className="flex justify-between px-6 py-4 border-t bg-gray-50">
          <Button
            variant="outline"
            onClick={() => ui.setShowTeamModal(false)}
          >
            취소
          </Button>
          <Button
            onClick={() => {
              // Save logic here
              ui.setShowTeamModal(false)
            }}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}