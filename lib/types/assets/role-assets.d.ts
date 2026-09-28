import type { AssetVersionEntry, RoleAssetDetail, RoleAssetSummary, RoleAssetType } from '../shared/asset-types.js';
import type { RoleTemplate } from '../shared/template-types.js';
import type { AssetTxContext } from './db.js';
import { roleRowValues, type RoleAssetActiveRow, type RoleAssetRow, type RoleContentFields } from './row-codec.js';
/** 端口运行环境：时钟由 AssetStore 注入（测试可确定化）。 */
export interface RolePortContext {
    tx: AssetTxContext;
    now: () => number;
}
/** 登记结果（含类型与共享资产，供 AssetPromoteResult 组装）。 */
export interface RoleRegistration {
    assetId: string;
    versionId: number;
    rowId: string;
    unchanged: boolean;
    roleAssetType: RoleAssetType;
}
/** 晋升/保存入参（AssetStore 组装后传入）。 */
export interface RolePromoteRequest {
    /** 命中去重/绑定前预分配的新资产 id（仅真正新建时使用，保证调用方可用固定随机源测试）。 */
    newAssetId: string;
    /** 晋升路径的来源模版 id；资产态保存为 null（不覆盖既有绑定）。 */
    sourceTemplateId: string | null;
    fingerprint: string | null;
    role: RoleTemplate;
    source: 'human' | 'agent';
}
/** 晋升/保存结果（含被合并进 shared 的资产清单）。 */
export interface RoleWriteResult extends RoleRegistration {
    sharedRoleAssetIds: string[];
}
/** 角色版本行读取（无匹配返回 null）。 */
export declare function readRoleVersionRow(ctx: AssetTxContext, assetId: string, versionId: number): RoleAssetRow | null;
/** 是否处于未退役状态（Active 行存在）。 */
export declare function isRoleAssetLive(ctx: AssetTxContext, assetId: string): boolean;
/** 角色资产 Active 行（未退役资产必有；退役后为 null）。 */
export declare function readRoleActive(ctx: AssetTxContext, assetId: string): RoleAssetActiveRow | null;
/** 下一个版本号 = 该资产下 max(version_id) + 1。 */
export declare function nextRoleVersionId(ctx: AssetTxContext, assetId: string): number;
/**
 * 内容去重（算法 B）：`kind + system_prompt` 全等，匹配范围为**未退役资产的全部版本行**，
 * 命中时取版本号最大的那一行（用户看到的是该资产的最新内容）。
 * 已退役资产不参与匹配：用户已明确将其移出复用面，再次晋升应产出新资产。
 */
export declare function findRoleVersionByContent(ctx: AssetTxContext, fields: RoleContentFields): {
    assetId: string;
    versionId: number;
    row: RoleAssetRow;
} | null;
/** 新建角色资产（版本 1）：写入历史行与 Active 行。 */
export declare function createRoleAsset(ctx: RolePortContext, input: {
    assetId: string;
    fields: RoleContentFields;
    roleAssetType: RoleAssetType;
    source: 'human' | 'agent';
    /** 预分配版本号（新建恒为 1；保留参数与 addRoleVersion 同构）。 */
    versionId?: number;
    /**
     * 来源模版绑定与指纹（仅「角色模版晋升」路径携带）。
     * 工作流内联角色新建的 inline 资产不带绑定：它不由模版直接晋升，
     * 带上绑定会让「跳转来源模版」指向一个并非其来源的模版。
     */
    sourceTemplateId?: string | null;
    sourceFingerprint?: string | null;
}): RoleRegistration;
/**
 * 在既有资产下登记新版本并移动 Active 指针。
 * `inheritSource`: 来源绑定与指纹的继承值（晋升路径取来源模版，保存路径取被保存的 Active 行）。
 * `previousRow`: 被保存的 Active 版本行（调用方已读取时传入，避免重复回表；
 * 缺省时自行读取，语义相同）。
 */
export declare function addRoleVersion(ctx: RolePortContext, input: {
    assetId: string;
    fields: RoleContentFields;
    roleAssetType: RoleAssetType;
    source: 'human' | 'agent';
    inheritSource: {
        sourceTemplateId: string | null;
        sourceFingerprint: string | null;
    };
    previousRow?: RoleAssetRow | null;
    /** 预分配版本号（调用方已解析时传入，避免二次计算）；缺省为 max+1。 */
    versionId?: number;
}): RoleRegistration;
/** 追加引用（引用统计专用）：把工作流版本行 id 去重追加，并同步 reference_status。 */
export declare function appendRoleReference(ctx: RolePortContext, rowId: string, workflowRowId: string): void;
/** 引用列表长度（用于「被两个以上工作流版本引用即升 shared」判定）。 */
export declare function referenceCount(ctx: AssetTxContext, rowId: string): number;
/** 版本行的当前类型（可能与该资产 Active 版本不同：类型只随被引用/被合并的那一行变化）。 */
export declare function roleVersionType(ctx: AssetTxContext, rowId: string): RoleAssetType | null;
/**
 * 把版本行升为 shared，并刷新其 updated_at。
 * 为什么只改这一行：其他历史版本的类型描述「它当时是否共享」，回滚到旧版本不应携带
 * 新版本的共享事实；而 Active 行若正指向该行，则随之一致（同一行）。
 */
export declare function markRoleVersionShared(ctx: RolePortContext, rowId: string): void;
/**
 * 角色资产列表（Active 版本投影）。
 * 列表读语义：单行损坏（JSON 非法/缺列）跳过该条并 warn，保证列表仍可用。
 */
export declare function listRoleAssets(ctx: AssetTxContext): RoleAssetSummary[];
/** 角色资产详情（Active 版本）。resource 缺失返回 null，损坏抛可诊断错误。 */
export declare function getRoleAssetDetail(ctx: AssetTxContext, assetId: string): RoleAssetDetail | null;
/**
 * 按角色版本行 id（`<assetId>@<versionId>`）取**该版本**的角色资产详情。
 *
 * 与 getRoleAssetDetail 的区别：后者读 Active 版本，回滚或升版后会指到别的版本——目录把
 * 工作流资产里钉住的角色版本标注为可召回的 `role-*` 资产时，必须按钉住版本返回，否则标注的
 * 版本号与内容会撒谎。版本行 id 形状非法 / 行不存在 / 资产已退役（Active 行缺失）返回 null。
 */
export declare function getRoleAssetVersionDetail(ctx: AssetTxContext, roleRowId: string): RoleAssetDetail | null;
/** 角色资产版本列表（按版本号倒序，最新在前）。 */
export declare function readRoleVersionEntries(ctx: AssetTxContext, assetId: string): AssetVersionEntry[];
/**
 * 回滚：只把 Active 指针移向目标版本（含 name / retrieval_context / 来源指纹的同步），
 * 不新增版本、不改历史行——历史内容不可变是回滚语义的前提。
 */
export declare function rollbackRoleAssetTo(ctx: RolePortContext, assetId: string, versionId: number): RoleAssetDetail;
/** 退役：删除 Active 行（历史与其引用统计保留，供审计与再次复用判定）。 */
export declare function retireRoleAssetRow(tx: AssetTxContext, assetId: string): void;
/**
 * 角色晋升（算法 C）：
 *   1. 已有 Active 且绑定同一来源模版 → 走该资产的新版本路径（内容全等即 unchanged）；
 *   2. 否则内容去重：standalone 冲突直接拦截；inline/shared 冲突则合并（类型升 shared，不建新资产）；
 *   3. 均未命中 → 新建 standalone 资产（版本 1）。
 */
export declare function promoteRoleVersion(ctx: RolePortContext, request: RolePromoteRequest): RoleWriteResult;
/**
 * 资产态保存（算法 D）：登记新版本，来源绑定与指纹**继承**自被保存的 Active 版本
 * （保存不改写来源模版事实，只有晋升会刷新它）。
 */
export declare function saveRoleAssetVersion(ctx: RolePortContext, input: {
    assetId: string;
    role: RoleTemplate;
    source: 'human' | 'agent';
}): RoleWriteResult;
/**
 * 历史行插入（导出给工作流写路径复用：角色节点升版与角色资产升版必须落同一份列映射，
 * 否则两条路径的行形状会漂移）。
 */
export declare function insertRoleVersionRow(tx: AssetTxContext, values: ReturnType<typeof roleRowValues>): void;
/** Active 行插入或替换（asset_id 主键，指针语义；导出给工作流写路径复用）。 */
export declare function writeRoleActiveRow(tx: AssetTxContext, values: {
    assetId: string;
    versionId: number;
    name: string;
    retrievalContext: string;
    sourceTemplateId: string | null;
    sourceFingerprint: string | null;
    updatedAt: number;
}): void;
/** 版本行 → 详情契约（不读模版，currentTemplateFingerprint 由 API 边界填充）。 */
export declare function roleAssetRowToDetail(row: RoleAssetRow): RoleAssetDetail;
