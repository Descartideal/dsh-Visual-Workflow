// src/host/tools/wf-org-catalog/tool.ts
//
// wf_org_catalog 工具注册：父代理的「人才市场 + 现有资产」只读勘察。
//
// 调用模型（用户裁决）：只区分「传 ids / 不传 ids」——
//   - 不传（或空数组 / 空串）→ **资产索引**：组合（含工具清单）、官方 preset、模型与
//     思考强度、编排规则、角色模板索引、工作流模板索引，以及 ID 约定与召回指引；
//   - 传 ids → **批量详情**：`tpl-*` 工作流骨架 / `role-*` 角色完整 systemPrompt /
//     `<tpl-id>#<node-id>` 模板内联角色完整 systemPrompt；坏 id 只单条报错，不阻塞其余。
//
// 职责边界：本文件只做「注册 + 取数编排 + 错误归一」；返回体装配在 build.ts（纯函数），
// id 判定在 ids.ts（纯函数）。零写操作、幂等；不读运行实例（实例编排事实由运行期编排
// 指令提供，本工具只暴露工作流模板资产）。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用）。
import { WF_ORG_CATALOG } from '../../shared/protocol.js';
import { defineTool } from '../infrastructure/define-tool.js';
import { textRender } from '../infrastructure/text-render.js';
import { callerOf } from '../infrastructure/caller.js';
import { WfError } from '../../orchestrator/index.js';
import { buildIndex, buildInlineRoleDetail, buildRoleDetail, buildWorkflowDetail } from './build.js';
import { detailIdsLimitProblem, normalizeAssetIds, parseAssetId } from './ids.js';
/** 组装并执行一次勘察（导出供单测直接断言，无需起工具注册表）。 */
export async function executeOrgCatalog(host, args) {
    const ids = normalizeAssetIds(args?.ids);
    if (ids === null) {
        throw new WfError(`ids 必须是字符串数组（只看资产索引请省略该参数）——收到 ${JSON.stringify(args?.ids ?? null)}`, 'WF_BAD_ARGS');
    }
    const limitProblem = detailIdsLimitProblem(ids.length);
    if (limitProblem)
        throw new WfError(limitProblem, 'WF_BAD_ARGS');
    return ids.length === 0 ? await buildIndexFrom(host) : await buildDetailsFrom(host, ids);
}
/**
 * 索引取数。
 * 核心清单（角色模板 / 组合 / 工作流模板）读取失败**向上抛**——不伪装成「没有资产」，
 * 否则父代理会基于空目录做出错误编排；preset 与模型是可选目录，缺失或失败按空清单处理。
 */
async function buildIndexFrom(host) {
    const [roles, combos, templates] = await Promise.all([
        host.store.listTemplates('role'),
        host.store.listToolCombos(),
        host.store.listFlowTemplates(),
    ]);
    const presets = host.listPresets ? await host.listPresets().catch(() => []) : [];
    const models = host.listModels ? await host.listModels().catch(() => []) : [];
    return buildIndex({
        roles: roles,
        combos: combos,
        presets,
        models,
        templates,
    });
}
/**
 * 批量详情召回：逐条独立处理——形状非法 / 资产不存在 / 单条读失败都只记为该 id 的
 * error，绝不阻塞同批其余 id（用户裁决）。
 */
async function buildDetailsFrom(host, ids) {
    const assets = [];
    const errors = [];
    /** 角色模板清单延迟读取：本批没有 `role-*` 时不读盘。 */
    let roles = null;
    /** 模板按容器 id 缓存：同一模板的多个内联角色只读一次；已确认不存在也缓存。 */
    const templateCache = new Map();
    for (const id of ids) {
        const ref = parseAssetId(id);
        if (!ref.ok) {
            errors.push({ id, code: 'WF_BAD_ARGS', message: ref.reason });
            continue;
        }
        try {
            if (ref.kind === 'role') {
                roles = roles ?? (await host.store.listTemplates('role'));
                const role = roles.find((item) => String(item.id ?? '') === ref.id);
                if (!role) {
                    errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `角色模板不存在：${ref.id}` });
                    continue;
                }
                assets.push(buildRoleDetail(role));
                continue;
            }
            const containerId = ref.kind === 'workflow' ? ref.id : ref.containerId;
            const template = await loadTemplate(host, containerId, templateCache);
            if (!template) {
                errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `工作流模板不存在：${containerId}` });
                continue;
            }
            if (ref.kind === 'workflow') {
                assets.push(buildWorkflowDetail(template));
                continue;
            }
            const node = (template.nodes ?? []).find((item) => item.id === ref.nodeId);
            if (!node) {
                errors.push({ id, code: 'WF_ORG_NOT_FOUND', message: `工作流模板 ${containerId} 中不存在节点：${ref.nodeId}` });
                continue;
            }
            if (node.kind !== 'agent' && node.kind !== 'parent') {
                errors.push({
                    id,
                    code: 'WF_BAD_ARGS',
                    message: `节点 ${ref.nodeId} 是 ${node.kind}，没有 systemPrompt（只有 agent/parent 角色节点可召回）`,
                });
                continue;
            }
            assets.push(buildInlineRoleDetail({ containerId, node: node }));
        }
        catch (error) {
            errors.push({ id, code: errorCodeOf(error), message: messageOf(error) });
        }
    }
    return { kind: 'details', assets, errors };
}
/** 读取单个工作流模板（带批内缓存）。 */
async function loadTemplate(host, id, cache) {
    if (cache.has(id))
        return cache.get(id) ?? null;
    const template = await host.store.getFlowTemplate(id);
    cache.set(id, template);
    return template;
}
/** 单条读失败的稳定错误码（WfError 自带 code；其余按「取不到该资产」归类）。 */
function errorCodeOf(error) {
    const code = error?.code;
    return typeof code === 'string' && code ? code : 'WF_ORG_NOT_FOUND';
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * 注册 wf_org_catalog（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfOrgCatalog(ctx, host) {
    const tools = ctx.get('tools');
    if (!tools || typeof tools.register !== 'function') {
        throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_org_catalog');
    }
    const def = defineTool({
        name: WF_ORG_CATALOG,
        description: 'Read-only survey of the organization assets available for planning. Two call shapes: omit ids for the compact asset index (tool combos with their tool lists, official presets, provider/model plus reasoning-effort options, the orchestration rules, the role-template index, the workflow-template index, and the id convention); pass ids to recall details for those assets in one batch. '
            + 'Supported ids: tpl-* (workflow template → complete skeleton: stage nodes, roles, groups, lines and data-node bodies), role-* (role template → full systemPrompt plus its mapping fields), <tpl-id>#<node-id> (inline role inside that template → full systemPrompt). Bad or missing ids come back as per-item errors and never block the others. '
            + 'A node subagent\'s tools come ONLY from its presetId (a combo id from combos, or an official preset id), so picking presetId from this catalog is mandatory — an empty presetId means that node runs with zero tools. '
            + 'Role-node fields retryLimit / reactLimit / promptFilePath / injectSystemPrompt / injectToolSections are owned by the canvas UI: they are neither returned here nor settable through wf_graph_patch, so never pass them. '
            + 'The workflow skeleton intentionally omits role systemPrompts (the longest fields) — recall them by composite id when you need to reuse them. Idempotent and side-effect free; only the parent agent may call this, child agents are rejected (WF_NOT_ROOT).',
        parameters: {
            ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Asset ids to recall in detail; omit (or pass []) for the compact asset index. Supported: tpl-* (workflow template), role-* (role template), <tpl-id>#<node-id> (inline role inside that template). Bad ids come back as per-item errors and never block the others. At most 20 ids per call — submit further batches when needed.',
            },
        },
        output: {
            // 【关键】additionalProperties: true：宿主对工具返回体做 JSON Schema 校验时，
            // 未声明字段不应把成功调用变成错误（wf_graph_patch 曾因 false 导致三组 op 全废）。
            schema: {
                type: 'object',
                additionalProperties: true,
                description: 'kind="index": idConvention / detailHint / combos / presets / models / roles / templates / rules / truncated. kind="details": assets (workflow skeleton | role template | inline role) + errors (per-id failures that did not block the rest).',
            },
            render: textRender,
        },
        async execute(args, exec) {
            const caller = callerOf(exec);
            if (caller.isChild)
                throw new WfError('子代理无法调用 wf_org_catalog（仅当前会话主 Agent 可勘察组织资产）', 'WF_NOT_ROOT');
            if (!caller.sessionId)
                throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER');
            return executeOrgCatalog(host, (args ?? {}));
        },
    });
    return tools.register(def);
}
//# sourceMappingURL=tool.js.map