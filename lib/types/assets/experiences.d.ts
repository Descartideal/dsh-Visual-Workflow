import type { ExperienceDraft, ExperienceEntry, ExperienceIndexEntry } from '../shared/asset-types.js';
import type { AssetTxContext } from './db.js';
import { type IdGeneratorDeps } from './ids.js';
/** 经验索引条目查询的默认上限保护（避免无上限全表拉取）。 */
export declare const EXPERIENCE_INDEX_MAX_LIMIT = 1000;
/** 端口运行环境：时钟与 id 生成由 AssetStore 注入。 */
export interface ExperiencePortContext {
    tx: AssetTxContext;
    now: () => number;
    ids: IdGeneratorDeps;
}
/** 批量插入结果（skipped 回传原因，便于调用方区分「空字段」与「重复」）。 */
export interface ExperienceInsertResult {
    inserted: ExperienceEntry[];
    skipped: Array<{
        insight: string;
        reason: string;
    }>;
}
/** 单条经验行插入（列顺序与 DDL 一致；返回经验 id）。 */
export declare function insertExperienceRow(ctx: ExperiencePortContext, draft: ExperienceDraft, reviewedAt: number): string;
/**
 * 批量插入（算法 I）：逐条判空与判重，跳过的回传原因，入库的读回完整条目。
 * 批内去重同样生效：同一批里出现两条相同 task_type + insight 时只入库第一条。
 */
export declare function insertExperienceDrafts(ctx: ExperiencePortContext, drafts: ExperienceDraft[], reviewedAt: number): ExperienceInsertResult;
/** 已存在同 task_type + insight 的经验（去重判据）。 */
export declare function experienceExists(ctx: AssetTxContext, taskType: string, insight: string): boolean;
/** 索引查询（按 created_at 倒序；id 升序兜底保证同毫秒写入的顺序确定）。 */
export declare function listExperienceIndexRows(ctx: AssetTxContext, limit: number): ExperienceIndexEntry[];
/** 详情查询（保持入参顺序，命中不到的略过）。 */
export declare function readExperiencesByIds(ctx: AssetTxContext, ids: string[]): ExperienceEntry[];
/** 空字段判定（trim 后为空即视为未提供）。 */
export declare function emptyFieldReason(draft: ExperienceDraft): string | null;
