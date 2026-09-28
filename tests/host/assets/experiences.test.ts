// tests/host/assets/experiences.test.ts
//
// 经验测试：插入（含批内与跨批 insight 去重、空字段跳过）、索引倒序与上限、
// 详情按入参顺序召回且命中不到略过。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExperienceDraft } from '../../../src/host/shared/asset-types.js'
import { AssetStore, EXPERIENCE_INDEX_MAX_LIMIT } from '../../../src/host/assets/index.js'
import { makeStore, removeTempRoot } from './fixtures/asset-fixture.js'

let store: AssetStore
let root: string

beforeEach(async () => {
  const created = await makeStore()
  store = created.store
  root = created.root
})

afterEach(async () => {
  store.close()
  await removeTempRoot(root)
})

function draft(overrides: Partial<ExperienceDraft> = {}): ExperienceDraft {
  return {
    taskType: '软件开发',
    taskContext: '为插件新增资产库',
    insight: '先冻结共享契约再实现持久化，可避免两端漂移',
    ...overrides,
  }
}

describe('经验插入（算法 I）', () => {
  it('test_插入_合法草稿_入库并回传完整条目', async () => {
    const result = await store.insertExperiences([draft({ evidence: '来自某次运行', sourceRunId: 'run-1' })], 1_700_000_500_000)

    expect(result.skipped).toEqual([])
    expect(result.inserted).toHaveLength(1)
    expect(result.inserted[0].id).toMatch(/^ex-/)
    expect(result.inserted[0]).toMatchObject({
      sourceRunId: 'run-1',
      reflectionPromptVersion: '1',
      taskType: '软件开发',
      taskContext: '为插件新增资产库',
      insight: '先冻结共享契约再实现持久化，可避免两端漂移',
      evidence: '来自某次运行',
      reviewedAt: 1_700_000_500_000,
    })
    expect(result.inserted[0].createdAt).toBe(result.inserted[0].updatedAt)
  })

  it('test_插入_已存在同task_type与insight_跳过并说明重复', async () => {
    await store.insertExperiences([draft()], 1)

    const result = await store.insertExperiences([draft({ taskContext: '另一处上下文' })], 1)

    expect(result.inserted).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].insight).toBe('先冻结共享契约再实现持久化，可避免两端漂移')
    expect(result.skipped[0].reason).toContain('重复')
  })

  it('test_插入_同一批内重复insight_仅入库第一条', async () => {
    const result = await store.insertExperiences([draft(), draft({ taskContext: '换个上下文' })], 1)

    expect(result.inserted).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(await store.listExperienceIndex(10)).toHaveLength(1)
  })

  it('test_插入_同insight不同task_type_视为两条经验', async () => {
    const result = await store.insertExperiences([draft(), draft({ taskType: '数据处理' })], 1)

    expect(result.inserted).toHaveLength(2)
    expect(result.skipped).toEqual([])
  })

  it('test_插入_insight为空_跳过且原因指明缺失字段', async () => {
    const result = await store.insertExperiences([draft({ insight: '   ' })], 1)

    expect(result.inserted).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain('insight')
    expect(await store.listExperienceIndex(10)).toEqual([])
  })

  it('test_插入_taskType或taskContext为空_跳过并列出全部缺失字段', async () => {
    const result = await store.insertExperiences([draft({ taskType: '', taskContext: '' })], 1)

    expect(result.inserted).toEqual([])
    expect(result.skipped[0].reason).toContain('taskType')
    expect(result.skipped[0].reason).toContain('taskContext')
  })

  it('test_插入_混合合法与非法_合法入库非法跳过', async () => {
    const result = await store.insertExperiences([draft({ insight: '有效经验一' }), draft({ insight: '' })], 1)

    expect(result.inserted.map((entry) => entry.insight)).toEqual(['有效经验一'])
    expect(result.skipped).toHaveLength(1)
  })
})

describe('经验索引与详情', () => {
  it('test_索引_按created_at倒序返回id与task_context', async () => {
    const first = await store.insertExperiences([draft({ insight: '最早' })], 1)
    const second = await store.insertExperiences([draft({ insight: '居中' })], 1)
    const third = await store.insertExperiences([draft({ insight: '最新' })], 1)

    const index = await store.listExperienceIndex(10)

    expect(index).toHaveLength(3)
    expect(index.map((entry) => entry.id)).toEqual([
      third.inserted[0].id,
      second.inserted[0].id,
      first.inserted[0].id,
    ])
    expect(index[0].taskContext).toBe('为插件新增资产库')
  })

  it('test_索引_limit生效且非正数返回空列表', async () => {
    await store.insertExperiences([draft({ insight: '一' }), draft({ insight: '二' })], 1)

    expect(await store.listExperienceIndex(1)).toHaveLength(1)
    expect(await store.listExperienceIndex(0)).toEqual([])
    expect(await store.listExperienceIndex(-5)).toEqual([])
    expect(await store.listExperienceIndex(Number.NaN)).toEqual([])
  })

  it('test_索引_limit超出上限_按上限截断而非报错', async () => {
    await store.insertExperiences([draft({ insight: '一' }), draft({ insight: '二' })], 1)

    expect(await store.listExperienceIndex(EXPERIENCE_INDEX_MAX_LIMIT + 100)).toHaveLength(2)
  })

  it('test_详情_保持入参顺序且命中不到的略过', async () => {
    const first = await store.insertExperiences([draft({ insight: '一' })], 1)
    const second = await store.insertExperiences([draft({ insight: '二' })], 1)

    const entries = await store.getExperiences([second.inserted[0].id, 'ex-缺失', first.inserted[0].id])

    expect(entries.map((entry) => entry.id)).toEqual([second.inserted[0].id, first.inserted[0].id])
    expect(entries[0].insight).toBe('二')
  })

  it('test_详情_空入参_返回空列表', async () => {
    expect(await store.getExperiences([])).toEqual([])
  })

  it('test_详情_未审核经验_reviewedAt仍原样返回', async () => {
    const inserted = await store.insertExperiences([draft()], 0)

    const [entry] = await store.getExperiences([inserted.inserted[0].id])
    expect(entry.reviewedAt).toBe(0)
  })

  it('test_详情_可选字段缺省_读回undefined而非空串', async () => {
    const inserted = await store.insertExperiences([draft()], 1)

    const [entry] = await store.getExperiences([inserted.inserted[0].id])
    expect(entry.sourceRunId).toBeUndefined()
    expect(entry.evidence).toBeUndefined()
    expect(entry.reviewFeedback).toBeUndefined()
    expect(entry.reviewedAt).toBe(1)
  })
})
