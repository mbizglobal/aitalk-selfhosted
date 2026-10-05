'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff, Lock, Mail, RefreshCw, Check, AlertCircle, KeyRound, Trash2, Pencil, Plus, Loader2, Monitor, Smartphone } from 'lucide-react'
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

interface PasskeyInfo {
  id: string
  name: string | null
  deviceType: string | null
  backedUp: boolean
  createdAt: string
  lastUsedAt: string | null
}

interface ProfileSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  token: string | null
  member: {
    email: string
    displayName: string | null
    authMethod?: string
  } | null
  lang?: SupportedLang
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  onRequestEmailChange?: (newEmail: string) => Promise<{ success: boolean; error?: string }>
}

type ActiveTab = 'password' | 'email' | 'passkey'

export const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({
  open,
  onOpenChange,
  agentId,
  token,
  member,
  lang,
  onChangePassword,
  onRequestEmailChange
}) => {
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)

  const [activeTab, setActiveTab] = useState<ActiveTab>('password')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [isChangingEmail, setIsChangingEmail] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [emailSuccess, setEmailSuccess] = useState(false)

  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([])
  const [isLoadingPasskeys, setIsLoadingPasskeys] = useState(false)
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false)
  const [passkeyError, setPasskeyError] = useState('')
  const [passkeySuccess, setPasskeySuccess] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isPasskeySupported, setIsPasskeySupported] = useState(true)

  useEffect(() => {
    setIsPasskeySupported(browserSupportsWebAuthn())
  }, [])

  const loadPasskeys = useCallback(async () => {
    if (!token) return

    setIsLoadingPasskeys(true)
    setPasskeyError('')

    try {
      const response = await fetch(`/api/chat/${agentId}/team/passkey`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (!response.ok) {
        throw new Error('패스키 목록을 가져오는데 실패했습니다.')
      }

      const data = await response.json()
      setPasskeys(data.passkeys || [])
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setIsLoadingPasskeys(false)
    }
  }, [agentId, token])

  useEffect(() => {
    if (open && activeTab === 'passkey' && token && member?.authMethod === 'password') {
      loadPasskeys()
    }
  }, [open, activeTab, token, member?.authMethod, loadPasskeys])

  const handleRegisterPasskey = async () => {
    if (!token || !isPasskeySupported) return

    setIsRegisteringPasskey(true)
    setPasskeyError('')
    setPasskeySuccess('')

    try {
      const optionsResponse = await fetch(`/api/chat/${agentId}/team/passkey/register`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (!optionsResponse.ok) {
        const data = await optionsResponse.json()
        throw new Error(data.error || '등록 옵션을 가져오는데 실패했습니다.')
      }

      const options = await optionsResponse.json()

      const regResponse = await startRegistration({ optionsJSON: options })

      const verifyResponse = await fetch(`/api/chat/${agentId}/team/passkey/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          response: regResponse,
          name: passkeyName || undefined
        })
      })

      if (!verifyResponse.ok) {
        const data = await verifyResponse.json()
        throw new Error(data.error || '패스키 등록에 실패했습니다.')
      }

      setPasskeySuccess('패스키가 등록되었습니다.')
      setPasskeyName('')
      setShowRegisterForm(false)
      await loadPasskeys()

      setTimeout(() => setPasskeySuccess(''), 3000)
    } catch (err) {
      console.error('Passkey registration error:', err)
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setPasskeyError('패스키 등록이 취소되었습니다.')
        } else {
          setPasskeyError(err.message || '패스키 등록에 실패했습니다.')
        }
      }
    } finally {
      setIsRegisteringPasskey(false)
    }
  }

  const handleDeletePasskey = async (passkeyId: string) => {
    if (!token) return

    if (!confirm('이 패스키를 삭제하시겠습니까?')) return

    setPasskeyError('')
    setPasskeySuccess('')

    try {
      const response = await fetch(`/api/chat/${agentId}/team/passkey?id=${passkeyId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '패스키 삭제에 실패했습니다.')
      }

      setPasskeySuccess('패스키가 삭제되었습니다.')
      await loadPasskeys()

      setTimeout(() => setPasskeySuccess(''), 3000)
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    }
  }

  const handleUpdatePasskeyName = async (passkeyId: string) => {
    if (!token || !editingName.trim()) return

    setPasskeyError('')

    try {
      const response = await fetch(`/api/chat/${agentId}/team/passkey/${passkeyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: editingName.trim() })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '이름 변경에 실패했습니다.')
      }

      setEditingPasskeyId(null)
      setEditingName('')
      await loadPasskeys()
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '사용 기록 없음'
    return new Date(dateString).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const resetPasswordFields = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError('')
    setPasswordSuccess(false)
  }

  const resetEmailFields = () => {
    setNewEmail('')
    setEmailError('')
    setEmailSuccess(false)
  }

  const resetPasskeyFields = () => {
    setPasskeyError('')
    setPasskeySuccess('')
    setPasskeyName('')
    setShowRegisterForm(false)
    setEditingPasskeyId(null)
    setEditingName('')
  }

  const handleClose = () => {
    resetPasswordFields()
    resetEmailFields()
    resetPasskeyFields()
    onOpenChange(false)
  }

  const handleChangePassword = async () => {
    setPasswordError('')
    setPasswordSuccess(false)

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('모든 필드를 입력해주세요.')
      return
    }

    if (newPassword.length < 8) {
      setPasswordError('새 비밀번호는 최소 8자 이상이어야 합니다.')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('새 비밀번호가 일치하지 않습니다.')
      return
    }

    setIsChangingPassword(true)

    try {
      const result = await onChangePassword(currentPassword, newPassword)
      if (result.success) {
        setPasswordSuccess(true)
        resetPasswordFields()
        setTimeout(() => setPasswordSuccess(false), 3000)
      } else {
        setPasswordError(result.error || '비밀번호 변경에 실패했습니다.')
      }
    } catch {
      setPasswordError('서버 오류가 발생했습니다.')
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleRequestEmailChange = async () => {
    if (!onRequestEmailChange) return

    setEmailError('')
    setEmailSuccess(false)

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!newEmail || !emailRegex.test(newEmail)) {
      setEmailError('유효한 이메일 주소를 입력해주세요.')
      return
    }

    if (newEmail.toLowerCase() === member?.email?.toLowerCase()) {
      setEmailError('현재 이메일과 동일합니다.')
      return
    }

    setIsChangingEmail(true)

    try {
      const result = await onRequestEmailChange(newEmail)
      if (result.success) {
        setEmailSuccess(true)
        setNewEmail('')
      } else {
        setEmailError(result.error || '이메일 변경 요청에 실패했습니다.')
      }
    } catch {
      setEmailError('서버 오류가 발생했습니다.')
    } finally {
      setIsChangingEmail(false)
    }
  }

  const isPasswordAuth = member?.authMethod === 'password'

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md bg-[#1E1E1E] border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{t('team_account_settings')}</DialogTitle>
        </DialogHeader>

        <div className="flex border-b border-gray-700 mb-4 overflow-x-auto">
          {isPasswordAuth && (
            <button
              onClick={() => { setActiveTab('password'); resetEmailFields(); resetPasskeyFields(); }}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'password'
                  ? 'border-[#E07B53] text-[#E07B53]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Lock className="h-4 w-4" />
              {t('team_profile_tab_password')}
            </button>
          )}
          {isPasswordAuth && (
            <button
              onClick={() => { setActiveTab('passkey'); resetPasswordFields(); resetEmailFields(); loadPasskeys(); }}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'passkey'
                  ? 'border-[#E07B53] text-[#E07B53]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <KeyRound className="h-4 w-4" />
              {t('team_profile_tab_passkey')}
            </button>
          )}
          {onRequestEmailChange && (
            <button
              onClick={() => { setActiveTab('email'); resetPasswordFields(); resetPasskeyFields(); loadPasskeys(); }}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'email'
                  ? 'border-[#E07B53] text-[#E07B53]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <Mail className="h-4 w-4" />
              {t('team_profile_tab_email')}
            </button>
          )}
        </div>

        {activeTab === 'password' && isPasswordAuth && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-gray-300">
                {t('team_password_change_current')}
              </Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t('team_password_change_current_placeholder')}
                  disabled={isChangingPassword}
                  className="bg-[#2A2A2A] border-gray-600 text-white pr-10 focus:border-[#E07B53] focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-gray-300">
                {t('team_password_change_new')}
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('team_password_change_new_placeholder')}
                  disabled={isChangingPassword}
                  className="bg-[#2A2A2A] border-gray-600 text-white pr-10 focus:border-[#E07B53] focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-gray-300">
                {t('team_password_change_confirm')}
              </Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('team_password_change_confirm_placeholder')}
                  disabled={isChangingPassword}
                  className={`bg-[#2A2A2A] border-gray-600 text-white pr-10 focus:ring-0 ${
                    confirmPassword && newPassword !== confirmPassword
                      ? 'border-red-500 focus:border-red-500'
                      : 'focus:border-[#E07B53]'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-red-400">{t('team_password_reset_mismatch')}</p>
              )}
            </div>

            {passwordError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {passwordError}
              </div>
            )}
            {passwordSuccess && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
                <Check className="h-4 w-4 flex-shrink-0" />
                {t('team_password_change_success')}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isChangingPassword}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                {t('team_cancel')}
              </Button>
              <Button
                onClick={handleChangePassword}
                disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword}
                className="bg-[#E07B53] hover:bg-[#D06A42] text-white"
              >
                {isChangingPassword ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {t('team_password_reset_changing')}
                  </>
                ) : (
                  t('team_password_change_title')
                )}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'email' && onRequestEmailChange && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-gray-300">{t('team_email_change_current')}</Label>
              <div className="p-3 bg-[#2A2A2A] border border-gray-600 rounded-md text-gray-400">
                {member?.email}
              </div>
            </div>

            {isLoadingPasskeys ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                {t('team_loading')}
              </div>
            ) : passkeys.length > 0 ? (
              <>
                <div className="text-center py-6">
                  <KeyRound className="h-12 w-12 text-yellow-500 mx-auto mb-3" />
                  <p className="text-white font-medium mb-2">{t('team_email_change_cannot')}</p>
                  <p className="text-gray-400 text-sm">
                    {t('team_email_change_passkey_warning')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => { setActiveTab('passkey'); }}
                  className="w-full border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  <KeyRound className="h-4 w-4 mr-2" />
                  {t('team_email_change_go_to_passkey')}
                </Button>
                <div className="flex justify-end pt-2">
                  <Button
                    variant="outline"
                    onClick={handleClose}
                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                  >
                    {t('team_close')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new-email" className="text-gray-300">
                    {t('team_email_change_new')}
                  </Label>
                  <Input
                    id="new-email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder={t('team_email_change_new_placeholder')}
                    disabled={isChangingEmail}
                    className="bg-[#2A2A2A] border-gray-600 text-white focus:border-[#E07B53] focus:ring-0"
                  />
                </div>

                <p className="text-xs text-gray-400">
                  {t('team_email_change_hint')}
                </p>

                {emailError && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {emailError}
                  </div>
                )}
                {emailSuccess && (
                  <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
                    <Check className="h-4 w-4 flex-shrink-0" />
                    {t('team_email_change_sent')}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={handleClose}
                    disabled={isChangingEmail}
                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                  >
                    {t('team_cancel')}
                  </Button>
                  <Button
                    onClick={handleRequestEmailChange}
                    disabled={isChangingEmail || !newEmail}
                    className="bg-[#E07B53] hover:bg-[#D06A42] text-white"
                  >
                    {isChangingEmail ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        {t('team_email_change_sending')}
                      </>
                    ) : (
                      t('team_email_change_send_verification')
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'passkey' && isPasswordAuth && (
          <div className="space-y-4">
            {!isPasskeySupported && (
              <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {t('team_passkey_not_supported')}
              </div>
            )}

            {passkeySuccess && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
                <Check className="h-4 w-4 flex-shrink-0" />
                {passkeySuccess}
              </div>
            )}
            {passkeyError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {passkeyError}
              </div>
            )}

            {showRegisterForm ? (
              <div className="p-4 bg-[#2A2A2A] rounded-lg space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="passkey-name" className="text-gray-300">
                    {t('team_passkey_register_name_label')}
                  </Label>
                  <Input
                    id="passkey-name"
                    value={passkeyName}
                    onChange={(e) => setPasskeyName(e.target.value)}
                    placeholder={t('team_passkey_register_name_placeholder')}
                    disabled={isRegisteringPasskey}
                    className="bg-[#1E1E1E] border-gray-600 text-white focus:border-[#E07B53] focus:ring-0"
                    maxLength={100}
                  />
                  <p className="text-xs text-gray-500">{t('team_passkey_register_name_hint')}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowRegisterForm(false)}
                    disabled={isRegisteringPasskey}
                    className="flex-1 border-gray-600 text-gray-300 hover:bg-gray-700"
                  >
                    {t('team_cancel')}
                  </Button>
                  <Button
                    onClick={handleRegisterPasskey}
                    disabled={isRegisteringPasskey || !isPasskeySupported}
                    className="flex-1 bg-[#E07B53] hover:bg-[#D06A42] text-white"
                  >
                    {isRegisteringPasskey ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t('team_passkey_registering')}
                      </>
                    ) : (
                      <>
                        <KeyRound className="h-4 w-4 mr-2" />
                        {t('team_passkey_register')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => setShowRegisterForm(true)}
                disabled={!isPasskeySupported}
                className="w-full bg-[#E07B53] hover:bg-[#D06A42] text-white"
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('team_passkey_add_new')}
              </Button>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-300">{t('team_passkey_list')}</h3>

              {isLoadingPasskeys ? (
                <div className="flex items-center justify-center py-8 text-gray-400">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  {t('team_loading')}
                </div>
              ) : passkeys.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <KeyRound className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>{t('team_passkey_no_passkeys')}</p>
                  <p className="text-sm mt-1">{t('team_passkey_register_hint')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {passkeys.map((passkey) => (
                    <div
                      key={passkey.id}
                      className="flex items-center gap-3 p-3 bg-[#2A2A2A] rounded-lg"
                    >
                      <div className="flex-shrink-0">
                        {passkey.deviceType === 'singleDevice' ? (
                          <Smartphone className="h-5 w-5 text-gray-400" />
                        ) : (
                          <Monitor className="h-5 w-5 text-gray-400" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {editingPasskeyId === passkey.id ? (
                          <div className="flex gap-2">
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="h-8 bg-[#1E1E1E] border-gray-600 text-white text-sm"
                              autoFocus
                              maxLength={100}
                            />
                            <Button
                              size="sm"
                              onClick={() => handleUpdatePasskeyName(passkey.id)}
                              className="h-8 bg-[#E07B53] hover:bg-[#D06A42]"
                            >
                              {t('team_save')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setEditingPasskeyId(null); setEditingName(''); }}
                              className="h-8 text-gray-400"
                            >
                              {t('team_cancel')}
                            </Button>
                          </div>
                        ) : (
                          <>
                            <p className="text-white text-sm font-medium truncate">
                              {passkey.name || t('team_passkey_no_name')}
                            </p>
                            <p className="text-xs text-gray-500">
                              {t('team_passkey_last_used')}: {formatDate(passkey.lastUsedAt)}
                            </p>
                          </>
                        )}
                      </div>

                      {editingPasskeyId !== passkey.id && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingPasskeyId(passkey.id); setEditingName(passkey.name || ''); }}
                            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700"
                            title={t('team_passkey_rename')}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeletePasskey(passkey.id)}
                            className="p-2 text-gray-400 hover:text-red-400 rounded-lg hover:bg-gray-700"
                            title={t('team_passkey_delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                onClick={handleClose}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                {t('team_close')}
              </Button>
            </div>
          </div>
        )}

        {!isPasswordAuth && activeTab === 'password' && (
          <div className="text-center py-8 text-gray-400">
            <Lock className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t('team_profile_google_message')}</p>
            <p className="text-sm mt-2">{t('team_profile_google_hint')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
