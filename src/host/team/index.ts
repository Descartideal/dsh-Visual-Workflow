// src/host/team/index.ts
//
// team 模块公共入口：官方 Agent Team 适配的对外契约面。
// 只导出纯函数与守卫，不导出任何状态持有者。

export { agentTeamsServiceLike, findMemberByName, type ContextLike } from './service.js'
export {
  isTeammateNameValid,
  teammateDescriptionOf,
  teammateNameOf,
  TEAM_MEMBER_DESCRIPTION_MAX_LENGTH,
  TEAM_MEMBER_NAME_MAX_LENGTH,
} from './member-name.js'
export type {
  AgentTeamsServiceLike,
  TeamMemberViewLike,
  TeamSendRequestLike,
  TeamSendResultLike,
  TeamSpawnRequestLike,
  TeamSpawnResultLike,
} from './types.js'
