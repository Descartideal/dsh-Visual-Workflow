import type { GraphNode, WorkflowDocument } from '../../shared/graph-model.js';
import type { GraphPatchOp, GraphPatchResult, MarkPatchOp, MarkPatchResult } from './types.js';
/**
 * 各图操作的「最小字段契约」（**单一事实源**）。
 *
 * 为什么放在这里而不是只写进工具描述（2026-09 实机取证）：
 *   模型写补丁时唯一能看到的事实源是工具 Schema，而 ops 是 `additionalProperties:true`
 *   的自由对象——描述里只举 create_node 一例时，模型对 connect 的端点字段只能猜
 *   （实测猜成 from/to，报「源节点不存在「」」）。契约文本同时供两处消费：
 *     ① wf_graph_patch 的 ops 描述（可发现性）；② 参数层错误消息（自我修正通道）。
 *   两处共用一份常量，避免文档与实现再次漂移。
 */
export declare const OP_FIELD_SHAPES: Record<string, string>;
/** 深拷贝文档骨架（保持元数据字段；节点/连线走 JSON 深拷贝避免共享引用）。 */
export declare function cloneDoc(doc: WorkflowDocument): WorkflowDocument;
/**
 * 协作组一致性：成员节点的 groupId 与组的 memberIds 双向对齐。
 * 入组：写 node.data.groupId；出组：置 null。组不存在或成员不存在 → 稳定错误。
 */
export declare function ensureGroupConsistency(nodes: GraphNode[], groupId: string, memberIds: string[]): GraphNode[];
/**
 * 角色节点默认重试上限（父代理不可配置；与画布新建角色节点保持一致）。
 */
export declare const DEFAULT_ROLE_RETRY_LIMIT = 3;
/**
 * 父代理**不可配置**的角色节点字段（画布属性栏所有；用户裁决）。
 *
 * 为什么：这五个字段属于运行治理与提示词注入范畴——retryLimit / reactLimit 影响重试与
 * ReAct 截停，promptFilePath 会把角色提示词指向宿主文件，injectSystemPrompt /
 * injectToolSections 决定官方系统提示词段与工具散文段的注入。父代理无法判断取值后果，
 * 因此一律不进入它的配置面：
 *   - create_node：剥离传入值，按系统默认写入；
 *   - update_node_data：剥离传入值，保留节点现值（用户手动改过的值不被覆盖）。
 * 注意：关闭注入开关只影响散文段与 assembly.contexts（工具调用能力由 tools[] 决定），
 * 且环境事实段（工作目录）不受该开关管辖。
 */
export declare const PARENT_UNCONFIGURABLE_ROLE_FIELDS: readonly ["retryLimit", "reactLimit", "promptFilePath", "injectSystemPrompt", "injectToolSections"];
/**
 * 创建路径的系统默认值（父代理传入的对应字段一律忽略）。
 * 官方人设/系统散文段对节点子代理没有价值，只会与角色提示词重复，故注入开关固定关闭；
 * 重试与 ReAct 上限取系统默认。
 */
export declare function applyRoleNodeCreateDefaults(raw: unknown): Record<string, unknown>;
/**
 * 角色节点 data 补全（图结构补丁的**唯一规范化入口**）。
 *
 * 为什么必须有（2026.09 实机取证）：ops 是自由对象，`create_node` 只把 raw 原样落盘，
 * 父代理最自然的写法 `{ kind:'agent', data:{ label, systemPrompt } }` 会产出
 * `presetId: undefined` 的节点——而运行期 `resolveAgentTools` 对空 presetId 的判定是
 * **零工具集**（连 read/write 都调不到），`provider/model` 为空也会退化成宿主默认。
 * 检查器与 validateFlow 都不校验节点 data 形状，于是这类「空壳节点」会一路落盘到运行期
 * 才暴露。补齐默认值与画布新建角色（graph/model.ts 的 newRoleNode）完全一致，
 * 保证「父代理建出来的节点」与「用户拖出来的节点」形状无差异。
 *
 * 语义：`null` 与 `undefined` 一律视为未提供（补默认）；显式 `''` / 数字 / 布尔原样保留。
 */
export declare function normalizeRoleNodeData(raw: unknown): Record<string, unknown>;
/**
 * 角色节点（agent / parent）的 data 字段契约文本（**单一事实源**；工具描述引用）。
 *
 * 为什么必须写进工具描述：ops 是自由对象，模型只能从描述推断节点 shape。
 * 2026.09 实机结论——不写契约时模型只会给 `{ label, systemPrompt }`，
 * 而 `presetId` 为空意味着该节点运行期**零工具**（resolveAgentTools 语义），
 * 且没有自动补全（补全只补形状，不会替模型组合）。
 */
export declare const ROLE_NODE_DATA_CONTRACT: string;
/**
 * 应用 A 组图结构操作（按序，纯函数）。
 * 失败一律抛 WfError（稳定 code），调用方据此返回带修复建议的补丁错误。
 */
export declare function applyGraphOps(input: {
    doc: WorkflowDocument;
    ops: GraphPatchOp[];
}): GraphPatchResult;
/**
 * 运行状态标记（C 组）纯函数：校验节点存在 + 闸门预算，给出标记结果。
 * 状态机分工（P3）：**「必须是当前闸门轮 / 当前闸门节点」由 runMarkGroup 判定**
 * （需要入口 entry 与解析后的画布），本函数只负责与单据无关的校验——
 * status 取值、节点是否在快照内、以及 status=ok 时的闸门预算（D-21：不含首次编排）。
 */
export declare function applyMarkOp(input: {
    op: MarkPatchOp;
    runId: string;
    nodeIds: string[];
    /** 已用闸门次数（P3 预算判定用；本轮由宿主缝给出 0）。 */
    milestoneUsed?: number;
    /** 元参数闸门上限（0 = 不限制）。 */
    milestoneMax?: number;
}): MarkPatchResult;
