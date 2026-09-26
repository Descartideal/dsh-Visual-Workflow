// tests/host/tools/wf-org-catalog/tool.test.ts
//
// wf_org_catalog 执行层单测（两次调用模型）：
//   - 分派：不传 ids（含空数组 / 空串 / 空白项）→ 资产索引；传 ids → 批量详情；
//   - 参数层错误：ids 非数组、超单次上限 → WF_BAD_ARGS；
//   - 容错：坏 id 只单条报错，不阻塞同批其余 id；
//   - 效率与确定性：批内去重、同一容器只读一次模板、两次同输入结果一致；
//   - 注册面：仅父代理可调（子代理 WF_NOT_ROOT）、无法识别会话 WF_BAD_CALLER、
//     tools 服务不可用时注册失败必须显式。

import { describe, expect, it } from 'vitest'
import { executeOrgCatalog, registerWfOrgCatalog } from '../../../../src/host/tools/wf-org-catalog/tool.js'
import { CATALOG_LIMITS } from '../../../../src/host/tools/wf-org-catalog/types.js'
import { WfError } from '../../../../src/host/orchestrator/index.js'
import { makeCatalogHost } from './fixtures.js'
import type { CatalogDetails, CatalogIndex } from '../../../../src/host/tools/wf-org-catalog/types.js'
import type { ToolDefinitionLike } from '../../../../src/host/tools/infrastructure/define-tool.js'

/** 工具注册用的最小 ctx fake（把注册到的定义收集起来）。 */
function registerFixture(): { ctx: { get(name: string): unknown }; registered: Array<ToolDefinitionLike> } {
  const registered: Array<ToolDefinitionLike> = []
  const ctx = {
    get(name: string): unknown {
      if (name !== 'tools') return undefined
      return { register: (def: ToolDefinitionLike) => { registered.push(def); return () => {} } }
    },
  }
  return { ctx, registered }
}

/** 工具执行上下文 fake（callerOf 只读 agent.session.header 与 agent.id）。 */
function execOf(agent: unknown): { signal: AbortSignal; agent: unknown } {
  return { signal: new AbortController().signal, agent }
}

describe('executeOrgCatalog：索引 / 详情分派', () => {
  it('不传 ids → 资产索引', async () => {
    const { host } = makeCatalogHost()
    const out = await executeOrgCatalog(host, {})
    expect(out.kind).toBe('index')
    expect((out as CatalogIndex).combos[0].id).toBe('combo-1')
  })

  it('空数组 / 空串 / 全空白项 → 资产索引（不是错误）', async () => {
    const { host } = makeCatalogHost()
    expect((await executeOrgCatalog(host, { ids: [] })).kind).toBe('index')
    expect((await executeOrgCatalog(host, { ids: '' })).kind).toBe('index')
    expect((await executeOrgCatalog(host, { ids: ['', '   '] })).kind).toBe('index')
  })

  it('传工作流模板 id → 自足骨架', async () => {
    const { host } = makeCatalogHost()
    const out = await executeOrgCatalog(host, { ids: ['tpl-1'] }) as CatalogDetails
    expect(out.kind).toBe('details')
    expect(out.errors).toEqual([])
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]).toMatchObject({ type: 'workflow', id: 'tpl-1', name: '模板一' })
  })

  it('传角色模板 id → 完整 systemPrompt（不截断）', async () => {
    const long = '角'.repeat(6000)
    const { host } = makeCatalogHost({
      store: {
        ...makeCatalogHost().host.store,
        async listTemplates() {
          return [{ id: 'role-1', kind: 'agent', name: '分析员', systemPrompt: long, provider: 'deepseek', model: 'chat' }]
        },
      },
    })
    const out = await executeOrgCatalog(host, { ids: ['role-1'] }) as CatalogDetails
    const asset = out.assets[0] as { type: string; systemPrompt: string }
    expect(asset.type).toBe('role')
    expect(asset.systemPrompt).toHaveLength(6000)
  })

  it('传复合 id → 模板内联角色详情', async () => {
    const { host } = makeCatalogHost()
    const out = await executeOrgCatalog(host, { ids: ['tpl-1#a1'] }) as CatalogDetails
    expect(out.assets[0]).toMatchObject({
      type: 'inlineRole',
      id: 'tpl-1#a1',
      containerId: 'tpl-1',
      nodeId: 'a1',
      systemPrompt: '你是分析员',
    })
  })

  it('坏 id 只单条报错，不阻塞同批其余 id', async () => {
    const { host } = makeCatalogHost()
    const out = await executeOrgCatalog(
      host,
      { ids: ['tpl-1', 'nope-1', 'tpl-1#missing', 'tpl-1#f1', 'role-404'] },
    ) as CatalogDetails
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]).toMatchObject({ type: 'workflow', id: 'tpl-1' })
    expect(out.errors.map((item) => item.id)).toEqual(['nope-1', 'tpl-1#missing', 'tpl-1#f1', 'role-404'])
    expect(out.errors.map((item) => item.code)).toEqual([
      'WF_BAD_ARGS', // 形状无法识别
      'WF_ORG_NOT_FOUND', // 节点不存在
      'WF_BAD_ARGS', // 非角色节点（无 systemPrompt）
      'WF_ORG_NOT_FOUND', // 角色模板不存在
    ])
    expect(out.errors[2].message).toContain('file')
  })

  it('重复 id 只召回一次（批内去重）', async () => {
    const { host } = makeCatalogHost()
    const out = await executeOrgCatalog(host, { ids: ['tpl-1', 'tpl-1', 'role-1', 'role-1'] }) as CatalogDetails
    expect(out.assets.map((asset) => asset.id)).toEqual(['tpl-1', 'role-1'])
  })

  it('同一容器的骨架与内联角色共读一次模板', async () => {
    const { host, calls } = makeCatalogHost()
    await executeOrgCatalog(host, { ids: ['tpl-1', 'tpl-1#a1'] })
    expect(calls.templateReads).toBe(1)
  })

  it('连续两次同输入结果完全一致（确定性、无隐藏状态）', async () => {
    const { host } = makeCatalogHost()
    const first = await executeOrgCatalog(host, { ids: ['tpl-1', 'role-1'] })
    const second = await executeOrgCatalog(host, { ids: ['tpl-1', 'role-1'] })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('清单读取失败向上抛（不伪装成空目录）', async () => {
    const { host } = makeCatalogHost({
      store: {
        ...makeCatalogHost().host.store,
        async listTemplates(): Promise<unknown[]> {
          throw new Error('权限不足')
        },
      },
    })
    await expect(executeOrgCatalog(host, {})).rejects.toThrowError(/权限不足/)
  })
})

describe('executeOrgCatalog：参数层校验', () => {
  it('ids 非数组（单字符串 / 数字 / 对象）→ WF_BAD_ARGS', async () => {
    const { host } = makeCatalogHost()
    for (const ids of ['tpl-1', 42, { id: 'tpl-1' }]) {
      const error = await executeOrgCatalog(host, { ids }).catch((reason: unknown) => reason)
      expect(error).toBeInstanceOf(WfError)
      expect((error as WfError).code).toBe('WF_BAD_ARGS')
    }
  })

  it('ids 超过单次上限 → WF_BAD_ARGS（提示分批）', async () => {
    const { host } = makeCatalogHost()
    const ids = Array.from({ length: CATALOG_LIMITS.detailIds + 1 }, (_item, index) => `tpl-1#node-${index}`)
    const error = await executeOrgCatalog(host, { ids }).catch((reason: unknown) => reason)
    expect((error as WfError).code).toBe('WF_BAD_ARGS')
    expect((error as WfError).message).toContain('分批')
  })
})

describe('registerWfOrgCatalog：注册面与调用方身份', () => {
  it('子代理调用被拒（WF_NOT_ROOT）', async () => {
    const { host } = makeCatalogHost()
    const { ctx, registered } = registerFixture()
    registerWfOrgCatalog(ctx, host)
    const error = await Promise.resolve(
      registered[0].execute({}, execOf({ id: 'child-1', session: { header: { origin: 'subagent', parentSession: 'session-1' } } })),
    ).catch((reason: unknown) => reason)
    expect((error as WfError).code).toBe('WF_NOT_ROOT')
  })

  it('无法识别调用者会话 → WF_BAD_CALLER', async () => {
    const { host } = makeCatalogHost()
    const { ctx, registered } = registerFixture()
    registerWfOrgCatalog(ctx, host)
    const error = await Promise.resolve(registered[0].execute({}, execOf({}))).catch((reason: unknown) => reason)
    expect((error as WfError).code).toBe('WF_BAD_CALLER')
  })

  it('父代理（根会话）调用 → 返回资产索引', async () => {
    const { host } = makeCatalogHost()
    const { ctx, registered } = registerFixture()
    registerWfOrgCatalog(ctx, host)
    const out = await registered[0].execute({}, execOf({ id: 'session-1' })) as CatalogIndex
    expect(out.kind).toBe('index')
    expect(out.rules.graphSemantics.length).toBeGreaterThan(0)
  })

  it('tools 服务不可用 → 注册显式失败（不静默跳过）', () => {
    const { host } = makeCatalogHost()
    expect(() => registerWfOrgCatalog({ get: () => undefined }, host)).toThrowError(/tools 服务不可用/)
  })
})
