import { type OrchestratorRuntime } from '../../orchestrator/index.js';
import type { ExperienceDraft, ExperienceEntry } from '../../shared/asset-types.js';
/** 单次调用允许提交的候选经验条数上限（运行时校验；schema 不使用官方子集外的 maxItems）。 */
export declare const MAX_EXPERIENCE_DRAFTS = 8;
/** 入参里的一条候选经验（字段名与复盘指令一致；未知字段宽松忽略）。 */
interface ExperienceDraftInput {
    taskType: string;
    taskContext: string;
    insight: string;
    evidence?: string;
    sourceRunId?: string;
}
/** 卡片回传的用户补充意见（按 label 对应到入选候选）。 */
interface ExperienceFeedback {
    label: string;
    custom: string;
}
/**
 * 工具层所需宿主能力（宿主组合根装配；单测 fake）。
 * assets 只依赖 insertExperiences 一个方法签名（AssetStore 的真实实现），不复制其完整接口。
 * orchestrator 为可选缝：存在时用于触碰空闲基准与组合运行取消信号（终态后通常已无活跃 run）。
 */
export interface WfExperienceHost {
    assets: {
        insertExperiences(drafts: ExperienceDraft[], reviewedAt: number): Promise<{
            inserted: ExperienceEntry[];
            skipped: Array<{
                insight: string;
                reason: string;
            }>;
        }>;
    };
    getRootAgent(sessionId: string): {
        id: string;
    } | null;
    orchestrator?: OrchestratorRuntime;
    /** 时钟注入（缺省 Date.now）：reviewedAt 的确定性来源。 */
    now?: () => number;
}
/**
 * 参数校验与候选归并（纯函数）。
 * 形状非法 / 条数为 0 / 超上限 / 任一必填字段为空 → WfError(WF_BAD_ARGS)，错误信息说明怎么改。
 */
export declare function normalizeExperienceDrafts(raw: unknown): ExperienceDraftInput[];
/**
 * 同 task_type + insight 归并（纯函数；保序，先出现的保留其 task_context）。
 * evidence 用换行拼接（去重后），source_run_id 取先出现的非空值。
 */
export declare function mergeExperienceDrafts(drafts: ExperienceDraftInput[]): ExperienceDraftInput[];
/**
 * 从卡片回传的答案里取出「被选中的 label」与「按 label 对应的补充意见」（纯函数）。
 * 卡片协议：selected 为选中的 label 文本列表，custom 为自由输入（用户补充的修改意见）。
 */
export declare function selectionsFrom(answers: unknown[]): {
    selected: string[];
    feedback: ExperienceFeedback[];
};
/**
 * 注册 wf_experience（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfExperience(ctx: {
    get(name: string): unknown;
}, host: WfExperienceHost): () => void;
export {};
