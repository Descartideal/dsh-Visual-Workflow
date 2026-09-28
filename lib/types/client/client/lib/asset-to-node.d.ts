import type { RoleAssetDetail } from '../../host/shared/asset-types.js';
/** 角色资产详情 → 角色节点 data（与 templateToNodeData 的 role 分支同口径 + 来源资产 id）。 */
export declare function roleAssetToNodeData(detail: RoleAssetDetail): Record<string, unknown>;
/** 角色资产种类 → 画布节点 kind（parent / agent；与 RoleNode.kind 同域）。 */
export declare function roleAssetNodeKind(detail: RoleAssetDetail): 'parent' | 'agent';
