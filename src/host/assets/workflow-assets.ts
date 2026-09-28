// src/host/assets/workflow-assets.ts
//
// 工作流资产的写读端口：版本登记（含内联角色同步登记与引用统计）、节点壳重建、回滚、退役。
//
// 本文件全部写函数都必须在调用方开启的事务内执行（ctx 由 withTx 提供）：
// 「解析资产 → 角色节点逐个登记/引用 → 写工作流版本行 → 刷新引用统计」是一条
// 原子链，中途失败必须整体回滚，否则会留下「工作流版本引用了不存在的角色版本」。
//
// 磁盘形状要点：workflow_asset_history.nodes_json 只存**节点壳**（角色节点仅留
// id/kind/position/groupId/sourceAssetId），角色字段由 role_version_ids 指向角色
// 版本行——角色内容因此可跨工作流共享，且历史版本回放不受角色资产后续修改影响。

import type {
  AssetVersionEntry,
  WorkflowAssetDetail,
  WorkflowAssetRoleRef,
  WorkflowAssetSummary,
} from '../shared/asset-types.js'
import type { GraphNode, Line, RoleNode, WorkflowMode } from '../shared/graph-model.js'
import type { OrgMeta } from '../shared/org-meta.js'
import type { AssetTxContext } from './db.js'
import { assetNotFound, assetVersionNotFound } from './errors.js'
import { versionRowId } from './ids.js'
import { requireAssetId, toJsonText, toInteger } from './role-check.js'
import {
  addRoleVersion,
  appendRoleReference,
  createRoleAsset,
  findRoleVersionByContent,
  isRoleAssetLive,
  markRoleVersionShared,
  readRoleActive,
  readRoleVersionRow,
  referenceCount,
  roleVersionType,
  type RolePortContext,
} from './role-assets.js'
import {
  isRoleNode,
  parseJsonStrict,
  roleFieldsFromNode,
  roleFieldsToNodeData,
  sameRoleFields,
  type RoleAssetRow,
  type RoleContentFields,
} from './row-codec.js'

/** 节点壳：角色节点只保留结构字段，内容字段由角色版本行回填。 */
export interface NodeShell {
  id: string
  kind: GraphNode['kind']
  position: { x: number; y: number }
  groupId?: string | null
  sourceAssetId?: string
}

/** 工作流资产版本行的内容字段（不含审计列）。 */
export interface WorkflowContentFields {
  mode: WorkflowMode
  name: string
  description: string
  /** 节点壳数组；非角色节点为完整节点对象（晋升时已是快照）。 */
  nodeShells: NodeShell[]
  lines: Line[]
  meta: OrgMeta | null
  roleVersionIds: WorkflowAssetRoleRef[]
}

/** 工作流资产版本行。 */
export interface WorkflowAssetRow extends WorkflowContentFields {
  id: string
  versionId: number
  assetId: string
  retrievalContext: string | null
  source: 'human' | 'agent'
  sourceRunId: string | null
  sourceTemplateId: string | null
  sourceFingerprint: string | null
  createdAt: number
}

/** 工作流资产 Active 行。 */
export interface WorkflowAssetActiveRow {
  assetId: string
  versionId: number
  name: string
  retrievalContext: string
  sourceTemplateId: string | null
  sourceFingerprint: string | null
  updatedAt: number
}

/** 登记入参（AssetStore 组装；assetId 已解析、来源绑定已确定）。 */
export interface WorkflowWriteRequest {
  assetId: string
  mode: WorkflowMode
  name: string
  description: string
  nodes: GraphNode[]
  lines: Line[]
  meta: OrgMeta | null
  source: 'human' | 'agent'
  sourceTemplateId: string | null
  fingerprint: string | null
  /** 幂等短路判据（仅晋升路径非空）：与 Active 行来源指纹相同即视为内容未变。 */
  shortCircuitFingerprint: string | null
  /**
   * 新角色资产 id 生成器：**按需调用**（只有真正要新建内联资产时才取一个）。
   * 为什么不预分配整池：id 源是被消费的单调序列，预分配会让「本用例第几个资产」
   * 变得难以预测，也会在复用/去重路径上凭空消耗 id。
   */
  nextRoleAssetId: () => string
}

/** 登记结果。 */
export interface WorkflowRegistration {
  assetId: string
  versionId: number
  rowId: string
  unchanged: boolean
  sharedRoleAssetIds: string[]
}

const WORKFLOW_HISTORY_COLUMNS = [
  'id',
  'version_id',
  'asset_id',
  'mode',
  'name',
  'description',
  'role_version_ids',
  'nodes_json',
  'lines_json',
  'meta_json',
  'retrieval_context',
  'source',
  'source_run_id',
  'source_template_id',
  'source_fingerprint',
  'created_at',
].join(', ')

// ---------------------------------------------------------------------------
// 读路径
// ---------------------------------------------------------------------------

/** 工作流资产列表（Active 版本投影；单行损坏跳过并 warn，保证列表可用）。 */
export function listWorkflowAssets(ctx: AssetTxContext): WorkflowAssetSummary[] {
  const rows = ctx.all(
    `SELECT a.asset_id AS asset_id, a.version_id AS version_id, a.name AS name,
            a.source_template_id AS source_template_id, a.source_fingerprint AS source_fingerprint,
            a.updated_at AS updated_at, h.description AS description
       FROM workflow_asset_active a
       JOIN workflow_asset_history h ON h.asset_id = a.asset_id AND h.version_id = a.version_id
      ORDER BY a.updated_at DESC, a.asset_id ASC`,
  )
  const summaries: WorkflowAssetSummary[] = []
  for (const row of rows) {
    try {
      const sourceTemplateId = textOrUndefined(row.source_template_id)
      const sourceFingerprint = textOrUndefined(row.source_fingerprint)
      summaries.push({
        assetId: requireAssetId(row.asset_id),
        versionId: toInteger(row.version_id, 1),
        name: String(row.name ?? ''),
        description: String(row.description ?? ''),
        // currentTemplateFingerprint 由 API 边界读模版后填充（本模块不读模版），故不在此赋值
        ...(sourceTemplateId ? { sourceTemplateId } : {}),
        ...(sourceFingerprint ? { sourceFingerprint } : {}),
        updatedAt: toInteger(row.updated_at, 0),
      })
    } catch (error) {
      warnSkipped('工作流资产', row.asset_id, error)
    }
  }
  return summaries
}

/**
 * 工作流资产详情：Active 版本 + 节点壳按 role_version_ids join 回角色版本字段。
 * 壳与映射不一致（缺映射 / 引用行缺失）即抛带路径的错误：静默产半张图会让运行期
 * 拿到结构上无法执行的图，比直接失败更难排查。
 */
export function getWorkflowAssetDetail(ctx: AssetTxContext, assetId: string): WorkflowAssetDetail | null {
  const active = readWorkflowActive(ctx, assetId)
  if (!active) return null
  const row = readWorkflowVersionRow(ctx, assetId, active.versionId)
  if (!row) {
    throw new Error(`工作流资产 ${assetId} 的 Active 版本 v${active.versionId} 在历史中缺失：资产行已损坏`)
  }
  return workflowDetailOf(ctx, row)
}

/** 工作流资产版本列表（版本号倒序）。 */
export function readWorkflowVersionEntries(ctx: AssetTxContext, assetId: string): AssetVersionEntry[] {
  const active = readWorkflowActive(ctx, assetId)
  if (!active) throw assetNotFound(assetId)
  const rows = ctx.all(
    'SELECT version_id, name, created_at, source FROM workflow_asset_history WHERE asset_id = ? ORDER BY version_id DESC',
    [assetId],
  )
  return rows.map((row) => ({
    versionId: toInteger(row.version_id, 0),
    rowId: versionRowId(assetId, toInteger(row.version_id, 0)),
    name: String(row.name ?? ''),
    createdAt: toInteger(row.created_at, 0),
    source: row.source === 'agent' ? 'agent' : 'human',
    active: toInteger(row.version_id, 0) === active.versionId,
  }))
}

/** 工作流资产 Active 行。 */
export function readWorkflowActive(ctx: AssetTxContext, assetId: string): WorkflowAssetActiveRow | null {
  const row = ctx.get('SELECT * FROM workflow_asset_active WHERE asset_id = ?', [assetId])
  if (!row) return null
  return {
    assetId: String(row.asset_id ?? ''),
    versionId: toInteger(row.version_id, 0),
    name: String(row.name ?? ''),
    retrievalContext: String(row.retrieval_context ?? ''),
    sourceTemplateId: textOrUndefined(row.source_template_id) ?? null,
    sourceFingerprint: textOrUndefined(row.source_fingerprint) ?? null,
    updatedAt: toInteger(row.updated_at, 0),
  }
}

/** 按来源模版定位绑定资产（同一模版的二次晋升复用同一资产）。 */
export function findWorkflowAssetByTemplate(ctx: AssetTxContext, templateId: string): WorkflowAssetActiveRow | null {
  const row = ctx.get(
    'SELECT asset_id FROM workflow_asset_active WHERE source_template_id = ? ORDER BY updated_at DESC LIMIT 1',
    [templateId],
  )
  if (!row) return null
  return readWorkflowActive(ctx, String(row.asset_id ?? ''))
}

/** 工作流版本行读取（JSON 列严格解析，损坏即抛错）。 */
export function readWorkflowVersionRow(ctx: AssetTxContext, assetId: string, versionId: number): WorkflowAssetRow | null {
  const row = ctx.get(
    `SELECT ${WORKFLOW_HISTORY_COLUMNS} FROM workflow_asset_history WHERE asset_id = ? AND version_id = ?`,
    [assetId, versionId],
  )
  return row ? workflowRowToAssetRow(row) : null
}

/**
 * 回滚：只把 Active 指针移向目标版本（name / retrieval_context / 来源指纹同步），
 * 不新增版本、不改历史行。
 */
export function rollbackWorkflowAssetTo(ctx: RolePortContext, assetId: string, versionId: number): WorkflowAssetDetail {
  // 先判资产存活：已退役资产的回滚应报「资产不可用」，而不是「版本非法」
  if (!readWorkflowActive(ctx.tx, assetId)) throw assetNotFound(assetId)
  const target = readWorkflowVersionRow(ctx.tx, assetId, versionId)
  if (!target) throw assetVersionNotFound(assetId, versionId)
  ctx.tx.run(
    `UPDATE workflow_asset_active
        SET version_id = ?, name = ?, retrieval_context = ?, source_fingerprint = ?, updated_at = ?
      WHERE asset_id = ?`,
    [
      versionId,
      target.name,
      workflowRetrievalContext(assetId, target.name, target.description),
      target.sourceFingerprint,
      ctx.now(),
      assetId,
    ],
  )
  return workflowDetailOf(ctx.tx, target)
}

/** 退役：删除 Active 行；历史行与其引用统计保留（审计与再次复用判定都依赖历史）。 */
export function retireWorkflowAssetRow(tx: AssetTxContext, assetId: string): void {
  if (!readWorkflowActive(tx, assetId)) throw assetNotFound(assetId)
  tx.run('DELETE FROM workflow_asset_active WHERE asset_id = ?', [assetId])
}

// ---------------------------------------------------------------------------
// 写路径（算法 E）
// ---------------------------------------------------------------------------

/** 工作流检索上下文 = id + name + description。 */
export function workflowRetrievalContext(assetId: string, name: string, description: string): string {
  return `${assetId} ${name} ${description}`
}

/** 首版登记：写入版本 1 并建立 Active 行（资产此前不存在）。 */
export function createWorkflowAsset(
  ctx: RolePortContext,
  request: Omit<WorkflowWriteRequest, 'shortCircuitFingerprint'>,
): WorkflowRegistration {
  return insertWorkflowVersion(ctx, request, 1)
}

/**
 * 追加版本：先判幂等短路（来源指纹未变即不新增版本），再解析角色节点并写版本行。
 * 只在资产已存在（Active 行在）时调用。
 */
export function registerWorkflowVersion(ctx: RolePortContext, request: WorkflowWriteRequest): WorkflowRegistration {
  const active = readWorkflowActive(ctx.tx, request.assetId)
  if (!active) throw assetNotFound(request.assetId)
  if (
    request.shortCircuitFingerprint !== null &&
    active.sourceFingerprint !== null &&
    active.sourceFingerprint === request.shortCircuitFingerprint
  ) {
    // 幂等短路：模版内容指纹未变，说明当前 Active 版本已是同一内容的登记结果
    return {
      assetId: request.assetId,
      versionId: active.versionId,
      rowId: versionRowId(request.assetId, active.versionId),
      unchanged: true,
      sharedRoleAssetIds: [],
    }
  }
  const previous = readWorkflowVersionRow(ctx.tx, request.assetId, active.versionId)
  return insertWorkflowVersion(ctx, request, nextWorkflowVersionId(ctx.tx, request.assetId), previous)
}

/** 版本行写入（版本号由调用方给定；previous 提供 created_at 的继承源）。 */
function insertWorkflowVersion(
  ctx: RolePortContext,
  request: Omit<WorkflowWriteRequest, 'shortCircuitFingerprint'>,
  versionId: number,
  previous?: WorkflowAssetRow | null,
): WorkflowRegistration {
  const shared = new Set<string>()
  const roleRefs: WorkflowAssetRoleRef[] = []
  const shells: NodeShell[] = []
  for (const node of request.nodes) {
    if (!isRoleNode(node)) {
      // 非角色节点原样落库（完整快照，无需 join）
      shells.push(node as unknown as NodeShell)
      continue
    }
    // 保持原顺序遍历：roleRefs 与壳数组的角色节点顺序一致
    roleRefs.push({
      nodeId: node.id,
      roleVersionId: registerRoleNode(ctx, node, request.source, request.nextRoleAssetId, shared),
    })
    shells.push(roleShellOf(node))
  }

  const now = ctx.now()
  const rowId = versionRowId(request.assetId, versionId)
  ctx.tx.run(
    `INSERT INTO workflow_asset_history (
       id, version_id, asset_id, mode, name, description, role_version_ids, nodes_json, lines_json,
       meta_json, retrieval_context, source, source_run_id, source_template_id, source_fingerprint, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rowId,
      versionId,
      request.assetId,
      request.mode,
      request.name,
      request.description,
      JSON.stringify(roleRefs),
      JSON.stringify(shells),
      JSON.stringify(request.lines),
      toJsonText(request.meta),
      workflowRetrievalContext(request.assetId, request.name, request.description),
      request.source,
      // source_run_id 由复盘链路补写（V1 晋升入口不携带 run 上下文），此处显式留空
      null,
      request.sourceTemplateId,
      request.fingerprint,
      previous?.createdAt ?? now,
    ],
  )
  ctx.tx.run(
    `INSERT INTO workflow_asset_active (asset_id, version_id, name, retrieval_context, source_template_id, source_fingerprint, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET
       version_id = excluded.version_id,
       name = excluded.name,
       retrieval_context = excluded.retrieval_context,
       source_template_id = excluded.source_template_id,
       source_fingerprint = excluded.source_fingerprint,
       updated_at = excluded.updated_at`,
    [
      request.assetId,
      versionId,
      request.name,
      workflowRetrievalContext(request.assetId, request.name, request.description),
      request.sourceTemplateId,
      request.fingerprint,
      now,
    ],
  )

  // 引用统计与版本行同事务：本工作流版本行的 rowId 即引用记录的唯一标识。
  // 去重后逐个角色版本行处理：同一张图引用同一版本多次只是「一条引用记录」，
  // 不因此把资产判成被多个工作流共用（那是 shared 的语义）。
  for (const roleVersionId of new Set(roleRefs.map((ref) => ref.roleVersionId))) {
    appendRoleReference(ctx, roleVersionId, rowId)
    const referencedAssetId = assetIdOfRoleRow(ctx.tx, roleVersionId)
    if (!referencedAssetId) continue
    if (referenceCount(ctx.tx, roleVersionId) >= 2) {
      const type = roleVersionType(ctx.tx, roleVersionId)
      if (type === 'standalone' || type === 'inline') {
        markRoleVersionShared(ctx, roleVersionId)
        shared.add(referencedAssetId)
      }
    }
  }

  return { assetId: request.assetId, versionId, rowId, unchanged: false, sharedRoleAssetIds: [...shared] }
}

// ---------------------------------------------------------------------------
// 内部：角色节点登记与节点壳重建
// ---------------------------------------------------------------------------

/**
 * 单个角色节点的版本解析（算法 E 第 3 步）：
 *   1. data.sourceAssetId 命中未退役资产：内容与 Active 全等 → 直接引用该版本行；
 *      否则在该资产下登记新版本（类型与来源绑定跟随该资产）；
 *   2. 否则内容去重：命中 → 引用命中版本行，并把该资产升为 shared；
 *   3. 均未命中 → 新建 inline 角色资产（版本 1，不带来源模版绑定）。
 */
function registerRoleNode(
  ctx: RolePortContext,
  node: RoleNode,
  source: 'human' | 'agent',
  newAssetId: () => string,
  shared: Set<string>,
): string {
  const fields = roleFieldsFromNode(node)
  const declared = typeof node.data.sourceAssetId === 'string' ? node.data.sourceAssetId : ''
  if (declared && isRoleAssetLive(ctx.tx, declared)) {
    const active = readRoleActive(ctx.tx, declared)
    const activeRow = active ? readRoleVersionRow(ctx.tx, declared, active.versionId) : null
    if (activeRow && sameRoleFields(contentOfRow(activeRow), fields)) {
      // 内容与源资产 Active 版本全等：只登记引用，不为节点新建版本
      return activeRow.id
    }
    const versionId = nextRoleVersionIdOf(ctx.tx, declared)
    const registration = addRoleVersion(ctx, {
      assetId: declared,
      fields,
      roleAssetType: activeRow?.roleAssetType ?? 'standalone',
      source,
      inheritSource: {
        sourceTemplateId: activeRow?.sourceTemplateId ?? null,
        sourceFingerprint: activeRow?.sourceFingerprint ?? null,
      },
      previousRow: activeRow,
      versionId,
    })
    return registration.rowId
  }

  const duplicate = findRoleVersionByContent(ctx.tx, fields)
  if (duplicate) {
    // 命中已存在内容：standalone/inline 都升 shared（同一内容被两处复用，修改需级联提示）
    markRoleVersionShared(ctx, duplicate.row.id)
    shared.add(duplicate.assetId)
    return duplicate.row.id
  }

  const created = createRoleAsset(ctx, { assetId: newAssetId(), fields, roleAssetType: 'inline', source })
  return created.rowId
}

/** 壳重建（算法 H）：壳 + 角色版本映射 → 完整节点数组（顺序与壳一致）。 */
function rebuildNodes(ctx: AssetTxContext, assetId: string, row: WorkflowAssetRow): GraphNode[] {
  const refs = new Map(row.roleVersionIds.map((ref) => [ref.nodeId, ref.roleVersionId]))
  const nodes: GraphNode[] = []
  for (const shell of row.nodeShells) {
    if (shell.kind !== 'parent' && shell.kind !== 'agent') {
      nodes.push(shell as unknown as GraphNode)
      continue
    }
    const roleVersionId = refs.get(shell.id)
    if (!roleVersionId) {
      throw new Error(
        `工作流资产 ${assetId} v${row.versionId} 的节点 ${shell.id} 是角色节点但缺少角色版本映射：节点壳已损坏`,
      )
    }
    const roleRow = readRoleRowById(ctx, roleVersionId)
    if (!roleRow) {
      throw new Error(
        `工作流资产 ${assetId} v${row.versionId} 的节点 ${shell.id} 引用的角色版本行 ${roleVersionId} 不存在：角色资产可能已被删除`,
      )
    }
    nodes.push({
      id: shell.id,
      kind: shell.kind,
      position: shell.position,
      data: roleFieldsToNodeData(contentOfRow(roleRow), {
        groupId: shell.groupId ?? null,
        sourceAssetId: shell.sourceAssetId,
      }),
    })
  }
  const orphan = row.roleVersionIds.find((ref) => !row.nodeShells.some((shell) => shell.id === ref.nodeId))
  if (orphan) {
    throw new Error(
      `工作流资产 ${assetId} v${row.versionId} 的角色版本映射指向不存在的节点 ${orphan.nodeId}：节点壳已损坏`,
    )
  }
  return nodes
}

/** 版本行 → 详情契约（nodes 已重建）。 */
function workflowDetailOf(ctx: AssetTxContext, row: WorkflowAssetRow): WorkflowAssetDetail {
  return {
    assetId: row.assetId,
    versionId: row.versionId,
    rowId: row.id,
    mode: row.mode,
    name: row.name,
    description: row.description,
    nodes: rebuildNodes(ctx, row.assetId, row),
    lines: row.lines,
    ...(row.meta ? { meta: row.meta } : {}),
    roleVersionIds: row.roleVersionIds,
    ...(row.sourceTemplateId ? { sourceTemplateId: row.sourceTemplateId } : {}),
    createdAt: row.createdAt,
  }
}

/** 角色节点壳：只保留结构字段（内容字段由角色版本行回填）。 */
function roleShellOf(node: RoleNode): NodeShell {
  const shell: NodeShell = { id: node.id, kind: node.kind, position: node.position }
  if (node.data.groupId !== undefined) shell.groupId = node.data.groupId
  if (node.data.sourceAssetId !== undefined) shell.sourceAssetId = node.data.sourceAssetId
  return shell
}

/** 按版本行 id 读取角色版本行（`<assetId>@<versionId>` 逆向拆分）。 */
function readRoleRowById(ctx: AssetTxContext, rowId: string): RoleAssetRow | null {
  const index = rowId.lastIndexOf('@')
  if (index < 0) return null
  const versionId = Number(rowId.slice(index + 1))
  if (!Number.isInteger(versionId) || versionId < 1) return null
  return readRoleVersionRow(ctx, rowId.slice(0, index), versionId)
}

/** 角色版本行 → 其所属逻辑资产 id（引用统计升 shared 时使用）。 */
function assetIdOfRoleRow(ctx: AssetTxContext, rowId: string): string | null {
  const row = ctx.get('SELECT asset_id FROM role_asset_history WHERE id = ?', [rowId])
  if (!row) return null
  const assetId = String(row.asset_id ?? '')
  return assetId === '' ? null : assetId
}

/** 下一个角色版本号（声明式读取，避免跨文件引用顺序耦合）。 */
function nextRoleVersionIdOf(ctx: AssetTxContext, assetId: string): number {
  const row = ctx.get('SELECT MAX(version_id) AS max_version FROM role_asset_history WHERE asset_id = ?', [assetId])
  return toInteger(row?.max_version, 0) + 1
}

// ---------------------------------------------------------------------------
// 内部：行转换
// ---------------------------------------------------------------------------

function workflowRowToAssetRow(row: Record<string, unknown>): WorkflowAssetRow {
  const nodeShells = parseJsonStrict(row.nodes_json, `nodes_json(asset=${String(row.asset_id)})`)
  const lines = parseJsonStrict(row.lines_json, `lines_json(asset=${String(row.asset_id)})`)
  const roleVersionIds = parseJsonStrict(row.role_version_ids, `role_version_ids(asset=${String(row.asset_id)})`)
  if (!Array.isArray(nodeShells) || !Array.isArray(lines) || !Array.isArray(roleVersionIds)) {
    throw new Error(`工作流资产 ${String(row.asset_id)} 的 JSON 列不是数组：资产行已损坏`)
  }
  const metaText = row.meta_json
  const meta =
    typeof metaText === 'string' && metaText !== '' ? (parseJsonStrict(metaText, 'meta_json') as OrgMeta) : null
  return {
    id: String(row.id ?? ''),
    versionId: toInteger(row.version_id, 0),
    assetId: String(row.asset_id ?? ''),
    mode: row.mode === 'mode2' ? 'mode2' : 'mode1',
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    nodeShells: nodeShells as NodeShell[],
    lines: lines as Line[],
    meta,
    roleVersionIds: (roleVersionIds as WorkflowAssetRoleRef[]).filter(
      (ref) => typeof ref?.nodeId === 'string' && typeof ref?.roleVersionId === 'string',
    ),
    retrievalContext: typeof row.retrieval_context === 'string' ? row.retrieval_context : null,
    source: row.source === 'agent' ? 'agent' : 'human',
    sourceRunId: textOrUndefined(row.source_run_id) ?? null,
    sourceTemplateId: textOrUndefined(row.source_template_id) ?? null,
    sourceFingerprint: textOrUndefined(row.source_fingerprint) ?? null,
    createdAt: toInteger(row.created_at, 0),
  }
}

/** 下一个工作流版本号 = max(version_id) + 1。 */
function nextWorkflowVersionId(ctx: AssetTxContext, assetId: string): number {
  const row = ctx.get('SELECT MAX(version_id) AS max_version FROM workflow_asset_history WHERE asset_id = ?', [assetId])
  return toInteger(row?.max_version, 0) + 1
}

/** 角色版本行 → 内容字段（比较与重建共用；统计列不参与比较）。 */
function contentOfRow(row: RoleAssetRow): RoleContentFields {
  return {
    kind: row.kind,
    name: row.name,
    systemPrompt: row.systemPrompt,
    provider: row.provider,
    model: row.model,
    reasoning: row.reasoning,
    presetId: row.presetId,
    retryLimit: row.retryLimit,
    reactLimit: row.reactLimit,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    systemPromptSource: row.systemPromptSource,
    injectSystemPrompt: row.injectSystemPrompt,
    injectToolSections: row.injectToolSections,
    promptFilePath: row.promptFilePath,
  }
}

function textOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const text = String(value)
  return text === '' ? undefined : text
}

/** 列表读跳过损坏项时的告警（可追溯；不抛错以免整表不可用）。 */
function warnSkipped(kind: string, id: unknown, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error)
  console.warn(`[assets] 跳过损坏的${kind} ${String(id)}：${detail}`)
}
