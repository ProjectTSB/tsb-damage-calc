import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asTag, attributeGet, dataGet, div, mul, toInt } from '../src/calc/mc.ts'

test('/= は floorDiv で負の数を下へ丸める', () => {
  assert.equal(div(-7, 2), -4)
  assert.equal(div(7, 2), 3)
})

test('*= は int の範囲で桁あふれする', () => {
  assert.equal(mul(2147483647, 2), -2)
})

test('data get は floor で切り捨てる（負の数も下へ）', () => {
  assert.equal(dataGet(-0.005, 100), -1)
  assert.equal(dataGet(12.349, 100), 1234)
})

test('float の 0.7 は 100 倍すると 69 になる', () => {
  assert.equal(dataGet(asTag(0.7, 'float'), 100), 69)
  assert.equal(dataGet(asTag(0.7, 'double'), 100), 70)
})

test('attribute get は 0 方向へ切り捨て、int の範囲に張り付く', () => {
  assert.equal(attributeGet(2.999, 100), 299)
  assert.equal(toInt(1e12), 2147483647)
})
