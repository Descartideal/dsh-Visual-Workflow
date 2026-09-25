import type { AgentTeamsServiceLike, TeamMemberViewLike } from './types.js';
/** 最小 ctx 形状（只消费 get；与宿主 ctx 结构兼容）。 */
export interface ContextLike {
    get(name: string): unknown;
}
/**
 * 解析官方 Team 服务（`ctx.agentTeams`）。
 *
 * 判定条件：三个能力齐全（创建成员 / 读取成员 / 投递消息）——缺任一都不足以完成
 * 「启动团队 + 复用派发」的完整语义，按不可用处理更安全（调用方回退旧路径）。
 *
 * @param ctx - 宿主上下文。
 * @returns 收窄后的服务结构；不可用时 null。
 */
export declare function agentTeamsServiceLike(ctx: ContextLike): AgentTeamsServiceLike | null;
/**
 * 在成员清单中按名字查已有成员（纯函数）。
 *
 * 用途：判定本次是否需要创建——官方成员名永久不可复用，已存在的同名成员只能复用
 * （重新派发任务），再创建会直接失败。
 *
 * @param members - `listMembers` 结果（含 Lead 伪行，按名字匹配不会命中 Lead 的 "lead"）。
 * @param name - 目标成员名。
 * @returns 命中的成员行；不存在返回 undefined。
 */
export declare function findMemberByName(members: readonly TeamMemberViewLike[] | undefined, name: string): TeamMemberViewLike | undefined;
