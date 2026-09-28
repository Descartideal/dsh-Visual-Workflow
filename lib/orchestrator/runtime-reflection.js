// src/host/orchestrator/runtime-reflection.ts
//
// 运行终态「复盘指令」注入（运行事实 → 提示词 → 父代理通道）：
//   一次 run 进入 completed / failed / stopped 后，把复盘指令注入父代理，要求父代理
//   复盘后经 wf_experience 提交候选经验（该工具渲染多选卡片、用户确认后入库）。
//
// 为什么单独成文件：注入是「终态写盘之后的 best-effort 辅助路径」，与状态机收尾
// （runtime-execute 的 wfFinish、runtime-lifecycle 的 terminateRun）职责不同——收尾只管
// 释放资源，本文件只管「把本次运行的事实渲染成复盘指令并送达父代理」，失败只告警。
//
// 通道选择（与 runtime-base 的 notifyOrchestrationChange 同范式）：父代理回合进行中
// （status='running'）且具备 steer → 插队注入（下一步边界即见）；否则 followupRoot 唤醒
// （父代理空闲时也能收到）。幂等（同一 runId 只注入一次）由 RuntimeBase 的
// notifyRunReflection 持有去重表，两个结束点共用同一入口。
import { buildReflectionPrompt } from '../prompts/index.js';
import { coordinatorMessage } from './ask-protocol.js';
import { messageOf } from './errors.js';
/** 注入文案的稳定来源标记（排障与审计用；注入文本内的锚点见 REFLECTION_MARKER）。 */
export const REFLECTION_MESSAGE_SOURCE = 'visual-workflow-reflection';
/**
 * 从快照事实派生复盘入参（纯函数）：
 *   - 非三种终态（running/paused/interrupted）返回 null —— paused/interrupted 可续跑，
 *     复盘由续跑后的终态触发；
 *   - 总耗时 = endedAt - startedAt；任一时间戳缺失或不可解析时为 null（渲染「不可计算」）。
 */
export function reflectionFactsOf(input) {
    if (input.status !== 'completed' && input.status !== 'failed' && input.status !== 'stopped')
        return null;
    const started = Date.parse(String(input.startedAt ?? ''));
    const ended = Date.parse(String(input.endedAt ?? ''));
    const durationMs = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null;
    return {
        runId: input.runId,
        flowName: input.flowName,
        status: input.status,
        durationMs,
        nodeCount: Math.max(0, Math.floor(Number(input.nodeCount) || 0)),
        systemLanguage: input.systemLanguage ?? '',
    };
}
/**
 * 向父代理注入复盘指令。
 * 失败语义：根代理不存在、steer/followupRoot 抛错、通道不可用——一律只告警并返回 false，
 * 不阻断调用方的收尾与资源释放（与 notifyOrchestrationChange 同口径）。
 */
export function injectReflection(env, input) {
    try {
        const root = env.getRootAgent(input.sessionId);
        if (!root) {
            env.logger.warn(`${env.warnPrefix}父代理未激活：run=${input.runId}`);
            return false;
        }
        const text = buildReflectionPrompt(input.facts);
        const id = env.uuid();
        if (root.status === 'running' && typeof root.steer === 'function') {
            root.steer(coordinatorMessage(id, text, REFLECTION_MESSAGE_SOURCE));
        }
        else {
            const message = {
                id,
                role: 'user',
                content: [{ type: 'text', text }],
                source: { kind: 'user' },
            };
            env.followupRoot(root, message);
        }
        env.logger.info(`${env.warnPrefix}已注入复盘指令：run=${input.runId}`);
        return true;
    }
    catch (error) {
        env.logger.warn(`${env.warnPrefix}注入失败：${messageOf(error)}`);
        return false;
    }
}
//# sourceMappingURL=runtime-reflection.js.map