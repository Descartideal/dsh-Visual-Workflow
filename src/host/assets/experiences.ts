// src/host/assets/experiences.ts
//
// 经验的写读端口：插入（含 insight 去重跳过）、索引查询、详情查询。
//
// 去重语义（用户裁决）：同一 task_type 下 insight 全等即视为重复——复盘在相似任务上
// 反复产出的同一句话不构成新知识，重复入库只污染召回结果，故跳过并回传原因。
// 匹配只按 task_type + insight，不看 evidence/task_context：同一句经验在不同上下文
// 中出现仍是同一知识。

import type { ExperienceDraft, ExperienceEntry, ExperienceIndexEntry } from '../shared/asset-types.js'
import type { AssetTxContext } from './db.js'
import { newExperienceId, type IdGeneratorDeps } from './ids.js'
import { requireAssetId, toInteger, toNullableText } from './role-check.js'

/** 经验索引条目查询的默认上限保护（避免无上限全表拉取）。 */
export const EXPERIENCE_INDEX_MAX_LIMIT = 1000

/** 端口运行环境：时钟与 id 生成由 AssetStore 注入。 */
export interface ExperiencePortContext {
  tx: AssetTxContext
  now: () => number
  ids: IdGeneratorDeps
}

/** 批量插入结果（skipped 回传原因，便于调用方区分「空字段」与「重复」）。 */
export interface ExperienceInsertResult {
  inserted: ExperienceEntry[]
  skipped: Array<{ insight: string; reason: string }>
}

/** 单条经验行插入（列顺序与 DDL 一致；返回经验 id）。 */
export function insertExperienceRow(ctx: ExperiencePortContext, draft: ExperienceDraft, reviewedAt: number): string {
  const id = newExperienceId(ctx.ids)
  const now = ctx.now()
  ctx.tx.run(
    `INSERT INTO experiences (
       id, source_run_id, reflection_prompt_version, task_type, task_context, insight, evidence,
       review_feedback, reviewed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      draft.sourceRunId ?? null,
      '1',
      draft.taskType,
      draft.taskContext,
      draft.insight,
      draft.evidence ?? null,
      null,
      reviewedAt,
      now,
      now,
    ],
  )
  return id
}

/**
 * 批量插入（算法 I）：逐条判空与判重，跳过的回传原因，入库的读回完整条目。
 * 批内去重同样生效：同一批里出现两条相同 task_type + insight 时只入库第一条。
 */
export function insertExperienceDrafts(
  ctx: ExperiencePortContext,
  drafts: ExperienceDraft[],
  reviewedAt: number,
): ExperienceInsertResult {
  const inserted: ExperienceEntry[] = []
  const skipped: Array<{ insight: string; reason: string }> = []
  const insertedKeys = new Set<string>()
  const insertedIds: string[] = []
  for (const draft of drafts) {
    const insight = typeof draft.insight === 'string' ? draft.insight : ''
    const missing = emptyFieldReason(draft)
    if (missing) {
      skipped.push({ insight, reason: missing })
      continue
    }
    const key = `${draft.taskType}\u0000${draft.insight}`
    if (insertedKeys.has(key) || experienceExists(ctx.tx, draft.taskType, draft.insight)) {
      skipped.push({
        insight,
        reason: `同 task_type 下已存在相同 insight（${draft.taskType}）：重复经验已跳过`,
      })
      continue
    }
    insertedKeys.add(key)
    insertedIds.push(insertExperienceRow(ctx, draft, reviewedAt))
  }
  if (insertedIds.length > 0) inserted.push(...readExperiencesByIds(ctx.tx, insertedIds))
  return { inserted, skipped }
}

/** 已存在同 task_type + insight 的经验（去重判据）。 */
export function experienceExists(ctx: AssetTxContext, taskType: string, insight: string): boolean {
  const row = ctx.get('SELECT 1 AS present FROM experiences WHERE task_type = ? AND insight = ? LIMIT 1', [
    taskType,
    insight,
  ])
  return row !== null
}

/** 索引查询（按 created_at 倒序；id 升序兜底保证同毫秒写入的顺序确定）。 */
export function listExperienceIndexRows(ctx: AssetTxContext, limit: number): ExperienceIndexEntry[] {
  const bounded = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 0), EXPERIENCE_INDEX_MAX_LIMIT) : 0
  if (bounded === 0) return []
  const rows = ctx.all('SELECT id, task_context FROM experiences ORDER BY created_at DESC, id ASC LIMIT ?', [bounded])
  return rows.map((row) => ({ id: String(row.id ?? ''), taskContext: String(row.task_context ?? '') }))
}

/** 详情查询（保持入参顺序，命中不到的略过）。 */
export function readExperiencesByIds(ctx: AssetTxContext, ids: string[]): ExperienceEntry[] {
  // 重复 id 不去重：SQL IN 本身按集合语义取值，再由 map 按入参顺序取回即可
  const wanted = ids.filter((id) => typeof id === 'string' && id !== '')
  if (wanted.length === 0) return []
  const placeholders = wanted.map(() => '?').join(', ')
  const rows = ctx.all(`SELECT * FROM experiences WHERE id IN (${placeholders})`, wanted)
  const byId = new Map(rows.map((row) => [String(row.id ?? ''), experienceRowToEntry(row)]))
  return wanted.map((id) => byId.get(id)).filter((entry): entry is ExperienceEntry => entry !== undefined)
}

/** 行 → 经验条目（可空列读成 undefined，与共享契约一致）。 */
function experienceRowToEntry(row: Record<string, unknown>): ExperienceEntry {
  const sourceRunId = toNullableText(row.source_run_id)
  const evidence = toNullableText(row.evidence)
  const reviewFeedback = toNullableText(row.review_feedback)
  const reviewedAt = row.reviewed_at === null || row.reviewed_at === undefined ? null : toInteger(row.reviewed_at, 0)
  return {
    id: requireAssetId(row.id, 'experiences.id'),
    ...(sourceRunId ? { sourceRunId } : {}),
    reflectionPromptVersion: toNullableText(row.reflection_prompt_version) ?? '1',
    taskType: String(row.task_type ?? ''),
    taskContext: String(row.task_context ?? ''),
    insight: String(row.insight ?? ''),
    ...(evidence ? { evidence } : {}),
    ...(reviewFeedback ? { reviewFeedback } : {}),
    ...(reviewedAt === null ? {} : { reviewedAt }),
    createdAt: toInteger(row.created_at, 0),
    updatedAt: toInteger(row.updated_at, 0),
  }
}

/** 空字段判定（trim 后为空即视为未提供）。 */
export function emptyFieldReason(draft: ExperienceDraft): string | null {
  const missing: string[] = []
  if (!isFilled(draft.insight)) missing.push('insight')
  if (!isFilled(draft.taskType)) missing.push('taskType')
  if (!isFilled(draft.taskContext)) missing.push('taskContext')
  if (missing.length === 0) return null
  return `缺少必填字段 ${missing.join('/')}：经验未入库`
}

function isFilled(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== ''
}
