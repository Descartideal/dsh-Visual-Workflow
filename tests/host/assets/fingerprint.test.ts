// tests/host/assets/fingerprint.test.ts
//
// 内容指纹测试：稳定序列化口径（键序、undefined、数组序、嵌套）与 FNV-1a 输出形状。
// 断言依据：两端（Host / Client）必须能复述同一算法，故口径变化即契约变化。

import { describe, expect, it } from 'vitest'
import { contentFingerprint, stableStringify } from '../../../src/host/assets/fingerprint.js'

describe('stableStringify（稳定序列化）', () => {
  it('test_序列化_对象键序不同_产出同一字符串', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('test_序列化_值为undefined_键被剔除', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('test_序列化_数组元素顺序不同_产出不同字符串', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })

  it('test_序列化_嵌套对象与undefined_递归生效', () => {
    expect(stableStringify({ a: { d: undefined, c: 1 }, b: [1, null, 'x'] })).toBe('{"a":{"c":1},"b":[1,null,"x"]}')
  })

  it('test_序列化_中文与特殊字符_转义后可由JSON还原', () => {
    const value = { text: '你好\n"引号"\\反斜杠' }
    expect(JSON.parse(stableStringify(value))).toEqual(value)
  })
})

describe('contentFingerprint（FNV-1a 64 位）', () => {
  it('test_指纹_同一内容不同键序_完全一致', () => {
    const left = { name: 'a', nodes: [{ id: 'n1', data: { label: 'x', provider: 'p' } }] }
    const right = { nodes: [{ data: { provider: 'p', label: 'x' }, id: 'n1' }], name: 'a' }
    expect(contentFingerprint(left)).toBe(contentFingerprint(right))
  })

  it('test_指纹_任一内容变化_指纹变化', () => {
    expect(contentFingerprint({ name: 'a' })).not.toBe(contentFingerprint({ name: 'b' }))
  })

  it('test_指纹_输出_固定16位十六进制', () => {
    expect(contentFingerprint({ any: 'value' })).toMatch(/^[0-9a-f]{16}$/)
  })

  it('test_指纹_含undefined与不含该键_完全一致', () => {
    expect(contentFingerprint({ a: 1, b: undefined })).toBe(contentFingerprint({ a: 1 }))
  })

  it('test_指纹_空对象与空数组_各自确定且互不相同', () => {
    expect(contentFingerprint({})).toBe(contentFingerprint({}))
    expect(contentFingerprint({})).not.toBe(contentFingerprint([]))
  })
})
