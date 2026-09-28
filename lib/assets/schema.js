// src/host/assets/schema.ts
//
// 资产库磁盘形状（DDL 常量 + 幂等建表）。
//
// 磁盘形状属对外契约：外部备份、排障与迁移都依赖它，因此 DDL 只在此文件出现一次。
// 事务语义：资产历史行「内容不可变」——回滚只挪 Active 指针，历史行永不改写；
// 因此 reference_* 与 role_asset_type 这类统计/类型字段是**可变的缓存列**，
// 其可变性由本模块显式维护（见 role-assets.ts / workflow-assets.ts）。
/** 库文件相对插件 dataDir 的固定文件名。 */
export const ASSET_DB_FILE = 'assets.db';
/**
 * 为什么 reference_status 是独立列而不是从 reference_workflow_ids 推导：
 * idx_role_history_status 需要可索引的等值列做「已引用」过滤，JSON 数组长度判断
 * 无法走索引；该列由引用统计在写入时同步刷新，与数组长度恒一致（不变量）。
 */
export const ROLE_ASSET_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS role_asset_history (
  id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('parent','agent')),
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  reasoning TEXT NOT NULL DEFAULT '',
  preset_id TEXT NOT NULL DEFAULT '',
  retry_limit INTEGER NOT NULL DEFAULT 0 CHECK (retry_limit >= 0),
  react_limit INTEGER CHECK (react_limit IS NULL OR react_limit >= 0),
  input_schema TEXT CHECK (input_schema IS NULL OR json_valid(input_schema)),
  output_schema TEXT CHECK (output_schema IS NULL OR json_valid(output_schema)),
  system_prompt_source TEXT,
  inject_system_prompt INTEGER NOT NULL DEFAULT 1 CHECK (inject_system_prompt IN (0,1)),
  inject_tool_sections INTEGER NOT NULL DEFAULT 1 CHECK (inject_tool_sections IN (0,1)),
  prompt_file_path TEXT,
  retrieval_context TEXT,
  role_asset_type TEXT NOT NULL CHECK (role_asset_type IN ('standalone','inline','shared')),
  reference_status TEXT NOT NULL DEFAULT 'unused' CHECK (reference_status IN ('unused','used')),
  reference_workflow_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reference_workflow_ids)),
  source TEXT NOT NULL CHECK (source IN ('human','agent')),
  source_template_id TEXT,
  source_fingerprint TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(asset_id, version_id)
)`;
export const ROLE_ASSET_HISTORY_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_role_history_asset_id ON role_asset_history(asset_id)',
    'CREATE INDEX IF NOT EXISTS idx_role_history_status ON role_asset_history(reference_status)',
];
/**
 * 为什么 role_version_ids 存对象数组而非扁平 id 数组：工作流图重建必须知道
 * 「哪个 roleVersionId 属于哪个节点」，扁平数组丢失节点映射后无法还原节点壳。
 */
export const WORKFLOW_ASSET_HISTORY_DDL = `
CREATE TABLE IF NOT EXISTS workflow_asset_history (
  id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('mode1','mode2')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  role_version_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(role_version_ids)),
  nodes_json TEXT NOT NULL CHECK (json_valid(nodes_json)),
  lines_json TEXT NOT NULL CHECK (json_valid(lines_json)),
  meta_json TEXT CHECK (meta_json IS NULL OR json_valid(meta_json)),
  retrieval_context TEXT,
  source TEXT NOT NULL CHECK (source IN ('human','agent')),
  source_run_id TEXT,
  source_template_id TEXT,
  source_fingerprint TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(asset_id, version_id)
)`;
export const WORKFLOW_ASSET_HISTORY_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_workflow_history_asset_id ON workflow_asset_history(asset_id)',
];
/**
 * Active 索引：每个逻辑资产一行，退役 = 删行（历史保留）。
 * source_template_id / source_fingerprint 为何冗余在此：入库按钮的锁定判定与
 * 「同一模版二次晋升走新版本」都要按模版定位当前绑定，避免每次回表取历史行。
 */
export const ROLE_ASSET_ACTIVE_DDL = `
CREATE TABLE IF NOT EXISTS role_asset_active (
  asset_id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  retrieval_context TEXT NOT NULL,
  embedding BLOB,
  embedding_dimension INTEGER,
  embedding_source TEXT,
  embedding_model TEXT,
  source_template_id TEXT,
  source_fingerprint TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (asset_id, version_id) REFERENCES role_asset_history(asset_id, version_id)
)`;
export const ROLE_ASSET_ACTIVE_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_role_active_version ON role_asset_active(asset_id, version_id)',
];
export const WORKFLOW_ASSET_ACTIVE_DDL = `
CREATE TABLE IF NOT EXISTS workflow_asset_active (
  asset_id TEXT PRIMARY KEY,
  version_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  retrieval_context TEXT NOT NULL,
  embedding BLOB,
  embedding_dimension INTEGER,
  embedding_source TEXT,
  embedding_model TEXT,
  source_template_id TEXT,
  source_fingerprint TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (asset_id, version_id) REFERENCES workflow_asset_history(asset_id, version_id)
)`;
export const WORKFLOW_ASSET_ACTIVE_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_workflow_active_version ON workflow_asset_active(asset_id, version_id)',
];
export const EXPERIENCES_DDL = `
CREATE TABLE IF NOT EXISTS experiences (
  id TEXT PRIMARY KEY,
  source_run_id TEXT,
  reflection_prompt_version TEXT NOT NULL DEFAULT '1',
  task_type TEXT NOT NULL,
  task_context TEXT NOT NULL,
  insight TEXT NOT NULL,
  evidence TEXT,
  review_feedback TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;
export const EXPERIENCES_INDEXES_DDL = [
    'CREATE INDEX IF NOT EXISTS idx_experiences_task_type ON experiences(task_type)',
    'CREATE INDEX IF NOT EXISTS idx_experiences_source_run_id ON experiences(source_run_id)',
    'CREATE INDEX IF NOT EXISTS idx_experiences_created_at ON experiences(created_at)',
];
/** 全部建表语句（顺序即依赖顺序：先历史后 Active，外键才可解析）。 */
export const SCHEMA_STATEMENTS = [
    ROLE_ASSET_HISTORY_DDL,
    ...ROLE_ASSET_HISTORY_INDEXES_DDL,
    WORKFLOW_ASSET_HISTORY_DDL,
    ...WORKFLOW_ASSET_HISTORY_INDEXES_DDL,
    ROLE_ASSET_ACTIVE_DDL,
    ...ROLE_ASSET_ACTIVE_INDEXES_DDL,
    WORKFLOW_ASSET_ACTIVE_DDL,
    ...WORKFLOW_ASSET_ACTIVE_INDEXES_DDL,
    EXPERIENCES_DDL,
    ...EXPERIENCES_INDEXES_DDL,
];
/** 幂等建表：全部 `IF NOT EXISTS`，重复调用不改变既有库。 */
export function initSchema(db) {
    for (const statement of SCHEMA_STATEMENTS)
        db.exec(statement);
}
//# sourceMappingURL=schema.js.map