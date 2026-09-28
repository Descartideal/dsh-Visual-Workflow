/** 复盘指令标题标记（父代理与单测据此识别消息性质；亦便于排障与用户识别）。 */
export declare const REFLECTION_MARKER = "\u3010\u590D\u76D8\u3011";
/** 提交经验候选的工具名（复盘中出现在指令正文里的唯一行动入口）。 */
export declare const REFLECTION_TOOL_NAME = "wf_experience";
/** 提示词中声明的候选经验条数上限（与 wf_experience 的运行时校验同口径）。 */
export declare const REFLECTION_MAX_EXPERIENCES = 8;
/** 复盘所需的最小运行事实（全部来自 run 快照，构建器不读运行态）。 */
export interface RunReflectionFacts {
    runId: string;
    flowName: string;
    /** 只在这三种终态注入；paused / interrupted（可续跑）不注入。 */
    status: 'completed' | 'failed' | 'stopped';
    /** startedAt→endedAt 的毫秒差；时间戳缺失或不可解析时为 null。 */
    durationMs: number | null;
    /** 快照 nodes.length（运行快照内的全部节点数）。 */
    nodeCount: number;
    /** 系统语言名（沿用仓库既有 systemLanguage 口径，可为空串）。 */
    systemLanguage?: string;
}
/**
 * 组装运行终态复盘指令（纯函数：同一入参输出字节相同）。
 * systemLanguage 为空串时按中文措辞（与插件默认中文界面一致）。
 */
export declare function buildReflectionPrompt(facts: RunReflectionFacts): string;
