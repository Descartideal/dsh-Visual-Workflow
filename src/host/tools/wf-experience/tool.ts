// src/host/tools/wf-experience/tool.ts
//
// wf_experience 工具注册（父代理复盘后的经验入库入口）：
//   父代理完成运行终态复盘后，把候选经验（0~8 条）交给本工具；本工具借用官方
//   userQuestions.ask 渲染**多选卡片**，用户勾选的候选在一次调用内**原子入库**
//   （AssetStore.insertExperiences），并把卡片里的补充修改意见写入入选条目的
//   review_feedback（source 恒为 human —— 经验入库只允许人类触发）。
//
// 职责边界：
//   - 本文件只做「注册 + 身份校验 + 参数校验与归并 + 卡片调用 + 入库」；
//     经验库的持久化与去重语义归 AssetStore（宿主注入的能力缝），本层不落盘；
//   - 工具之间解耦：不调用任何其它 Tool 的注册/执行函数。
//
// label 唯一性（为什么要按 task_type+insight 先归并）：
//   官方卡片把用户选择回传为 **label 文本**，故每个候选必须对应唯一的 label。
//   同 task_type + insight 的候选语义相同（同一条经验的重复表述），此处先归并成一条
//   （evidence 用换行拼接），保证 label 与候选一一对应，避免用户勾选一条却入库两条。
//
// 提示词规范：description 与参数说明使用官方标准英文（W-03），第一句写明「何时调用」，
// 随后是前置条件/失败语义（WF_* 稳定错误码）/副作用（渲染阻塞卡片并写经验库）。

import { WF_EXPERIENCE } from '../../shared/protocol.js'
import { WfError, type OrchestratorRuntime } from '../../orchestrator/index.js'
import type { ExperienceDraft, ExperienceEntry } from '../../shared/asset-types.js'
import { callerOf } from '../infrastructure/caller.js'
import { defineTool, type ToolDefinitionLike, type ToolExecLike } from '../infrastructure/define-tool.js'
import { textRender } from '../infrastructure/text-render.js'

/** 单次调用允许提交的候选经验条数上限（运行时校验；schema 不使用官方子集外的 maxItems）。 */
export const MAX_EXPERIENCE_DRAFTS = 8

/** 卡片选项 description 里 task_context 的截断长度（卡片一行放得下即可）。 */
const TASK_CONTEXT_IN_CARD_LIMIT = 60

/** 卡片问句缺省文案。 */
const DEFAULT_EXPERIENCE_QUESTION = '请选择要入库的经验（可多选）'

/** 卡片缺省表头。 */
const DEFAULT_EXPERIENCE_HEADER = '经验入库'

/** 入参里的一条候选经验（字段名与复盘指令一致；未知字段宽松忽略）。 */
interface ExperienceDraftInput {
  taskType: string
  taskContext: string
  insight: string
  evidence?: string
  sourceRunId?: string
}

/** 卡片候选（label 唯一；label 即 insight，作为用户选择的回传标识）。 */
interface ExperienceCandidate {
  draft: ExperienceDraftInput
  label: string
}

/** 卡片回传的用户补充意见（按 label 对应到入选候选）。 */
interface ExperienceFeedback {
  label: string
  custom: string
}

/** 待入库草稿（AssetStore 的 ExperienceDraft + 卡片补充意见）。 */
type ExperienceDraftWithFeedback = ExperienceDraft & { reviewFeedback?: string }

/**
 * 工具层所需宿主能力（宿主组合根装配；单测 fake）。
 * assets 只依赖 insertExperiences 一个方法签名（AssetStore 的真实实现），不复制其完整接口。
 * orchestrator 为可选缝：存在时用于触碰空闲基准与组合运行取消信号（终态后通常已无活跃 run）。
 */
export interface WfExperienceHost {
  assets: {
    insertExperiences(
      drafts: ExperienceDraft[],
      reviewedAt: number,
    ): Promise<{ inserted: ExperienceEntry[]; skipped: Array<{ insight: string; reason: string }> }>
  }
  getRootAgent(sessionId: string): { id: string } | null
  orchestrator?: OrchestratorRuntime
  /** 时钟注入（缺省 Date.now）：reviewedAt 的确定性来源。 */
  now?: () => number
}

/** userQuestions 服务最小结构（官方 ask 契约；与 wf_ask 同口径）。 */
interface UserQuestionsServiceLike {
  ask(request: {
    questions: unknown[]
    agent?: unknown
    signal?: AbortSignal
  }): Promise<{ answers?: unknown[] }>
}

/** 非空字符串归一（缺失/非字符串 → 空串）。 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 候选归并键（task_type + insight：与 AssetStore 的去重口径一致）。 */
function candidateKeyOf(draft: ExperienceDraftInput): string {
  return `${draft.taskType}\u0000${draft.insight}`
}

/** 卡片选项 description：粗粒度任务类型 + 截断后的语义上下文。 */
function optionDescriptionOf(draft: ExperienceDraftInput): string {
  const context = draft.taskContext.length > TASK_CONTEXT_IN_CARD_LIMIT
    ? `${draft.taskContext.slice(0, TASK_CONTEXT_IN_CARD_LIMIT)}…`
    : draft.taskContext
  return `${draft.taskType}｜${context}`
}

/**
 * 参数校验与候选归并（纯函数）。
 * 形状非法 / 条数为 0 / 超上限 / 任一必填字段为空 → WfError(WF_BAD_ARGS)，错误信息说明怎么改。
 */
export function normalizeExperienceDrafts(raw: unknown): ExperienceDraftInput[] {
  if (!Array.isArray(raw)) {
    throw new WfError(
      'wf_experience 需要 experiences 数组：[{ task_type, task_context, insight, evidence?, source_run_id? }]',
      'WF_BAD_ARGS',
    )
  }
  if (raw.length === 0) {
    throw new WfError(
      'wf_experience 的 experiences 不能为空数组：复盘后没有值得沉淀的经验时，直接结束复盘、不要调用本工具',
      'WF_BAD_ARGS',
    )
  }
  if (raw.length > MAX_EXPERIENCE_DRAFTS) {
    throw new WfError(
      `wf_experience 一次最多提交 ${MAX_EXPERIENCE_DRAFTS} 条候选经验（收到 ${raw.length} 条）：请合并同类经验后分批提交`,
      'WF_BAD_ARGS',
    )
  }
  const out: ExperienceDraftInput[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index] as Record<string, unknown> | null | undefined
    if (!item || typeof item !== 'object') {
      throw new WfError(`experiences[${index}] 必须是对象 { task_type, task_context, insight }`, 'WF_BAD_ARGS')
    }
    const taskType = textOf(item.task_type)
    const taskContext = textOf(item.task_context)
    const insight = textOf(item.insight)
    const missing: string[] = []
    if (!taskType) missing.push('task_type（粗粒度任务类型，如「软件开发」）')
    if (!taskContext) missing.push('task_context（可用于语义检索的自然语言上下文）')
    if (!insight) missing.push('insight（单句经验结论）')
    if (missing.length > 0) {
      throw new WfError(`experiences[${index}] 缺少必填字段：${missing.join('、')}`, 'WF_BAD_ARGS')
    }
    const evidence = textOf(item.evidence)
    const sourceRunId = textOf(item.source_run_id)
    out.push({
      taskType,
      taskContext,
      insight,
      ...(evidence ? { evidence } : {}),
      ...(sourceRunId ? { sourceRunId } : {}),
    })
  }
  return out
}

/**
 * 同 task_type + insight 归并（纯函数；保序，先出现的保留其 task_context）。
 * evidence 用换行拼接（去重后），source_run_id 取先出现的非空值。
 */
export function mergeExperienceDrafts(drafts: ExperienceDraftInput[]): ExperienceDraftInput[] {
  const byKey = new Map<string, ExperienceDraftInput & { evidenceParts: string[] }>()
  const order: string[] = []
  for (const draft of drafts) {
    const key = candidateKeyOf(draft)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...draft, evidenceParts: draft.evidence ? [draft.evidence] : [] })
      order.push(key)
      continue
    }
    if (draft.evidence && !existing.evidenceParts.includes(draft.evidence)) {
      existing.evidenceParts.push(draft.evidence)
    }
    if (!existing.sourceRunId && draft.sourceRunId) existing.sourceRunId = draft.sourceRunId
  }
  return order.map((key) => {
    const merged = byKey.get(key)!
    const { evidenceParts, ...rest } = merged
    return evidenceParts.length > 0 ? { ...rest, evidence: evidenceParts.join('\n') } : rest
  })
}

/** 由归并后的候选构造卡片选项与打分依据（label = insight）。 */
function candidatesOf(drafts: ExperienceDraftInput[]): ExperienceCandidate[] {
  return drafts.map((draft) => ({ draft, label: draft.insight }))
}

/**
 * 从卡片回传的答案里取出「被选中的 label」与「按 label 对应的补充意见」（纯函数）。
 * 卡片协议：selected 为选中的 label 文本列表，custom 为自由输入（用户补充的修改意见）。
 */
export function selectionsFrom(answers: unknown[]): { selected: string[]; feedback: ExperienceFeedback[] } {
  const selected: string[] = []
  const feedback: ExperienceFeedback[] = []
  for (const item of answers) {
    const answer = item as { selected?: unknown; custom?: unknown } | null | undefined
    if (!answer || typeof answer !== 'object') continue
    const labels = Array.isArray(answer.selected) ? answer.selected : []
    const picked: string[] = []
    for (const label of labels) {
      const text = textOf(label)
      if (!text || selected.includes(text)) continue
      selected.push(text)
      picked.push(text)
    }
    const custom = textOf(answer.custom)
    if (custom) for (const label of picked) feedback.push({ label, custom })
  }
  return { selected, feedback }
}

/** 把「选中候选 + 补充意见」落成待入库草稿。 */
function draftsOf(selected: ExperienceCandidate[], feedback: ExperienceFeedback[]): ExperienceDraftWithFeedback[] {
  return selected.map((candidate) => {
    const comments = feedback.filter((item) => item.label === candidate.label).map((item) => item.custom)
    return {
      taskType: candidate.draft.taskType,
      taskContext: candidate.draft.taskContext,
      insight: candidate.draft.insight,
      ...(candidate.draft.evidence ? { evidence: candidate.draft.evidence } : {}),
      ...(candidate.draft.sourceRunId ? { sourceRunId: candidate.draft.sourceRunId } : {}),
      // 卡片补充意见写入所有入选条目（用户对本次复盘的修改意见对每条都成立）
      ...(comments.length > 0 ? { reviewFeedback: comments.join('\n') } : {}),
    }
  })
}

/** 卡片取消/关闭的错误归一（与 wf_ask 同口径：官方 ASK_ABORTED 或 abort 语义消息）。 */
function cancelledWfError(error: unknown): WfError | null {
  const code = (error as { code?: string })?.code ?? ''
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'ASK_ABORTED' || /aborted|cancelled/i.test(message)) {
    return new WfError('经验确认卡片已取消（你关闭了卡片或工作流已停止），本次未入库任何经验', 'WF_CANCELLED')
  }
  return null
}

/**
 * 注册 wf_experience（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfExperience(
  ctx: { get(name: string): unknown },
  host: WfExperienceHost,
): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_experience')
  }

  const definition = defineTool({
    name: WF_EXPERIENCE,
    description:
      'Submit the candidate experiences produced by the post-run reflection so the user can approve them. ' +
      'Call it once the reflection on a finished run (completed/failed/stopped) has produced 1 to 8 candidates: it renders an official multi-select card and blocks until the user answers. ' +
      'Only the selected candidates are stored, atomically in this single call, in the experience library; a free-form comment in the card is recorded as review feedback on the selected entries, and the entries are marked human-reviewed. ' +
      'Parent agent only; child agents are rejected (WF_NOT_ROOT). Empty or malformed experiences are rejected (WF_BAD_ARGS), a missing question service fails with WF_NO_ASK_PROVIDER, a missing root agent with WF_NO_ROOT_AGENT, and a dismissed card with WF_CANCELLED (nothing is stored). ' +
      'Do not call this when the reflection produced nothing worth keeping. Idempotency is the store\'s: candidates duplicating an existing task_type+insight come back in skipped instead of being stored twice.',
    parameters: {
      experiences: {
        type: 'array',
        required: true,
        // 条数上限由 execute 运行时校验（官方 tools 的 JSON Schema 子集不含 minItems/maxItems）
        description: `Candidate experiences from this reflection (1 to ${MAX_EXPERIENCE_DRAFTS}); each is shown as one selectable card option.`,
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            task_type: { type: 'string', required: true, description: 'Coarse task category used for grouping, e.g. "software development".' },
            task_context: { type: 'string', required: true, description: 'Natural-language context of the task, used for semantic retrieval (not a title).' },
            insight: { type: 'string', required: true, description: 'The reusable lesson itself, ideally a single sentence; shown as the card option label.' },
            evidence: { type: 'string', description: 'Optional key facts supporting the insight (short).' },
            source_run_id: { type: 'string', description: 'Optional id of the run this experience came from.' },
          },
        },
      },
      question: { type: 'string', description: `Optional card question (default: ${DEFAULT_EXPERIENCE_QUESTION}).` },
      header: { type: 'string', description: `Optional short card heading (default: ${DEFAULT_EXPERIENCE_HEADER}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          inserted: {
            type: 'array',
            required: true,
            description: 'Experiences actually stored by this call (selected by the user and not skipped).',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true, description: 'Stored experience id.' },
                taskType: { type: 'string', required: true, description: 'Task category of the stored experience.' },
              },
            },
          },
          skipped: {
            type: 'array',
            required: true,
            description: 'Selected candidates the store refused (e.g. duplicate task_type+insight), with the reason.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                insight: { type: 'string', required: true, description: 'Insight of the skipped candidate.' },
                reason: { type: 'string', required: true, description: 'Why it was not stored.' },
              },
            },
          },
          selectedCount: { type: 'number', required: true, description: 'How many candidates the user selected (0 when none were selected or the card had no answer).' },
        },
      },
      render: textRender,
    },
    async execute(args: Record<string, unknown>, exec: ToolExecLike) {
      const caller = callerOf(exec)
      if (caller.isChild) {
        throw new WfError('wf_experience 仅供父代理调用（经验入库是父代理的复盘权限）', 'WF_NOT_ROOT')
      }
      const sessionId = caller.sessionId
      if (!sessionId) throw new WfError('无法识别调用者会话', 'WF_BAD_CALLER')
      const candidates = candidatesOf(mergeExperienceDrafts(normalizeExperienceDrafts(args?.experiences)))
      const question = textOf(args?.question) || DEFAULT_EXPERIENCE_QUESTION
      const header = textOf(args?.header) || DEFAULT_EXPERIENCE_HEADER

      const root = host.getRootAgent(sessionId)
      if (!root) throw new WfError('主会话 Agent 未激活，无法渲染经验确认卡片', 'WF_NO_ROOT_AGENT')
      const userQuestions = ctx.get('userQuestions') as UserQuestionsServiceLike | null | undefined
      if (!userQuestions || typeof userQuestions.ask !== 'function') {
        throw new WfError('userQuestions 服务不可用，无法渲染经验确认卡片', 'WF_NO_ASK_PROVIDER')
      }

      // 卡片期间持续触碰空闲基准（与 wf_ask 同口径）：阻塞等待用户确认不应被空闲看护误停
      const orchestrator = host.orchestrator
      const run = orchestrator ? orchestrator.activeRunForSession(sessionId) : null
      if (orchestrator && run) orchestrator.touchRun(run)
      const runSignal = run?.controller.signal
      const signal = runSignal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([runSignal, exec.signal])
        : (runSignal ?? exec.signal)

      let answers: unknown[] = []
      try {
        const result = await userQuestions.ask({
          questions: [
            {
              id: WF_EXPERIENCE,
              question,
              header,
              multiSelect: true,
              options: candidates.map((candidate) => ({
                label: candidate.label,
                description: optionDescriptionOf(candidate.draft),
              })),
            },
          ],
          agent: root,
          signal,
        })
        answers = Array.isArray(result?.answers) ? result.answers : []
      } catch (error) {
        const cancelled = cancelledWfError(error)
        if (cancelled) throw cancelled
        throw error
      }

      const { selected, feedback } = selectionsFrom(answers)
      const picked = candidates.filter((candidate) => selected.includes(candidate.label))
      if (picked.length === 0) {
        // 用户未勾选任何候选：不入库，正常返回（这不是错误——「宁可不产生」是允许的结果）
        return { inserted: [], skipped: [], selectedCount: 0 }
      }
      const reviewedAt = host.now ? host.now() : Date.now()
      const result = await host.assets.insertExperiences(draftsOf(picked, feedback), reviewedAt)
      return {
        inserted: result.inserted.map((entry) => ({ id: entry.id, taskType: entry.taskType })),
        skipped: result.skipped.map((item) => ({ insight: item.insight, reason: item.reason })),
        selectedCount: picked.length,
      }
    },
  })

  const dispose = tools.register(definition)
  return () => {
    try {
      dispose()
    } catch {
      // 注销尽力而为（工具可能已被外部注销）
    }
  }
}
