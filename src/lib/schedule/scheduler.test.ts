
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { prisma } from '@/lib/prisma'
import { createSchedule } from './scheduler'

const model = prisma.workflowSchedule as any
const originalCreate = model.create

function captureCreate() {
  const calls: any[] = []
  model.create = async (args: any) => {
    calls.push(args)
    return { id: 'sched-1' }
  }
  return calls
}

afterEach(() => {
  model.create = originalCreate
})

describe('createSchedule: enabled is decided by the caller', () => {
  it('🔴 creating with enabled:false stores a disabled row (regression guard for the old hardcoded true)', async () => {
    const calls = captureCreate()

    await createSchedule('wf_x', 'agent_x', '0 9 * * *', 'Europe/Zurich', false)

    assert.equal(calls.length, 1)
    assert.equal(
      calls[0].data.enabled,
      false,
      '끈 채 저장한 스케줄이 켜진 행으로 저장되면 스케줄러가 실행한다',
    )
  })

  it('enabled:true is stored as an enabled row; the value used by the workflow save path (applyScheduleDirective)', async () => {
    const calls = captureCreate()

    await createSchedule('wf_y', 'agent_y', '0 9 * * *', 'Europe/Zurich', true)

    assert.equal(calls[0].data.enabled, true)
  })

  it('workflowId, agentId, cron and timezone are also carried in argument order', async () => {
    const calls = captureCreate()

    await createSchedule('wf_z', 'agent_z', '30 6 * * 1', 'Asia/Seoul', true)

    const { workflowId, agentId, cronExpression, timezone } = calls[0].data
    assert.deepEqual(
      { workflowId, agentId, cronExpression, timezone },
      { workflowId: 'wf_z', agentId: 'agent_z', cronExpression: '30 6 * * 1', timezone: 'Asia/Seoul' },
      '인자 순서가 밀리면 enabled 자리에 timezone 이 들어가는 식으로 조용히 어긋난다',
    )
  })
})
