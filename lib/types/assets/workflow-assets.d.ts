import type { AssetVersionEntry, WorkflowAssetDetail, WorkflowAssetRoleRef, WorkflowAssetSummary } from '../shared/asset-types.js';
import type { GraphNode, Line, WorkflowMode } from '../shared/graph-model.js';
import type { OrgMeta } from '../shared/org-meta.js';
import type { AssetTxContext } from './db.js';
import { type RolePortContext } from './role-assets.js';
/** 节点壳：角色节点只保留结构字段，内容字段由角色版本行回填。 */
export interface NodeShell {
    id: string;
    kind: GraphNode['kind'];
    position: {
        x: number;
        y: number;
    };
    groupId?: string | null;
    sourceAssetId?: string;
}
/** 工作流资产版本行的内容字段（不含审计列）。 */
export interface WorkflowContentFields {
    mode: WorkflowMode;
    name: string;
    description: string;
    /** 节点壳数组；非角色节点为完整节点对象（晋升时已是快照）。 */
    nodeShells: NodeShell[];
    lines: Line[];
    meta: OrgMeta | null;
    roleVersionIds: WorkflowAssetRoleRef[];
}
/** 工作流资产版本行。 */
export interface WorkflowAssetRow extends WorkflowContentFields {
    id: string;
    versionId: number;
    assetId: string;
    retrievalContext: string | null;
    source: 'human' | 'agent';
    sourceRunId: string | null;
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    createdAt: number;
}
/** 工作流资产 Active 行。 */
export interface WorkflowAssetActiveRow {
    assetId: string;
    versionId: number;
    name: string;
    retrievalContext: string;
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    updatedAt: number;
}
/** 登记入参（AssetStore 组装；assetId 已解析、来源绑定已确定）。 */
export interface WorkflowWriteRequest {
    assetId: string;
    mode: WorkflowMode;
    name: string;
    description: string;
    nodes: GraphNode[];
    lines: Line[];
    meta: OrgMeta | null;
    source: 'human' | 'agent';
    sourceTemplateId: string | null;
    fingerprint: string | null;
    /** 幂等短路判据（仅晋升路径非空）：与 Active 行来源指纹相同即视为内容未变。 */
    shortCircuitFingerprint: string | null;
    /**
     * 新角色资产 id 生成器：**按需调用**（只有真正要新建内联资产时才取一个）。
     * 为什么不预分配整池：id 源是被消费的单调序列，预分配会让「本用例第几个资产」
     * 变得难以预测，也会在复用/去重路径上凭空消耗 id。
     */
    nextRoleAssetId: () => string;
}
/** 登记结果。 */
export interface WorkflowRegistration {
    assetId: string;
    versionId: number;
    rowId: string;
    unchanged: boolean;
    sharedRoleAssetIds: string[];
}
/** 工作流资产列表（Active 版本投影；单行损坏跳过并 warn，保证列表可用）。 */
export declare function listWorkflowAssets(ctx: AssetTxContext): WorkflowAssetSummary[];
/**
 * 工作流资产详情：Active 版本 + 节点壳按 role_version_ids join 回角色版本字段。
 * 壳与映射不一致（缺映射 / 引用行缺失）即抛带路径的错误：静默产半张图会让运行期
 * 拿到结构上无法执行的图，比直接失败更难排查。
 */
export declare function getWorkflowAssetDetail(ctx: AssetTxContext, assetId: string): WorkflowAssetDetail | null;
/** 工作流资产版本列表（版本号倒序）。 */
export declare function readWorkflowVersionEntries(ctx: AssetTxContext, assetId: string): AssetVersionEntry[];
/** 工作流资产 Active 行。 */
export declare function readWorkflowActive(ctx: AssetTxContext, assetId: string): WorkflowAssetActiveRow | null;
/** 按来源模版定位绑定资产（同一模版的二次晋升复用同一资产）。 */
export declare function findWorkflowAssetByTemplate(ctx: AssetTxContext, templateId: string): WorkflowAssetActiveRow | null;
/** 工作流版本行读取（JSON 列严格解析，损坏即抛错）。 */
export declare function readWorkflowVersionRow(ctx: AssetTxContext, assetId: string, versionId: number): WorkflowAssetRow | null;
/**
 * 回滚：只把 Active 指针移向目标版本（name / retrieval_context / 来源指纹同步），
 * 不新增版本、不改历史行。
 */
export declare function rollbackWorkflowAssetTo(ctx: RolePortContext, assetId: string, versionId: number): WorkflowAssetDetail;
/** 退役：删除 Active 行；历史行与其引用统计保留（审计与再次复用判定都依赖历史）。 */
export declare function retireWorkflowAssetRow(tx: AssetTxContext, assetId: string): void;
/** 工作流检索上下文 = id + name + description。 */
export declare function workflowRetrievalContext(assetId: string, name: string, description: string): string;
/** 首版登记：写入版本 1 并建立 Active 行（资产此前不存在）。 */
export declare function createWorkflowAsset(ctx: RolePortContext, request: Omit<WorkflowWriteRequest, 'shortCircuitFingerprint'>): WorkflowRegistration;
/**
 * 追加版本：先判幂等短路（来源指纹未变即不新增版本），再解析角色节点并写版本行。
 * 只在资产已存在（Active 行在）时调用。
 */
export declare function registerWorkflowVersion(ctx: RolePortContext, request: WorkflowWriteRequest): WorkflowRegistration;
