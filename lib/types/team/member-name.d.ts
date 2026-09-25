/** 官方名字长度上限。 */
export declare const TEAM_MEMBER_NAME_MAX_LENGTH = 64;
/**
 * 节点 id → teammate 名（确定性纯函数）。
 *
 * @param nodeId - 画布角色节点 id。
 * @returns 满足官方约束的成员名；同一 nodeId 恒返回同名。
 */
export declare function teammateNameOf(nodeId: unknown): string;
/** 名字是否满足官方约束（本地前置校验；官方仍会二次校验）。 */
export declare function isTeammateNameValid(name: unknown): boolean;
/** 职责简述上限（官方 description 校验）。 */
export declare const TEAM_MEMBER_DESCRIPTION_MAX_LENGTH = 200;
/**
 * 成员职责简述：取角色名，超长按官方上限截断。
 * 为什么用角色名作 description：官方把它作为成员行的可读职责，且不参与名字唯一性。
 */
export declare function teammateDescriptionOf(label: unknown, nodeId: unknown): string;
