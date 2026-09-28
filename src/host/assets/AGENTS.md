# Assets Module Rules

## 范围与职责

适用于 `src/host/assets/`。

以**单文件 SQLite（`<root>/assets.db`）**保存两类持久化事实，并对外提供其读写入口：

- **资产**：模版的晋升形态。带版本控制、Active 指针、回滚与退役；分角色资产与工作流资产两类；
- **经验**：复盘沉淀的知识单元（task_type + task_context + insight）。

判断归属：该修改是否改变「资产/经验被持久化成什么形状、版本如何推进、Active 如何指向」？
只改变业务语义判断（该不该晋升、该不该复用）应放到调用方模块。

本模块不读模版、不读工作流实例：`currentTemplateFingerprint` 一类「需要外部事实」的字段由
API 边界读取后填充，本模块只负责自己拥有的事实。

## 文件职责

- `index.ts`：唯一公共入口（`AssetStore`、输入/结果类型、id 与指纹纯函数再导出）；
- `schema.ts`：DDL 常量与幂等建表（磁盘形状的唯一承接点）；
- `db.ts`：连接、PRAGMA、`withTx` 事务助手与进程内串行队列；
- `errors.ts`：`AssetError`（code 取共享协议常量）；
- `ids.ts`：id 与版本行 id 纯函数（随机源可注入）；
- `fingerprint.ts`：稳定序列化 + FNV-1a 64 位（纯函数，不引 `node:crypto`）；
- `row-codec.ts`：行 ⇄ 领域对象的双向映射（节点/模版/详情形状的唯一一份映射）；
- `role-check.ts`：入参校验与可空/JSON 列转换的纯助手；
- `role-assets.ts`：角色资产的版本登记、去重、类型晋升、引用统计、回滚、退役；
- `workflow-assets.ts`：工作流资产的版本登记（含内联角色同步登记）、节点壳重建、回滚、退役；
- `experiences.ts`：经验的插入去重、索引与详情查询。

## 状态所有权

- 本模块是资产与经验两类事实的唯一所有者；调用方不得自行拼库路径、建表或直接改列。
- **历史行内容不可变**：`role_asset_history` / `workflow_asset_history` 的内容列一经写入不再改写；
  回滚、退役、共享类型变更都不得触碰内容列。
- `role_asset_type`、`reference_status`、`reference_workflow_ids`、`updated_at` 是**可变统计缓存**，
  只允许由 `role-assets.ts` / `workflow-assets.ts` 的刷新函数改写；缓存与事实不一致时以事实为准。
- Active 表是「资产存活 + 当前版本」的唯一判据：退役即删行，历史保留。

## 事务与并发

- 读改写必须在**同一笔事务**内完成：`AssetStore` 的每个公开方法都经 `withTx`，
  拼接「查重 → 决定新增版本 / 复用 / 新建」与「写版本行 → 刷新引用统计」两段。
- `withTx` 用 `BEGIN IMMEDIATE` 取写锁，并在进程内串行队列中执行：回调可 `await`，
  两个并发写事务不会交错到同一笔事务里（否则一方回滚会连带回滚另一方）。
- 失败必须整体回滚，不留半成品（不允许「工作流版本行引用了未登记的角色版本」这种状态）。
- 事务内禁止 `await` 非 SQLite 的 I/O（网络/嵌入模型）：写锁会横跨外部等待，放大锁竞争。

## 时间戳与版本

- 时间戳一律 epoch 毫秒，由本模块记账（`AssetStoreDeps.now` 可注入，测试确定化）。
- `created_at` 是**资产诞生时间**，升版时沿用既有版本行的值；`updated_at` 每次写入刷新。
- `version_id` 从 1 开始、按资产独立递增（`max(version_id) + 1`）；版本行 id 固定
  `<asset_id>@<version_id>`，它是工作流版本行反向引用角色版本行的键，属对外契约。
- 回滚只移动 Active 指针，不新增版本、不改历史行。

## 去重语义

- 角色内容去重键为 `kind + system_prompt` 全等（用户裁决）；匹配范围是**未退役资产的全部版本行**，
  命中取版本号最大的一行；已退役资产不参与匹配。
- standalone 与 standalone 重复 → 拦截（`ERR_ASSET_DUPLICATE`），取消当次入库；
  inline/shared 重复 → 不新建资产，合并到既有资产并把该版本行升为 `shared`。
- 工作流晋升时的内联角色：`data.sourceAssetId` 命中未退役资产则「内容全等则引用、否则在该资产下升版」；
  未命中则按内容去重，再未命中才新建 `inline` 资产。
- 「内容全等」只比较内容字段，统计列与审计列（指纹、来源、引用数组）不参与比较。

## 引用统计

- 引用统计的写入与工作流版本行同事务：`reference_workflow_ids` 追加的是**工作流版本行 id**（去重）。
- `reference_status` 与 `reference_workflow_ids` 的长度恒一致（不变量，由写入路径维护）。
- 统计**单调递增**：角色升版时新版本行从 `[]` 重新开始，不继承旧版本的引用。
- 某版本行被 2 个以上工作流版本引用且类型为 `standalone`/`inline` → 该行升 `shared`。

## 错误码

- `AssetError.code` 只取 `shared/protocol.ts` 的 `ERR_ASSET_NOT_FOUND` /
  `ERR_ASSET_VERSION_NOT_FOUND` / `ERR_ASSET_DUPLICATE` / `ERR_ASSET_BAD_ARGS`，禁止在调用点硬编码。
- 「资产不存在」与「资产已退役」共用 `ERR_ASSET_NOT_FOUND`（Active 行是唯一判据）。
- 入库形状非法（缺必填列、JSON 列损坏等**资产行自身**的问题）用带路径信息的普通 `Error`：
  它是数据损坏而非调用方入参错误，不应伪装成 400。

## 读取语义

- 列表读：单行损坏（JSON 非法/缺列）跳过该条并 `console.warn`，保证列表可用。
- 单资源读：损坏即抛带路径的错误，不得伪装成「不存在」。
- 工作流详情的节点壳重建遇「有角色节点但缺版本映射」或「引用的角色版本行缺失」必须抛错，
  不得静默产出半张图。

## 兼容与降级

- WAL 切换失败（网络盘/只读介质）只降级为默认日志模式，不抛错；日志模式是并发优化而非正确性前提。
- 枚举读取宽容：未知 `role_asset_type` 按 `standalone` 处理，未知 `source` 按 `human` 处理。
- 新增列必须走 DDL 的 `IF NOT EXISTS` 路径并保证旧库可读；退役列只保留读取兼容，禁止新增写入。

## 验证补充

- 初始化幂等（重复 `init()` 不改变磁盘形状）；
- 同一模版二次晋升走同一资产新版本、内容不变时 `unchanged: true`；
- 去重三分支（standalone 拦截 / inline 合并成 shared / 未命中新建）各有测试；
- 回滚只改 Active 指针：历史行数量与内容不变；
- 退役后 get/list 均不可见，但历史行仍在（引用统计保留）；
- 引用统计单调递增，角色升版后新版本行引用数组为 `[]`；
- 节点壳重建出的图与晋升时的原图等价（含 `position` / `groupId` / `sourceAssetId`）。

## 核心原则

1. 资产事实由本模块单独拥有，磁盘形状与错误码属对外契约。
2. 读改写不出事务，失败不留半成品。
3. 历史不可变，Active 即指针；统计是缓存，可重建且有唯一维护点。
4. 时间戳与版本号由本模块记账，注入式时钟保证测试确定。
5. 列表读可用、单资源读可诊断；重建宁可报错也不产半成品。
