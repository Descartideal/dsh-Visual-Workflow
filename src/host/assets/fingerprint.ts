// src/host/assets/fingerprint.ts
//
// 内容指纹：稳定序列化 + FNV-1a 64 位。
//
// 为什么不用 node:crypto：指纹要作为「模版内容未变」的跨端判据，浏览器侧必须能
// 复述同一算法；引入 crypto 会让两端各有实现，语义一旦漂移，入库按钮的锁定判定
// 就会与宿主不一致。FNV-1a 实现短且无平台差异，两端各一份代码即可对齐。

/** 64 位 FNV-1a 参数（FNV offset basis 与 prime）。 */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

/**
 * 内容指纹：先稳定序列化，再取 FNV-1a 64 位的 16 位十六进制。
 * 序列化规则：对象键升序、剔除值为 undefined 的键、数组保持顺序；
 * 因此「字段书写顺序不同」「可选字段缺席与显式 undefined」都得到同一指纹。
 */
export function contentFingerprint(value: unknown): string {
  return fnv1a64(stableStringify(value))
}

/** 稳定序列化（返回确定字符串；undefined 值在对象中剔除、在数组中落为 null）。 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  // 非纯对象的宿主类型（Date/Map 等）按 JSON 语义降级，避免产出 "{}" 掩盖差异
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return JSON.stringify(value) ?? 'null'
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

/** FNV-1a 64 位（逐 UTF-8 字节；16 位小写十六进制，固定长度便于比较与展示）。 */
function fnv1a64(text: string): string {
  let hash = FNV_OFFSET_BASIS
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash.toString(16).padStart(16, '0')
}
