import type { RunReflectionFacts } from '../prompts/index.js';
import type { OrchestratorLogger, RootAgentLike, RootInjectedMessage } from './seams.js';
/** 注入文案的稳定来源标记（排障与审计用；注入文本内的锚点见 REFLECTION_MARKER）。 */
export declare const REFLECTION_MESSAGE_SOURCE = "visual-workflow-reflection";
/** 终态注入所需的最小运行事实（由快照派生；派生逻辑是纯函数，可单测）。 */
export interface RunReflectionFactsInput {
    /** runId。 */
    runId: string;
    /** 工作流名称（快照 flowName）。 */
    flowName: string;
    /** 快照终态（运行时守卫收窄：非三种注入态返回 null）。 */
    status: string;
    /** 开始时间（ISO 字符串，可能为空）。 */
    startedAt: string | null;
    /** 结束时间（ISO 字符串，可能为 null）。 */
    endedAt: string | null;
    /** 快照节点数。 */
    nodeCount: number;
    /** 系统语言名（可为空串 → 提示词按中文措辞）。 */
    systemLanguage?: string;
}
/**
 * 从快照事实派生复盘入参（纯函数）：
 *   - 非三种终态（running/paused/interrupted）返回 null —— paused/interrupted 可续跑，
 *     复盘由续跑后的终态触发；
 *   - 总耗时 = endedAt - startedAt；任一时间戳缺失或不可解析时为 null（渲染「不可计算」）。
 */
export declare function reflectionFactsOf(input: RunReflectionFactsInput): RunReflectionFacts | null;
/** 终态注入所需的宿主缝（编排器自身；单测可直接以 fake 装配）。 */
export interface ReflectionInjectionEnv {
    /** 日志（缺省由调用方提供 console 兜底）。 */
    logger: OrchestratorLogger;
    /** 系统语言名读取（缺省空串 → 提示词按中文措辞）。 */
    systemLanguage: () => string;
    /** 按会话取根 Agent（父代理）。 */
    getRootAgent: (sessionId: string) => RootAgentLike | null;
    /** 父代理空闲通道（steer 不可用时的唤醒注入）。 */
    followupRoot: (agent: RootAgentLike, message: RootInjectedMessage) => void;
    /** 消息 id 生成（缺省由调用方提供 randomUUID 兜底）。 */
    uuid: () => string;
    /** 告警前缀（区分两个结束点，便于排障）。 */
    warnPrefix: string;
}
/** 注入入参。 */
export interface InjectReflectionInput {
    /** 复盘事实（reflectionFactsOf 的产物，非 null）。 */
    facts: RunReflectionFacts;
    /** 归属会话（取父代理用）。 */
    sessionId: string;
    /** runId（日志用）。 */
    runId: string;
}
/**
 * 向父代理注入复盘指令。
 * 失败语义：根代理不存在、steer/followupRoot 抛错、通道不可用——一律只告警并返回 false，
 * 不阻断调用方的收尾与资源释放（与 notifyOrchestrationChange 同口径）。
 */
export declare function injectReflection(env: ReflectionInjectionEnv, input: InjectReflectionInput): boolean;
