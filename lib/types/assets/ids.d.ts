/** 随机源：返回 [0, 1) 区间浮点数（缺省 Math.random）。 */
export type RandomSource = () => number;
/** id 生成依赖（可注入，测试确定化）。 */
export interface IdGeneratorDeps {
    /** 随机源（缺省 Math.random）；返回 [0, 1) 区间浮点数。 */
    random?: RandomSource;
    /** 单调序号（缺省自增计数器；跨进程不保证唯一，故与随机源共同参与）。 */
    sequence?: () => number;
}
/** 角色资产逻辑 id 前缀（跨版本不变的身份标识）。 */
export declare const ROLE_ASSET_ID_PREFIX = "role-";
/** 工作流资产逻辑 id 前缀。 */
export declare const WORKFLOW_ASSET_ID_PREFIX = "flow-";
/** 经验 id 前缀。 */
export declare const EXPERIENCE_ID_PREFIX = "ex-";
/** 新建角色资产逻辑 id（`role-` 前缀）。 */
export declare function newRoleAssetId(deps?: IdGeneratorDeps): string;
/** 新建工作流资产逻辑 id（`flow-` 前缀）。 */
export declare function newWorkflowAssetId(deps?: IdGeneratorDeps): string;
/** 新建经验 id（`ex-` 前缀）。 */
export declare function newExperienceId(deps?: IdGeneratorDeps): string;
/**
 * 版本行 id：`<asset_id>@<version_id>`。
 * 工作流版本行按此 id 反向引用角色版本行，因此格式是对外契约的一部分。
 */
export declare function versionRowId(assetId: string, versionId: number): string;
