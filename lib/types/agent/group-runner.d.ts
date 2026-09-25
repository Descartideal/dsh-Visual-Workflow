import type { FlowStore } from '../storage/flow-store.js';
import type { RoleNode } from '../shared/graph-model.js';
import type { GroupStartInput, GroupStartResult, OrchestratorLogger } from '../orchestrator/index.js';
import { type AgentTeamsServiceLike } from '../team/index.js';
import type { ChildPromptSetup } from './prompt-setup.js';
import type { ChildToolFilterSetup } from './child-tool-filter.js';
import type { ModelSelectionSetup } from './model-selection.js';
import type { AgentsServiceLike, SubagentsServiceLike, ToolsView } from './runner.js';
import type { ReactGuardBridge } from './guards.js';
/** 成员工具白名单解析入参（与节点路径同源，避免两套口径）。 */
export interface GroupMemberToolsInput {
    store: FlowStore;
    toolsView: ToolsView;
    sessionId: string;
    flowId: string;
    node: RoleNode;
    disabledTools?: ReadonlySet<string>;
    mode?: 'mode1' | 'mode2';
}
/** 协作组启动器依赖（纯函数经注入传入，避免与 runner 形成运行时循环依赖）。 */
export interface TeamGroupRunnerDeps {
    store: FlowStore;
    /** agents 服务惰性解析（取会话根 Agent 作为官方团队 Lead）。 */
    agents: () => AgentsServiceLike | null;
    /** subagents 服务惰性解析（provider 探测）。 */
    subagents: () => SubagentsServiceLike | null;
    /** 官方 Team 服务惰性解析；返回 null 即不可用，调用方回退逐节点路径。 */
    teams: () => AgentTeamsServiceLike | null;
    toolsView: ToolsView;
    /** 全局关闭工具快照（取值前由宿主保证已跨进程刷新）。 */
    toolSwitches?: () => ReadonlySet<string> | Promise<ReadonlySet<string>>;
    react: ReactGuardBridge;
    modelSelection: ModelSelectionSetup;
    toolFilter: ChildToolFilterSetup;
    promptSetup: ChildPromptSetup;
    logger?: OrchestratorLogger;
    /** 成员工具白名单解析（resolveAgentTools）。 */
    resolveTools: (input: GroupMemberToolsInput) => Promise<string[]>;
    /** 角色 Prompt 实际文本解析（resolveRolePrompt）。 */
    resolveRolePrompt: (node: RoleNode) => Promise<string>;
    /** 延续子代理 provider 探测（detectSubagentProvider）。 */
    detectProvider: (service: SubagentsServiceLike) => string | null;
    /** 子代理组成签名（nodeChildSignature）。 */
    signatureOf: (node: RoleNode, resolvedTools: string[], rolePrompt: string, injectSystemPrompt: boolean, injectToolSections: boolean, collabPrompt: string) => string;
}
/** 协作组启动器（官方 Team 路径；不可用时由调用方回退）。 */
export declare class TeamGroupRunner {
    private readonly deps;
    /**
     * 官方成员名 → 上次生效的组成签名。
     * 【释放路径】条目与团队成员一一对应（官方成员本身在会话内不可删除），
     * 名称数量有官方上限，随宿主持有的本对象一起回收。
     */
    private readonly memberSignatures;
    constructor(deps: TeamGroupRunnerDeps);
    /**
     * 官方 Team 路径是否可用（协作块文案与执行路径选择的唯一判据）。
     * 条件：官方服务可用 + 会话根 Agent 存活 + 存在可用的延续子代理 provider。
     */
    available(sessionId: string): boolean;
    /**
     * 启动整个协作组：逐个成员创建或复用官方 teammate，并派发本轮任务。
     *
     * @returns 成员启动结果；官方 Team 服务或根 Agent 不可用时返回 null（调用方回退）。
     * @throws 成员名已被失败成员占用、无可用 provider、官方未返回成员标识等可行动错误。
     */
    start(input: GroupStartInput): Promise<GroupStartResult | null>;
    /** 会话根 Agent（官方团队 Lead）：不存在即无法启动团队。 */
    private rootAgentOf;
    /**
     * 应用成员级组成：留存（供重发布重装）并登记本轮护栏上限。
     * 创建路径已在创建窗口内生效；复用路径下模型的后续请求与工具可见性由重发布重装补齐。
     */
    private applyMemberComposition;
    /** 记录成员组成签名（首次）。 */
    private rememberSignature;
    /**
     * 成员组成签名变化告警（不重建成员）。
     * 官方成员在创建时确定组成，同会话内无法重建；签名变化只能靠新建会话生效，
     * 因此这里只给出可行动诊断，不静默忽略。
     */
    private reportSignatureChange;
}
