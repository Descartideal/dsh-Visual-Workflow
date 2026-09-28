// tests/host/prompts/reflection.test.ts
//
// 运行终态「复盘指令」文案单测（prompts/reflection）：
// 标记与机器事实三项、三种终态文案、Fact/Inference 区分、经验约束（允许 0 条）、
// 语言规则口径与纯函数字节稳定。

import { describe, expect, it } from 'vitest'
import {
  REFLECTION_MARKER,
  REFLECTION_TOOL_NAME,
  buildReflectionPrompt,
  type RunReflectionFacts,
} from '../../../src/host/prompts/index.js'

/** 基线事实（各用例按需覆盖；固定值保证输出可逐字断言）。 */
function facts(overrides: Partial<RunReflectionFacts> = {}): RunReflectionFacts {
  return {
    runId: 'run-1',
    flowName: '测试流程',
    status: 'completed',
    durationMs: 125_400,
    nodeCount: 6,
    systemLanguage: '中文',
    ...overrides,
  }
}

describe('复盘指令文案', () => {
  it('首段含【复盘】标记与运行身份；机器事实只列状态/耗时/节点数三项', () => {
    const text = buildReflectionPrompt(facts())
    expect(text).toContain(REFLECTION_MARKER)
    expect(text).toContain('测试流程')
    expect(text).toContain('runId=run-1')
    expect(text).toContain('- run 状态：已完成')
    expect(text).toContain('- 总耗时：2 分 5.4 秒')
    expect(text).toContain('- 节点总数：6')
    expect(text).toContain('以上三项是本次运行的全部机器事实')
  })

  it('不出现未采集事实（token 用量 / 上下文健康度）', () => {
    const text = buildReflectionPrompt(facts())
    expect(text).not.toContain('token')
    expect(text).not.toContain('Token')
    expect(text).not.toContain('上下文健康')
    expect(text).not.toContain('用量')
  })

  it('三种终态各自渲染对应状态文案', () => {
    expect(buildReflectionPrompt(facts({ status: 'completed' }))).toContain('- run 状态：已完成')
    expect(buildReflectionPrompt(facts({ status: 'failed' }))).toContain('- run 状态：失败')
    expect(buildReflectionPrompt(facts({ status: 'stopped' }))).toContain('- run 状态：已停止')
  })

  it('耗时渲染：不足一分钟按秒、不可计算时明确标注', () => {
    expect(buildReflectionPrompt(facts({ durationMs: 1250 }))).toContain('- 总耗时：1.3 秒')
    expect(buildReflectionPrompt(facts({ durationMs: 0 }))).toContain('- 总耗时：0.0 秒')
    expect(buildReflectionPrompt(facts({ durationMs: null }))).toContain('- 总耗时：不可计算')
  })

  it('节点总数按快照渲染（含 0 个节点的边界）', () => {
    expect(buildReflectionPrompt(facts({ nodeCount: 0 }))).toContain('- 节点总数：0')
    expect(buildReflectionPrompt(facts({ nodeCount: 12 }))).toContain('- 节点总数：12')
  })

  it('含 Fact/Inference 区分与反事后归因禁令', () => {
    const text = buildReflectionPrompt(facts())
    expect(text).toContain('Fact（机器事实）')
    expect(text).toContain('Inference（推理）')
    expect(text).toContain('A 是好策略')
    expect(text).toContain('禁止此类归因')
  })

  it('含 0 条允许的表述与经验约束（500 字 / 单句 insight / 语义重复合并）', () => {
    const text = buildReflectionPrompt(facts())
    expect(text).toContain('允许返回 0 条经验')
    expect(text).toContain('约 500 个中文字符以内')
    expect(text).toContain('insight 尽量是单句结论')
    expect(text).toContain('语义重复的经验必须合并成一条')
    expect(text).toContain('提交空数组也是正确结果')
  })

  it('收尾动作指向 wf_experience 并说明入参形状', () => {
    const text = buildReflectionPrompt(facts())
    expect(text).toContain(REFLECTION_TOOL_NAME)
    expect(text).toContain('task_type')
    expect(text).toContain('task_context')
    expect(text).toContain('insight')
    expect(text).toContain('evidence?')
    expect(text).toContain('语义检索')
  })

  it('语言规则沿用共享措辞；systemLanguage 为空串时按中文', () => {
    const explicit = buildReflectionPrompt(facts({ systemLanguage: '中文' }))
    const empty = buildReflectionPrompt(facts({ systemLanguage: '' }))
    const missing = buildReflectionPrompt(facts({ systemLanguage: undefined }))
    expect(explicit).toContain('所有对话回复、注释、思考过程必须使用中文')
    expect(empty).toBe(explicit)
    expect(missing).toBe(explicit)
  })

  it('非中文语言名：英文措辞 + 对应语言规则', () => {
    const text = buildReflectionPrompt(facts({ systemLanguage: 'English' }))
    expect(text).toContain(REFLECTION_MARKER)
    expect(text).toContain('run status: completed')
    expect(text).toContain('所有对话回复、注释、思考过程必须使用English')
    expect(text).not.toContain('run 状态')
  })

  it('纯函数：同一入参两次调用输出字节相同', () => {
    expect(buildReflectionPrompt(facts())).toBe(buildReflectionPrompt(facts()))
    expect(buildReflectionPrompt(facts({ status: 'stopped', durationMs: null })))
      .toBe(buildReflectionPrompt(facts({ status: 'stopped', durationMs: null })))
  })
})
