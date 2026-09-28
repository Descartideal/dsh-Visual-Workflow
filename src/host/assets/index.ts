// src/host/assets/index.ts
//
// 资产库公共入口：AssetStore（单文件 SQLite 资产库）与配套导出。
//
// 状态所有权：本模块是「资产（模版的晋升形态）」与「经验（复盘沉淀）」两个事实的唯一
// 所有者，磁盘文件固定 `<root>/assets.db`；调用方只经本入口读写，不得自行拼路径或建表。
// 依赖方向：只依赖 shared 的纯类型/协议常量与 Node 内置能力，不反向依赖 api/tools/client。

import type {
  AssetVersionEntry,
  AssetVersionSource,
  ExperienceDraft,
  ExperienceEntry,
  ExperienceIndexEntry,
  RoleAssetDetail,
  RoleAssetSummary,
  RoleAssetType,
  WorkflowAssetDetail,
  WorkflowAssetSummary,
} from '../shared/asset-types.js'
import type { GraphNode, Line, WorkflowMode } from '../shared/graph-model.js'
import type { OrgMeta } from '../shared/org-meta.js'
import type { RoleTemplate } from '../shared/template-types.js'
import { AssetDb } from './db.js'
import { assetNotFound, AssetError } from './errors.js'
import {
  insertExperienceDrafts,
  listExperienceIndexRows,
  readExperiencesByIds,
  type ExperienceInsertResult,
} from './experiences.js'
import { newRoleAssetId, newWorkflowAssetId, type IdGeneratorDeps } from './ids.js'
import {
  getRoleAssetDetail,
  getRoleAssetVersionDetail,
  listRoleAssets,
  promoteRoleVersion,
  readRoleVersionEntries,
  retireRoleAssetRow,
  rollbackRoleAssetTo,
  saveRoleAssetVersion,
} from './role-assets.js'
import {
  createWorkflowAsset,
  findWorkflowAssetByTemplate,
  getWorkflowAssetDetail,
  listWorkflowAssets,
  readWorkflowActive,
  readWorkflowVersionEntries,
  registerWorkflowVersion,
  retireWorkflowAssetRow,
  rollbackWorkflowAssetTo,
} from './workflow-assets.js'

export { AssetError } from './errors.js'
export type { AssetErrorCode } from './errors.js'
export { contentFingerprint, stableStringify } from './fingerprint.js'
export type { ExperienceInsertResult } from './experiences.js'
export { EXPERIENCE_INDEX_MAX_LIMIT } from './experiences.js'
export {
  EXPERIENCE_ID_PREFIX,
  ROLE_ASSET_ID_PREFIX,
  WORKFLOW_ASSET_ID_PREFIX,
  newExperienceId,
  newRoleAssetId,
  newWorkflowAssetId,
  versionRowId,
  type IdGeneratorDeps,
  type RandomSource,
} from './ids.js'
export { ASSET_DB_FILE } from './schema.js'

/** AssetStore 依赖：时钟与 id 生成（测试可确定化；缺省用系统实现）。 */
export interface AssetStoreDeps {
  /** 当前时间毫秒（缺省 Date.now）。 */
  now?: () => number
  /** id 生成依赖（随机源/时间/序号；缺省系统实现）。 */
  ids?: IdGeneratorDeps
}

/** 角色模版晋升入参。 */
export interface RolePromoteInput {
  templateId: string
  fingerprint: string
  role: RoleTemplate
  source: AssetVersionSource
}

/** 工作流模版晋升入参。 */
export interface WorkflowPromoteInput {
  templateId: string
  fingerprint: string
  mode: WorkflowMode
  name: string
  description: string
  nodes: GraphNode[]
  lines: Line[]
  meta?: OrgMeta
  source: AssetVersionSource
}

/** 角色资产态保存入参（登记新版本）。 */
export interface RoleSaveInput {
  assetId: string
  role: RoleTemplate
  source: AssetVersionSource
}

/** 工作流资产态保存入参。 */
export interface WorkflowSaveInput {
  assetId: string
  mode: WorkflowMode
  name: string
  description: string
  nodes: GraphNode[]
  lines: Line[]
  meta?: OrgMeta
  source: AssetVersionSource
}

/** 晋升/保存结果。 */
export interface AssetPromoteResult {
  assetId: string
  versionId: number
  rowId: string
  /** 内容与既有版本全等（或指纹短路）时为 true：未新增版本。 */
  unchanged: boolean
  /** 角色资产类型（角色晋升/保存返回；工作流路径不含单个角色类型）。 */
  roleAssetType?: RoleAssetType
  /** 本次操作中被合并为 shared 的角色资产 id（去重）。 */
  sharedRoleAssetIds: string[]
}

/**
 * 资产库（单文件 SQLite）。
 *
 * 读改写语义：每个公开写方法与读方法都在**一笔事务**内完成（进程内串行 + BEGIN IMMEDIATE），
 * 失败整体回滚，不留半成品。
 */
export class AssetStore {
  private readonly db: AssetDb
  private readonly now: () => number
  private readonly ids: IdGeneratorDeps
  private initialized = false

  constructor(root: string, deps: AssetStoreDeps = {}) {
    this.db = new AssetDb(root)
    this.now = deps.now ?? Date.now
    this.ids = deps.ids ?? {}
  }

  /** 打开库并幂等建表（重复调用无副作用）。 */
  async init(): Promise<void> {
    if (this.initialized) return
    try {
      await this.db.open()
    } catch (error) {
      // 打开/建表失败即关掉半开的连接，避免留下占用库文件的句柄
      this.db.close()
      throw error
    }
    this.initialized = true
  }

  /** 关闭连接（幂等；关闭后再次调用读接口会重新要求 init）。 */
  close(): void {
    this.db.close()
    this.initialized = false
  }

  // -------------------------------------------------------------------------
  // 角色资产
  // -------------------------------------------------------------------------

  /** 角色资产列表（Active 版本投影；currentTemplateFingerprint 由 API 边界填充）。 */
  listRoleAssets(): Promise<RoleAssetSummary[]> {
    return this.db.withTx((tx) => listRoleAssets(tx))
  }

  /** 角色资产详情（Active 版本）；不存在或已退役返回 null。 */
  getRoleAsset(assetId: string): Promise<RoleAssetDetail | null> {
    return this.db.withTx((tx) => getRoleAssetDetail(tx, assetId))
  }

  /**
   * 按角色版本行 id 取**该版本**详情；行不存在或资产已退役返回 null。
   * 用途：目录勘察把工作流资产里钉住的角色版本标注为可召回的 `role-*` 资产
   * （按钉住版本返回，不能读 Active，否则回滚后标注会撒谎）。
   */
  getRoleAssetVersion(roleRowId: string): Promise<RoleAssetDetail | null> {
    return this.db.withTx((tx) => getRoleAssetVersionDetail(tx, roleRowId))
  }

  /** 角色资产版本列表（版本号倒序）。 */
  listRoleVersions(assetId: string): Promise<AssetVersionEntry[]> {
    return this.db.withTx((tx) => readRoleVersionEntries(tx, assetId))
  }

  /** 回滚角色资产到指定版本（只改 Active 指针，不新增版本）。 */
  rollbackRoleAsset(assetId: string, versionId: number): Promise<RoleAssetDetail> {
    return this.db.withTx((tx) => rollbackRoleAssetTo({ tx, now: this.now }, assetId, versionId))
  }

  /** 退役角色资产（删 Active 行；历史保留）。 */
  async retireRoleAsset(assetId: string): Promise<void> {
    await this.db.withTx((tx) => retireRoleAssetRow(tx, assetId))
  }

  /** 角色模版晋升为资产（算法 C）。 */
  promoteRole(input: RolePromoteInput): Promise<AssetPromoteResult> {
    return this.db.withTx((tx) => {
      const result = promoteRoleVersion(
        { tx, now: this.now },
        {
          newAssetId: newRoleAssetId(this.ids),
          sourceTemplateId: input.templateId,
          fingerprint: input.fingerprint,
          role: input.role,
          source: input.source,
        },
      )
      return {
        assetId: result.assetId,
        versionId: result.versionId,
        rowId: result.rowId,
        unchanged: result.unchanged,
        roleAssetType: result.roleAssetType,
        sharedRoleAssetIds: result.sharedRoleAssetIds,
      }
    })
  }

  /** 资产态保存角色（算法 D：登记新版本）。 */
  saveRoleVersion(input: RoleSaveInput): Promise<AssetPromoteResult> {
    return this.db.withTx((tx) => {
      const result = saveRoleAssetVersion({ tx, now: this.now }, {
        assetId: input.assetId,
        role: input.role,
        source: input.source,
      })
      return {
        assetId: result.assetId,
        versionId: result.versionId,
        rowId: result.rowId,
        unchanged: result.unchanged,
        roleAssetType: result.roleAssetType,
        sharedRoleAssetIds: result.sharedRoleAssetIds,
      }
    })
  }

  // -------------------------------------------------------------------------
  // 工作流资产
  // -------------------------------------------------------------------------

  /** 工作流资产列表（Active 版本投影；currentTemplateFingerprint 由 API 边界填充）。 */
  listWorkflowAssets(): Promise<WorkflowAssetSummary[]> {
    return this.db.withTx((tx) => listWorkflowAssets(tx))
  }

  /** 工作流资产详情（Active 版本；角色节点已 join 回角色版本字段）。 */
  getWorkflowAsset(assetId: string): Promise<WorkflowAssetDetail | null> {
    return this.db.withTx((tx) => getWorkflowAssetDetail(tx, assetId))
  }

  /** 工作流资产版本列表（版本号倒序）。 */
  listWorkflowVersions(assetId: string): Promise<AssetVersionEntry[]> {
    return this.db.withTx((tx) => readWorkflowVersionEntries(tx, assetId))
  }

  /** 回滚工作流资产到指定版本（只改 Active 指针，不新增版本）。 */
  rollbackWorkflowAsset(assetId: string, versionId: number): Promise<WorkflowAssetDetail> {
    return this.db.withTx((tx) => rollbackWorkflowAssetTo({ tx, now: this.now }, assetId, versionId))
  }

  /** 退役工作流资产（删 Active 行；历史保留）。 */
  async retireWorkflowAsset(assetId: string): Promise<void> {
    await this.db.withTx((tx) => retireWorkflowAssetRow(tx, assetId))
  }

  /** 工作流模版晋升为资产（算法 E）。 */
  promoteWorkflow(input: WorkflowPromoteInput): Promise<AssetPromoteResult> {
    return this.db.withTx((tx) => {
      const ctx = { tx, now: this.now }
      const bound = findWorkflowAssetByTemplate(tx, input.templateId)
      const request = {
        assetId: bound?.assetId ?? newWorkflowAssetId(this.ids),
        mode: input.mode,
        name: input.name,
        description: input.description,
        nodes: input.nodes,
        lines: input.lines,
        meta: input.meta ?? null,
        source: input.source,
        sourceTemplateId: input.templateId,
        fingerprint: input.fingerprint,
        nextRoleAssetId: () => newRoleAssetId(this.ids),
      }
      const result = bound
        ? registerWorkflowVersion(ctx, { ...request, shortCircuitFingerprint: input.fingerprint })
        : createWorkflowAsset(ctx, request)
      return {
        assetId: result.assetId,
        versionId: result.versionId,
        rowId: result.rowId,
        unchanged: result.unchanged,
        sharedRoleAssetIds: result.sharedRoleAssetIds,
      }
    })
  }

  /** 资产态保存工作流（算法 E：登记新版本，来源绑定继承自被保存版本）。 */
  saveWorkflowVersion(input: WorkflowSaveInput): Promise<AssetPromoteResult> {
    return this.db.withTx((tx) => {
      const ctx = { tx, now: this.now }
      const active = readWorkflowActive(tx, input.assetId)
      if (!active) throw assetNotFound(input.assetId)
      // 资产态保存不改写来源绑定：入参无指纹，保留被保存 Active 行的来源模版与指纹，
      // 使「入库按钮锁定」判据不会被一次保存静默解锁；下一次晋升才刷新绑定
      return registerWorkflowVersion(ctx, {
        assetId: input.assetId,
        mode: input.mode,
        name: input.name,
        description: input.description,
        nodes: input.nodes,
        lines: input.lines,
        meta: input.meta ?? null,
        source: input.source,
        sourceTemplateId: active.sourceTemplateId,
        fingerprint: active.sourceFingerprint,
        shortCircuitFingerprint: null,
        nextRoleAssetId: () => newRoleAssetId(this.ids),
      })
    })
  }

  // -------------------------------------------------------------------------
  // 经验
  // -------------------------------------------------------------------------

  /** 经验索引（按 created_at 倒序，limit 条）。 */
  listExperienceIndex(limit: number): Promise<ExperienceIndexEntry[]> {
    return this.db.withTx((tx) => listExperienceIndexRows(tx, limit))
  }

  /** 经验详情（保持入参顺序，命中不到的略过）。 */
  getExperiences(ids: string[]): Promise<ExperienceEntry[]> {
    return this.db.withTx((tx) => readExperiencesByIds(tx, ids))
  }

  /**
   * 批量插入经验：空字段与重复 insight 跳过并回传原因，其余入库。
   * 整批在一笔事务内完成，任一条插入失败则整批回滚（不留下半批经验）。
   */
  insertExperiences(drafts: ExperienceDraft[], reviewedAt: number): Promise<ExperienceInsertResult> {
    return this.db.withTx((tx) => insertExperienceDrafts({ tx, now: this.now, ids: this.ids }, drafts, reviewedAt))
  }
}
