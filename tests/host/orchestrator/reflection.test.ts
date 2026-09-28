// tests/host/orchestrator/reflection.test.ts
//
// 运行终态「复盘指令」注入单测（runtime-reflection + 两个结束点）：
// 事实派生纯函数、wfFinish（completed/failed）与 terminateRun（stopped）注入一次、
// suspendRun（paused）不注入、同一 runId 幂等、根代理缺失只告警不抛错。
// 装配与测试替身见 fixtures/harness.ts（共享，不在本文件内重复）。

import { afterEach, describe, expect, it } from 'vitest'
import {
  injectReflection,
  reflectionFactsOf,
  type InjectReflectionInput,
  type ReflectionInjectionEnv,
} from '../../../src/host/orchestrator/index.js'
import { REFLECTION_MARKER } from '../../../src/host/prompts/index.js'
import { FakeRoot, cleanupTempDirs, makeFlow, makeHarness, caller, start, type Harness } from './fixtures/harness.js'

// 临时目录：makeHarness 登记，文件结束统一清理
afterEach(cleanupTempDirs)

/** 取注入到父代理的复盘指令文本（steer 插队优先，否则 followupRoot 唤醒通道）。 */
function injectedReflection(h: Harness): string {
  const root = h.agents.roots.get('session-1')!
  const steered = root.steered.find((message) => message.content?.[0]?.text.includes(REFLECTION_MARKER))
  if (steered) return steered.content.map((block) => block.text).join('\n')
  const messages = root.messages.filter((message) => message.content[0]?.text.includes(REFLECTION_MARKER))
  return messages.map((message) => message.content.map((block) => block.text).join('\n')).join('\n')
}

/** 注入到父代理的复盘指令条数。 */
function reflectionCount(h: Harness): number {
  const root = h.agents.roots.get('session-1')!
  const steered = root.steered.filter((message) => message.content?.[0]?.text.includes(REFLECTION_MARKER)).length
  const followed = root.messages.filter((message) => message.content[0]?.text.includes(REFLECTION_MARKER)).length
  return steered + followed
}

describe('reflectionFactsOf（事实派生纯函数）', () => {
  it('三种终态派生成功，耗时按毫秒差计算', () => {
    const base = {
      runId: 'run-1',
      flowName: '测试流程',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:02:05.400Z',
      nodeCount: 6,
    }
    expect(reflectionFactsOf({ ...base, status: 'completed' })).toMatchObject({ status: 'completed', durationMs: 125_400, nodeCount: 6 })
    expect(reflectionFactsOf({ ...base, status: 'failed' })).toMatchObject({ status: 'failed' })
    expect(reflectionFactsOf({ ...base, status: 'stopped' })).toMatchObject({ status: 'stopped' })
  })

  it('非注入态（running/paused/interrupted）返回 null', () => {
    const base = {
      runId: 'run-1',
      flowName: '测试流程',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      nodeCount: 1,
    }
    expect(reflectionFactsOf({ ...base, status: 'running' })).toBeNull()
    expect(reflectionFactsOf({ ...base, status: 'paused' })).toBeNull()
    expect(reflectionFactsOf({ ...base, status: 'interrupted' })).toBeNull()
  })

  it('时间戳缺失/不可解析 → durationMs 为 null；节点数为负或非法 → 归零', () => {
    expect(reflectionFactsOf({ runId: 'r', flowName: 'f', status: 'completed', startedAt: null, endedAt: null, nodeCount: 3 })?.durationMs).toBeNull()
    expect(reflectionFactsOf({ runId: 'r', flowName: 'f', status: 'completed', startedAt: 'bad', endedAt: 'also-bad', nodeCount: 3 })?.durationMs).toBeNull()
    expect(reflectionFactsOf({ runId: 'r', flowName: 'f', status: 'completed', startedAt: null, endedAt: null, nodeCount: -2 })?.nodeCount).toBe(0)
  })

  it('systemLanguage 缺省为空串（提示词按中文措辞）', () => {
    const facts = reflectionFactsOf({ runId: 'r', flowName: 'f', status: 'completed', startedAt: null, endedAt: null, nodeCount: 1 })
    expect(facts?.systemLanguage).toBe('')
  })
})

describe('injectReflection（注入缝）', () => {
  /** 注入缝 fake：可控根代理与注入失败（复用 harness 的 FakeRoot 作为父代理替身）。 */
  function makeEnv(options: { rootMissing?: boolean; rootRunning?: boolean; followupFail?: unknown } = {}) {
    const root = options.rootMissing ? null : new FakeRoot('session-1')
    if (root && options.rootRunning) root.status = 'running'
    const warnings: string[] = []
    const followed: Array<{ id: string; text: string }> = []
    const env: ReflectionInjectionEnv = {
      logger: { warn: (message) => warnings.push(message), info: () => {}, debug: () => {} },
      systemLanguage: () => '中文',
      getRootAgent: () => root,
      followupRoot: (_agent, message) => {
        if (options.followupFail) throw options.followupFail
        followed.push({ id: message.id, text: message.content.map((block) => block.text).join('\n') })
      },
      uuid: () => 'uuid-1',
      warnPrefix: '[visual-workflow] 复盘指令注入：',
    }
    return { env, root, followed, warnings }
  }

  const input: InjectReflectionInput = {
    facts: { runId: 'run-1', flowName: '测试流程', status: 'completed', durationMs: 1000, nodeCount: 2, systemLanguage: '中文' },
    sessionId: 'session-1',
    runId: 'run-1',
  }

  it('父代理空闲：走 followupRoot 唤醒，文本含复盘标记', () => {
    const { env, followed } = makeEnv()
    expect(injectReflection(env, input)).toBe(true)
    expect(followed).toHaveLength(1)
    expect(followed[0].text).toContain(REFLECTION_MARKER)
    expect(followed[0].id).toBe('uuid-1')
  })

  it('父代理忙碌且具备 steer：走插队通道（不重复 followup）', () => {
    const { env, root, followed } = makeEnv({ rootRunning: true })
    expect(injectReflection(env, input)).toBe(true)
    expect(root!.steered).toHaveLength(1)
    expect(root!.steered[0].content[0].text).toContain(REFLECTION_MARKER)
    expect(followed).toHaveLength(0)
  })

  it('根代理不存在：只告警并返回 false，不抛出', () => {
    const { env, warnings, followed } = makeEnv({ rootMissing: true })
    expect(injectReflection(env, input)).toBe(false)
    expect(followed).toHaveLength(0)
    expect(warnings.some((message) => message.includes('父代理未激活'))).toBe(true)
  })

  it('注入通道抛错：只告警并返回 false，不向外抛', () => {
    const { env, warnings } = makeEnv({ followupFail: new Error('通道不可用') })
    expect(injectReflection(env, input)).toBe(false)
    expect(warnings.some((message) => message.includes('注入失败'))).toBe(true)
  })
})

describe('终态注入（wfFinish / terminateRun）', () => {
  it('wfFinish completed：注入一次，文本含三项机器事实', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    h.clock.now += 4000

    await h.runtime.wfFinish(caller, { summary: '全部完成' })

    expect(entry.snapshot.status).toBe('completed')
    expect(reflectionCount(h)).toBe(1)
    const text = injectedReflection(h)
    expect(text).toContain(REFLECTION_MARKER)
    expect(text).toContain('- run 状态：已完成')
    expect(text).toContain('- 总耗时：4.0 秒')
    expect(text).toContain('- 节点总数：6')
  })

  it('wfFinish failed：注入文本状态为失败', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())

    await h.runtime.wfFinish(caller, { summary: '无法继续', status: 'failed' })

    expect(entry.snapshot.status).toBe('failed')
    expect(reflectionCount(h)).toBe(1)
    expect(injectedReflection(h)).toContain('- run 状态：失败')
  })

  it('terminateRun stopped：注入一次，文本状态为已停止', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    h.clock.now += 2000

    const terminated = await h.runtime.terminateRun(entry, { status: 'stopped', summary: '用户停止' })

    expect(terminated).toBe(true)
    expect(entry.snapshot.status).toBe('stopped')
    expect(reflectionCount(h)).toBe(1)
    const text = injectedReflection(h)
    expect(text).toContain('- run 状态：已停止')
    expect(text).toContain('- 总耗时：2.0 秒')
  })

  it('terminateRun 重复调用：只注入一次（内存条目已释放）', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())

    await h.runtime.terminateRun(entry, { status: 'stopped', summary: '用户停止' })
    expect(await h.runtime.terminateRun(entry, { status: 'stopped', summary: '再次停止' })).toBe(false)

    expect(reflectionCount(h)).toBe(1)
  })

  it('suspendRun（paused）不注入：续跑结束的终态才注入', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())

    expect(await h.runtime.suspendRun(entry.snapshot.id)).toBe(true)

    expect(entry.snapshot.status).toBe('paused')
    expect(reflectionCount(h)).toBe(0)
  })

  it('paused 期间重复终态化不注入，续跑后的终态注入一次', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    await h.runtime.suspendRun(entry.snapshot.id)

    // paused 状态下 terminateRun 仍可终止（stopped），此时才注入复盘
    await h.runtime.terminateRun(entry, { status: 'stopped', summary: '停止' })
    expect(reflectionCount(h)).toBe(1)
  })

  it('根代理缺失：只告警不抛错，收尾与内存释放照常完成', async () => {
    const h = await makeHarness()
    const { entry } = await start(h, makeFlow())
    h.agents.roots.delete('session-1')

    await expect(h.runtime.wfFinish(caller, { summary: '完成' })).resolves.toMatchObject({ ok: true, status: 'completed' })

    expect(entry.snapshot.status).toBe('completed')
    expect(h.runtime.entryFor(entry.snapshot.id)).toBeNull()
    expect(h.warnings.some((message) => message.includes('复盘指令注入') && message.includes('父代理未激活'))).toBe(true)
  })
})
