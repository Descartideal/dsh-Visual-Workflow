// src/host/api/assets.ts
//
// GUI API 资产端点组（AssetEndpoints）：模版晋升入库、资产态保存、版本列表、
// 回滚、退役、列表与详情。资产事实由 assets 模块的 AssetStore（SQLite）拥有，
// 本层只做「请求 → 领域调用 → 稳定响应/错误码」的翻译。

import { ERR_ASSET_BAD_ARGS, ERR_ASSET_NOT_FOUND } from '../shared/protocol.js'
import { contentFingerprint } from '../assets/index.js'
import type { AssetKind, AssetVersionEntry, RoleAssetDetail, RoleAssetSummary, WorkflowAssetDetail, WorkflowAssetSummary } from '../shared/asset-types.js'
import type { RoleTemplate } from '../shared/template-types.js'
import type { GraphNode, Line } from '../shared/graph-model.js'
import type { OrgMeta } from '../shared/org-meta.js'
import { httpError } from './http.js'
import { VisualWorkflowApiBase, type ApiHost } from './boundary.js'

/** 资产库能力缝（形状由 boundary 的宿主能力缝定义，本模块不自建第二份）。 */
type Assets = NonNullable<ApiHost['assets']>

/** 入库/保存的领域出参：直接取自能力缝签名，避免端点与资产库各写一份形状。 */
type AssetPromoteResult = Awaited<ReturnType<Assets['promoteRole']>>

/** 入库/保存的领域入参：同上按签名派生。 */
type RolePromoteInput = Parameters<Assets['promoteRole']>[0]
type WorkflowPromoteInput = Parameters<Assets['promoteWorkflow']>[0]
type RoleSaveInput = Parameters<Assets['saveRoleVersion']>[0]
type WorkflowSaveInput = Parameters<Assets['saveWorkflowVersion']>[0]

/**
 * 边界的参数错误：status 由传输层决定，code 用资产领域稳定码，
 * 让客户端按 ERR_ASSET_BAD_ARGS 分支（而领域模块抛出的同一 code 也进同一响应形状）。
 */
function assetBadArgs(message: string): Error {
  return httpError(400, message, ERR_ASSET_BAD_ARGS)
}

/** 取必填字符串字段（形状非法即 400；返回窄化后的值供直接构造领域入参）。 */
function requireString(payload: Record<string, unknown>, field: string, subject: string): string {
  const value = payload[field]
  if (typeof value !== 'string') throw assetBadArgs(`${subject} payload requires string ${field}`)
  return value
}

/** 取资产库能力缝；未装配时明确 501（不静默降级为「空资产库」）。 */
function assetsOf(host: ApiHost): Assets {
  const assets = host.assets
  if (!assets) throw httpError(501, '资产库尚未装配（asset store unavailable）')
  return assets
}

/** 校验并归一化资产种类（必填，取值域闭集）。 */
function requireKind(args: { kind?: unknown }): AssetKind {
  const kind = String(args?.kind ?? '')
  if (kind !== 'workflow' && kind !== 'role') throw httpError(400, 'requires kind: workflow|role')
  return kind
}

/** 校验并归一化资产 id（必填）。 */
function requireAssetId(args: { assetId?: unknown }): string {
  const assetId = String(args?.assetId ?? '').trim()
  if (!assetId) throw httpError(400, 'requires assetId')
  return assetId
}

/** 校验回滚目标版本号（必须是正整数）。 */
function requireVersionId(args: { versionId?: unknown }): number {
  const versionId = args?.versionId
  if (typeof versionId !== 'number' || !Number.isInteger(versionId) || versionId <= 0) {
    throw assetBadArgs('requires a positive integer versionId')
  }
  return versionId
}

/** 待填充当前模版指纹的资产索引条目（有来源模版才需要读模版）。 */
interface FingerprintedItem {
  sourceTemplateId?: string
  currentTemplateFingerprint?: string
}

/**
 * 为什么本层填指纹：AssetStore 不读模版（资产库只有入库时的来源指纹），
 * 「模版是否已被改过」的事实只能由持有模版库的一方回答。
 * 模版不存在时省略该字段：客户端据此视为「未锁定」，而非「已同步」。
 */
async function fillCurrentFingerprints<T extends FingerprintedItem>(
  items: T[],
  readTemplate: (templateId: string) => Promise<unknown | null>,
): Promise<T[]> {
  return Promise.all(
    items.map(async (item) => {
      const templateId = item.sourceTemplateId
      if (!templateId) return item
      const template = await readTemplate(templateId)
      if (template === null || template === undefined) return item
      return { ...item, currentTemplateFingerprint: contentFingerprint(template) }
    }),
  )
}

export class AssetEndpoints extends VisualWorkflowApiBase {
  // ---------- 资产列表与详情 ----------

  async listAssets(args: { kind?: unknown }): Promise<{ workflows: WorkflowAssetSummary[]; roles: RoleAssetSummary[] }> {
    // kind 缺省即「两类都返回」；给了值就必须在取值域内（此处先校验，能力缝缺失时才轮得到 501）。
    const rawKind = args?.kind
    const kind = rawKind === undefined || rawKind === null || rawKind === '' ? null : requireKind(args)
    const assets = assetsOf(this.host)
    const [workflows, roles] = await Promise.all([
      kind === null || kind === 'workflow' ? assets.listWorkflowAssets() : [],
      kind === null || kind === 'role' ? assets.listRoleAssets() : [],
    ])
    return {
      workflows: await fillCurrentFingerprints(workflows, (templateId) => this.host.store.getFlowTemplate(templateId)),
      roles: await fillCurrentFingerprints(roles, (templateId) => this.host.store.getTemplate('role', templateId)),
    }
  }

  async getAsset(args: { kind?: unknown; assetId?: unknown }): Promise<WorkflowAssetDetail | RoleAssetDetail> {
    const kind = requireKind(args)
    const assetId = requireAssetId(args)
    const assets = assetsOf(this.host)
    const detail = kind === 'workflow' ? await assets.getWorkflowAsset(assetId) : await assets.getRoleAsset(assetId)
    if (!detail) throw httpError(404, `资产不存在或已退役：${assetId}`, ERR_ASSET_NOT_FOUND)
    return detail
  }

  // ---------- 入库与资产态保存 ----------

  async promoteAsset(args: { kind?: unknown; templateId?: unknown }): Promise<AssetPromoteResult> {
    const kind = requireKind(args)
    const templateId = String(args?.templateId ?? '').trim()
    if (!templateId) throw httpError(400, 'requires templateId')
    const assets = assetsOf(this.host)
    // 入库来源恒为人类动作；agent 来源（代理生成资产）V1 不开放。
    return kind === 'role' ? this.promoteRoleTemplate(assets, templateId) : this.promoteWorkflowTemplate(assets, templateId)
  }

  /** 角色模版入库：模版内容整体作为首个资产版本的来源。 */
  private async promoteRoleTemplate(assets: Assets, templateId: string): Promise<AssetPromoteResult> {
    const role = (await this.host.store.getTemplate('role', templateId)) as RoleTemplate | null
    if (!role) throw httpError(404, `角色模版不存在：${templateId}`, ERR_ASSET_NOT_FOUND)
    const input: RolePromoteInput = { templateId, fingerprint: contentFingerprint(role), role, source: 'human' }
    return assets.promoteRole(input)
  }

  /** 工作流模版入库：模版图整体作为首个资产版本的来源（meta 缺省不落约束）。 */
  private async promoteWorkflowTemplate(assets: Assets, templateId: string): Promise<AssetPromoteResult> {
    const template = await this.host.store.getFlowTemplate(templateId)
    if (!template) throw httpError(404, `工作流模版不存在：${templateId}`, ERR_ASSET_NOT_FOUND)
    const input: WorkflowPromoteInput = {
      templateId,
      fingerprint: contentFingerprint(template),
      mode: template.mode,
      name: template.name,
      description: template.description,
      nodes: template.nodes,
      lines: template.lines,
      ...(template.meta === undefined || template.meta === null ? {} : { meta: template.meta }),
      source: 'human',
    }
    return assets.promoteWorkflow(input)
  }

  async saveAssetVersion(args: { kind?: unknown; assetId?: unknown; payload?: unknown }): Promise<AssetPromoteResult> {
    const kind = requireKind(args)
    const assetId = requireAssetId(args)
    const payload = args?.payload as Record<string, unknown> | null | undefined
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw assetBadArgs('requires a payload object')
    const assets = assetsOf(this.host)
    // 资产态保存由资产库登记新版本（永不覆盖历史版本），故这里只校验形状、不落盘。
    if (kind === 'role') {
      const role: RoleTemplate = {
        ...payload,
        id: assetId,
        kind: payload.kind === 'parent' ? 'parent' : 'agent',
        name: requireString(payload, 'name', 'role'),
        systemPrompt: requireString(payload, 'systemPrompt', 'role'),
        provider: requireString(payload, 'provider', 'role'),
        model: requireString(payload, 'model', 'role'),
        retryLimit: typeof payload.retryLimit === 'number' ? payload.retryLimit : 3,
      }
      const input: RoleSaveInput = { assetId, role, source: 'human' }
      return assets.saveRoleVersion(input)
    }
    const name = requireString(payload, 'name', 'workflow')
    const description = requireString(payload, 'description', 'workflow')
    if (!Array.isArray(payload.nodes)) throw assetBadArgs('workflow payload requires nodes array')
    if (!Array.isArray(payload.lines)) throw assetBadArgs('workflow payload requires lines array')
    const input: WorkflowSaveInput = {
      assetId,
      mode: payload.mode === 'mode2' ? 'mode2' : 'mode1',
      name,
      description,
      nodes: payload.nodes as GraphNode[],
      lines: payload.lines as Line[],
      ...(payload.meta === undefined ? {} : { meta: payload.meta as OrgMeta }),
      source: 'human',
    }
    return assets.saveWorkflowVersion(input)
  }

  // ---------- 版本列表、回滚与退役 ----------

  async listAssetVersions(args: { kind?: unknown; assetId?: unknown }): Promise<AssetVersionEntry[]> {
    const kind = requireKind(args)
    const assetId = requireAssetId(args)
    const assets = assetsOf(this.host)
    return kind === 'role' ? assets.listRoleVersions(assetId) : assets.listWorkflowVersions(assetId)
  }

  async rollbackAsset(args: { kind?: unknown; assetId?: unknown; versionId?: unknown }): Promise<WorkflowAssetDetail | RoleAssetDetail> {
    const kind = requireKind(args)
    const assetId = requireAssetId(args)
    const versionId = requireVersionId(args)
    const assets = assetsOf(this.host)
    // 回滚只改 Active 指针；历史版本内容由资产库保证不被改写。
    return kind === 'role' ? assets.rollbackRoleAsset(assetId, versionId) : assets.rollbackWorkflowAsset(assetId, versionId)
  }

  async retireAsset(args: { kind?: unknown; assetId?: unknown }): Promise<{ kind: AssetKind; assetId: string; retired: true }> {
    const kind = requireKind(args)
    const assetId = requireAssetId(args)
    const assets = assetsOf(this.host)
    if (kind === 'role') await assets.retireRoleAsset(assetId)
    else await assets.retireWorkflowAsset(assetId)
    return { kind, assetId, retired: true }
  }
}
