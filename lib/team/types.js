// src/host/team/types.ts
//
// 官方 Agent Team 服务的最小消费面（运行时守卫收窄；零官方类型依赖）。
//
// 只声明插件真正消费的字段：创建 teammate、读取成员清单、向成员投递消息。
// 不声明任务板与等待能力——插件不代替成员使用它们，成员自己持有全部官方工具。
//
// 为什么请求形状如此窄：官方 `TeamService.spawnTeammate` 只接受
// name / description / prompt / context / provider / signal 六个字段，
// 成员级模型、工具白名单与人设**不经过该请求**，由插件在子代理创建窗口内另行装配。
export {};
//# sourceMappingURL=types.js.map