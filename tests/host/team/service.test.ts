// tests/host/team/service.test.ts
//
// 官方 Agent Team 服务解析与成员查找单测：
//   - 能力守卫：三能力（创建/清单/投递）齐全才算可用；缺任一返回 null（调用方据此回退）；
//   - 成员查找：按名字命中，不把 Lead 伪行当作可复用成员。

import { describe, expect, it, vi } from 'vitest'
import { agentTeamsServiceLike, findMemberByName } from '../../../src/host/team/service.js'
import type { TeamMemberViewLike } from '../../../src/host/team/types.js'

/** 最小 ctx fake（只消费 get）。 */
function ctxWith(value: unknown): { get(name: string): unknown } {
  return { get: (name: string) => (name === 'agentTeams' ? value : undefined) }
}

function fullService(): Record<string, unknown> {
  return { spawnTeammate: vi.fn(), listMembers: vi.fn(() => []), sendMessage: vi.fn() }
}

describe('agentTeamsServiceLike', () => {
  it('三能力齐全：返回收窄后的服务', () => {
    const service = fullService()
    expect(agentTeamsServiceLike(ctxWith(service))).toBe(service)
  })

  it('服务未挂载 / 非对象：返回 null', () => {
    expect(agentTeamsServiceLike(ctxWith(undefined))).toBeNull()
    expect(agentTeamsServiceLike(ctxWith(null))).toBeNull()
    expect(agentTeamsServiceLike(ctxWith('agentTeams'))).toBeNull()
  })

  it('能力不全（缺投递）：返回 null，由调用方回退逐节点路径', () => {
    const missingSend = { spawnTeammate: vi.fn(), listMembers: vi.fn(() => []) }
    expect(agentTeamsServiceLike(ctxWith(missingSend))).toBeNull()
    const missingSpawn = { listMembers: vi.fn(() => []), sendMessage: vi.fn() }
    expect(agentTeamsServiceLike(ctxWith(missingSpawn))).toBeNull()
  })
})

describe('findMemberByName', () => {
  const members: TeamMemberViewLike[] = [
    { id: 'root', name: 'lead', role: 'lead', status: 'running' },
    { id: 'c1', name: 'm-n-req', role: 'teammate', status: 'inactive' },
  ]

  it('按名字命中成员；不存在返回 undefined', () => {
    expect(findMemberByName(members, 'm-n-req')?.id).toBe('c1')
    expect(findMemberByName(members, 'm-n-missing')).toBeUndefined()
  })

  it('清单缺失或非数组：返回 undefined（不抛错）', () => {
    expect(findMemberByName(undefined, 'm-n-req')).toBeUndefined()
    expect(findMemberByName(null as unknown as TeamMemberViewLike[], 'm-n-req')).toBeUndefined()
  })
})
