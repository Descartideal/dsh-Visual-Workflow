import type { AssetKind, AssetVersionEntry, RoleAssetDetail, RoleAssetSummary, WorkflowAssetDetail, WorkflowAssetSummary } from '../shared/asset-types.js';
import { VisualWorkflowApiBase, type ApiHost } from './boundary.js';
/** 资产库能力缝（形状由 boundary 的宿主能力缝定义，本模块不自建第二份）。 */
type Assets = NonNullable<ApiHost['assets']>;
/** 入库/保存的领域出参：直接取自能力缝签名，避免端点与资产库各写一份形状。 */
type AssetPromoteResult = Awaited<ReturnType<Assets['promoteRole']>>;
export declare class AssetEndpoints extends VisualWorkflowApiBase {
    listAssets(args: {
        kind?: unknown;
    }): Promise<{
        workflows: WorkflowAssetSummary[];
        roles: RoleAssetSummary[];
    }>;
    getAsset(args: {
        kind?: unknown;
        assetId?: unknown;
    }): Promise<WorkflowAssetDetail | RoleAssetDetail>;
    promoteAsset(args: {
        kind?: unknown;
        templateId?: unknown;
    }): Promise<AssetPromoteResult>;
    /** 角色模版入库：模版内容整体作为首个资产版本的来源。 */
    private promoteRoleTemplate;
    /** 工作流模版入库：模版图整体作为首个资产版本的来源（meta 缺省不落约束）。 */
    private promoteWorkflowTemplate;
    saveAssetVersion(args: {
        kind?: unknown;
        assetId?: unknown;
        payload?: unknown;
    }): Promise<AssetPromoteResult>;
    listAssetVersions(args: {
        kind?: unknown;
        assetId?: unknown;
    }): Promise<AssetVersionEntry[]>;
    rollbackAsset(args: {
        kind?: unknown;
        assetId?: unknown;
        versionId?: unknown;
    }): Promise<WorkflowAssetDetail | RoleAssetDetail>;
    retireAsset(args: {
        kind?: unknown;
        assetId?: unknown;
    }): Promise<{
        kind: AssetKind;
        assetId: string;
        retired: true;
    }>;
}
export {};
