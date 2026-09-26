import type { CatalogDetails, CatalogIndex, CatalogModelSource, CatalogPresetSource } from './types.js';
import type { WorkflowTemplate } from '../../shared/graph-model.js';
/**
 * 工具层所需宿主能力（宿主 service 的最小结构适配；单测 fake）。
 *
 * 为什么不含运行态与工具开关：工作流实例与运行事实由运行期编排指令提供——父代理只允许
 * 改当前正在运行的实例，不通过本工具枚举实例；被全局关闭的工具在模型侧表现为
 * UNKNOWN_TOOL，全量关闭清单一来与编排决策无关，二来会吃掉大量上下文预算。
 */
export interface OrgCatalogHost {
    /** 数据层：角色模板 / 工具组合 / 工作流模板。 */
    store: {
        listTemplates(kind: 'role'): Promise<unknown[]>;
        listToolCombos(): Promise<unknown[]>;
        listFlowTemplates(): Promise<WorkflowTemplate[]>;
        getFlowTemplate(id: string): Promise<WorkflowTemplate | null>;
    };
    /** agent preset 目录（可选缝；缺失按空清单处理）。 */
    listPresets?: () => Promise<CatalogPresetSource[]>;
    /** 模型目录（可选缝；缺失按空清单处理）：节点 provider/model/reasoning 的取值来源。 */
    listModels?: () => Promise<CatalogModelSource[]>;
}
/** 组装并执行一次勘察（导出供单测直接断言，无需起工具注册表）。 */
export declare function executeOrgCatalog(host: OrgCatalogHost, args: Record<string, unknown>): Promise<CatalogIndex | CatalogDetails>;
/**
 * 注册 wf_org_catalog（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfOrgCatalog(ctx: {
    get(name: string): unknown;
}, host: OrgCatalogHost): () => void;
