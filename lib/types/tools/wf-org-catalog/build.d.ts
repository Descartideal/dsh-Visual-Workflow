import type { CatalogIndex, CatalogInlineRoleDetail, CatalogModelSource, CatalogPresetSource, CatalogRoleDetail, CatalogWorkflowDetail } from './types.js';
import type { RoleNode, WorkflowTemplate } from '../../shared/graph-model.js';
/** 索引里的召回指引：目录是候选清单而非全部内容，详情按 ids 召回。 */
export declare const DETAIL_HINT: string;
/** 骨架返回体里的提示：角色提示词走复合 id 按需召回。 */
export declare const WORKFLOW_DETAIL_NOTE = "nodes \u4E2D\u89D2\u8272\u8282\u70B9\uFF08kind=agent|parent\uFF09\u7684 systemPrompt \u672A\u5305\u542B\uFF1A\u6309 inlineRoles \u91CC\u7684\u590D\u5408 id \u9010\u4E2A\u53EC\u56DE\u3002";
/** 文本截断（空白压缩 + 超限标注，供角色摘要等短字段使用）。 */
export declare function clip(value: unknown, limit: number): string;
/** 组装资产索引（第一次调用）。 */
export declare function buildIndex(input: {
    roles: Array<Record<string, unknown>>;
    combos: Array<Record<string, unknown>>;
    presets: CatalogPresetSource[];
    models: CatalogModelSource[];
    templates: WorkflowTemplate[];
}): CatalogIndex;
/** 组装工作流骨架（`tpl-*` 的返回体）。 */
export declare function buildWorkflowDetail(template: WorkflowTemplate): CatalogWorkflowDetail;
/** 组装角色模板详情（systemPrompt 完整返回，不截断）。 */
export declare function buildRoleDetail(role: Record<string, unknown>): CatalogRoleDetail;
/** 组装模板内联角色详情（标明所属工作流与节点，避免多角色召回时混淆）。 */
export declare function buildInlineRoleDetail(input: {
    containerId: string;
    node: RoleNode;
}): CatalogInlineRoleDetail;
/**
 * 数据库连接脱敏：密钥字段替换为占位符，其余字段原样保留（保证模板可复用）。
 * 为什么必须脱敏：连接信息没有二次召回通道，必须一次性给出；而密码一旦进入模型
 * 上下文与对话历史就无法收回。
 */
export declare function maskConnection(conn: unknown): Record<string, unknown> | undefined;
