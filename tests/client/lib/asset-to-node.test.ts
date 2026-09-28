// tests/client/lib/asset-to-node.test.ts
//
// 角色资产 → 画布角色节点（深拷贝解耦）：字段逐项映射 + 来源资产 id 写入。
// 关键契约：拖入资产仍生成**内联节点**，sourceAssetId 只登记来源事实。

import { describe, expect, it } from 'vitest'
import { roleAssetNodeKind, roleAssetToNodeData } from '../../../src/client/lib/asset-to-node.js'
import { templateToNodeData } from '../../../src/client/lib/template-to-node.js'
import type { RoleAssetDetail } from '../../../src/host/shared/asset-types.js'

function roleAsset(partial: Partial<RoleAssetDetail> = {}): RoleAssetDetail {
  return {
    assetId: 'asset-r1',
    versionId: 3,
    rowId: 'row-3',
    kind: 'agent',
    roleAssetType: 'standalone',
    name: '研究员',
    systemPrompt: '你是研究员',
    provider: 'deepseek',
    model: 'deepseek-chat',
    presetId: 'standard',
    retryLimit: 5,
    reactLimit: 7,
    inputSchema: 'in',
    outputSchema: 'out',
    injectSystemPrompt: false,
    injectToolSections: false,
    promptFilePath: 'D:\\work\\a.md',
    referenceWorkflowIds: [],
    createdAt: 1,
    ...partial,
  }
}

describe('角色资产 → 节点 data（深拷贝解耦）', () => {
  it('字段逐项映射：名称→label/提示词/模型/预算/开关/路径', () => {
    const data = roleAssetToNodeData(roleAsset())
    expect(data.label).toBe('研究员')
    expect(data.systemPrompt).toBe('你是研究员')
    expect(data.provider).toBe('deepseek')
    expect(data.model).toBe('deepseek-chat')
    expect(data.presetId).toBe('standard')
    expect(data.retryLimit).toBe(5)
    expect(data.reactLimit).toBe(7)
    expect(data.inputSchema).toBe('in')
    expect(data.outputSchema).toBe('out')
    expect(data.injectSystemPrompt).toBe(false)
    expect(data.injectToolSections).toBe(false)
    expect(data.promptFilePath).toBe('D:\\work\\a.md')
    expect(data.groupId).toBeNull()
  })

  it('写入来源资产 id（sourceAssetId = 资产 id，不是版本行 id）', () => {
    const data = roleAssetToNodeData(roleAsset({ assetId: 'asset-x', rowId: 'row-y' }))
    expect(data.sourceAssetId).toBe('asset-x')
  })

  it('缺省字段回退：presetId 缺省 standard、retryLimit 缺省 3、开关缺省 true', () => {
    const data = roleAssetToNodeData(roleAsset({
      presetId: null,
      retryLimit: undefined as unknown as number,
      injectSystemPrompt: undefined,
      injectToolSections: undefined,
      promptFilePath: undefined,
    }))
    expect(data.presetId).toBe('standard')
    expect(data.retryLimit).toBe(3)
    expect(data.injectSystemPrompt).toBe(true)
    expect(data.injectToolSections).toBe(true)
    expect(data.promptFilePath).toBeUndefined()
  })

  it('与模版 role 分支同口径：同字段的映射结果一致（仅多 sourceAssetId）', () => {
    const detail = roleAsset()
    const fromAsset = roleAssetToNodeData(detail)
    const fromTemplate = templateToNodeData('role', {
      id: 'r-1',
      kind: 'agent',
      name: detail.name,
      systemPrompt: detail.systemPrompt,
      provider: detail.provider,
      model: detail.model,
      presetId: detail.presetId,
      retryLimit: detail.retryLimit,
      reactLimit: detail.reactLimit,
      inputSchema: detail.inputSchema,
      outputSchema: detail.outputSchema,
      injectSystemPrompt: detail.injectSystemPrompt,
      injectToolSections: detail.injectToolSections,
      promptFilePath: detail.promptFilePath,
    }) as Record<string, unknown>
    const { sourceAssetId, ...rest } = fromAsset
    expect(rest).toEqual(fromTemplate)
    expect(sourceAssetId).toBe('asset-r1')
  })

  it('资产种类 → 节点 kind：parent → parent，agent → agent', () => {
    expect(roleAssetNodeKind(roleAsset({ kind: 'parent' }))).toBe('parent')
    expect(roleAssetNodeKind(roleAsset({ kind: 'agent' }))).toBe('agent')
  })
})
