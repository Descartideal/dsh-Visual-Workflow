// src/client/lib/asset-to-node.ts
//
// 角色资产 → 画布角色节点（深拷贝解耦）：字段逐项映射与 template-to-node 的
// role 分支对齐（同一语义只允许一处映射口径），额外写入 data.sourceAssetId。
//
// 语义边界（用户裁决）：拖入资产仍生成**内联节点**——sourceAssetId 只登记
// 「来源资产」事实，不建立运行时引用，节点字段是拖入时刻的快照。

import type { RoleAssetDetail } from '../../host/shared/asset-types.js'

/** 角色资产详情 → 角色节点 data（与 templateToNodeData 的 role 分支同口径 + 来源资产 id）。 */
export function roleAssetToNodeData(detail: RoleAssetDetail): Record<string, unknown> {
  return {
    label: String(detail.name ?? ''),
    systemPrompt: String(detail.systemPrompt ?? ''),
    provider: String(detail.provider ?? ''),
    model: String(detail.model ?? ''),
    reasoning: (detail.reasoning as string | null | undefined) ?? null,
    presetId: detail.presetId ?? 'standard',
    retryLimit: Number(detail.retryLimit ?? 3),
    reactLimit: detail.reactLimit ?? null,
    inputSchema: String(detail.inputSchema ?? ''),
    outputSchema: String(detail.outputSchema ?? ''),
    injectSystemPrompt: detail.injectSystemPrompt !== false,
    injectToolSections: detail.injectToolSections !== false,
    promptFilePath: String(detail.promptFilePath ?? '') || undefined,
    groupId: null,
    // 来源资产：仅「从资产拖入」写入（模版/实例拖入不写），保存工作流资产时据此登记引用
    sourceAssetId: detail.assetId,
  }
}

/** 角色资产种类 → 画布节点 kind（parent / agent；与 RoleNode.kind 同域）。 */
export function roleAssetNodeKind(detail: RoleAssetDetail): 'parent' | 'agent' {
  return detail.kind === 'parent' ? 'parent' : 'agent'
}
