import { MODIFIER_KEYS, amountE3, type Buff, type ModifierKey, type Operation, type Side, type ValueCalc } from '../calc/attributes.ts'
import { dataGet } from '../calc/mc.ts'
import { InputError, template } from './dom.ts'

/** バフを入れる欄。resist は対象が Mob のときの Defense。 */
export type BuffSide = 'attack' | 'defense' | 'resist'
export type Source = 'equipment' | 'effect'

export interface BuffRowData {
  name: string
  source: Source
  key: ModifierKey
  amount: string
  operation: Operation
}

const DEFAULT_OPERATION: Record<Source, Operation> = { equipment: 'multiply_base', effect: 'multiply' }

const INPUT = [
  '値は +10% なら 0.1、-20% なら -0.2（TSB の Amount と同じ）。',
  '行はゲームで付与する順に並べる。',
]
const DEFENSE = [
  '防御側は、値が大きいほど受けるダメージが減る。',
  '例：+0.10 と +0.15 なら、装備は ×0.75、エフェクトは ×0.90 × 0.85 = ×0.765。',
  ...INPUT,
]

const HELP: Record<BuffSide, string> = {
  attack: ['例：+0.10 と +0.15 なら、装備は ×1.25、エフェクトは ×1.10 × 1.15 = ×1.265。', ...INPUT].join('\n'),
  defense: DEFENSE.join('\n'),
  resist: [...DEFENSE, 'バフを入れた属性の Resist は、0.001 単位に切り捨ててから掛ける。'].join('\n'),
}

export const calcSide = (side: BuffSide): Side => (side === 'attack' ? 'attack' : 'defense')

export function buffContainer(side: BuffSide): HTMLElement {
  const container = document.querySelector<HTMLElement>(`.buffs[data-side="${side}"]`)
  if (!container) throw new Error(`バフの欄 ${side} が無い`)
  return container
}

const list = (container: HTMLElement) => container.querySelector<HTMLElement>('.buff-list')!
const part = <T extends HTMLElement>(row: Element, name: string) => row.querySelector<T>(`[data-field="${name}"]`)!

function makeRow(data: BuffRowData): HTMLElement {
  const fragment = template('buff-row-template')
  const row = fragment.querySelector<HTMLElement>('.buff-row')!
  const key = part<HTMLSelectElement>(row, 'key')
  for (const k of MODIFIER_KEYS) key.append(new Option(k, k))
  part<HTMLInputElement>(row, 'name').value = data.name
  part<HTMLSelectElement>(row, 'source').value = data.source
  key.value = data.key
  part<HTMLInputElement>(row, 'amount').value = data.amount
  part<HTMLSelectElement>(row, 'operation').value = data.operation
  return row
}

export function setupBuffs(side: BuffSide, onChange: () => void): void {
  const container = buffContainer(side)
  container.append(template('buffs-template'))
  container.querySelector<HTMLElement>('.buff-help')!.textContent = HELP[side]
  for (const button of container.querySelectorAll<HTMLButtonElement>('[data-add]')) {
    button.addEventListener('click', () => {
      const source = button.dataset.add as Source
      list(container).append(makeRow({ name: '', source, key: 'Base', amount: '0.1', operation: DEFAULT_OPERATION[source] }))
      onChange()
    })
  }
  list(container).addEventListener('click', (event) => {
    const button = (event.target as Element).closest('[data-action="remove"]')
    if (!button) return
    button.closest('.buff-row')?.remove()
    onChange()
  })
  // 種類を変えたら、その種類の掛け方に合わせる（form の change より先に呼ばれる）
  list(container).addEventListener('change', (event) => {
    const target = event.target as HTMLElement
    if (target.dataset.field !== 'source') return
    const row = target.closest('.buff-row')!
    part<HTMLSelectElement>(row, 'operation').value = DEFAULT_OPERATION[(target as HTMLSelectElement).value as Source]
  })
}

export function readRows(side: BuffSide): BuffRowData[] {
  return [...list(buffContainer(side)).querySelectorAll('.buff-row')].map((row) => ({
    name: part<HTMLInputElement>(row, 'name').value,
    source: part<HTMLSelectElement>(row, 'source').value as Source,
    key: part<HTMLSelectElement>(row, 'key').value as ModifierKey,
    amount: part<HTMLInputElement>(row, 'amount').value,
    operation: part<HTMLSelectElement>(row, 'operation').value as Operation,
  }))
}

export function writeRows(side: BuffSide, rows: BuffRowData[], append: boolean): void {
  const target = list(buffContainer(side))
  if (!append) target.replaceChildren()
  target.append(...rows.map(makeRow))
}

export function toBuffs(side: BuffSide): Buff[] {
  const elements = [...list(buffContainer(side)).querySelectorAll('.buff-row')]
  return readRows(side).map((row, index) => {
    const amount = Number(row.amount)
    if (row.amount.trim() === '' || !Number.isFinite(amount)) throw new InputError(`バフ ${index + 1} 行目（${row.name || row.key}）の値に数値を入力してください`, part(elements[index]!, 'amount'))
    return { key: row.key, amount, operation: row.operation }
  })
}

const fmt3 = (e3: number) => (e3 / 1000).toFixed(3)
const signed = (e3: number) => (e3 >= 0 ? `+ ${fmt3(e3)}` : `− ${fmt3(-e3)}`)

function effectText(e3: number, operation: Operation): string {
  if (operation === 'multiply') return `×${fmt3(1000 + e3)}`
  if (operation === 'multiply_base') return `${signed(e3)}（合計してから掛ける）`
  return `基礎値に ${signed(e3)}`
}

function compositionText(value: ValueCalc, rows: { e3: number; operation: Operation }[]): string {
  const c = value.composition!
  const adds = rows.filter((r) => r.operation === 'add')
  const bases = rows.filter((r) => r.operation === 'multiply_base')
  let text = fmt3(c.defaultE3)
  if (adds.length > 0) text = `(${text} ${adds.map((r) => signed(r.e3)).join(' ')})`
  if (bases.length > 0) text += ` × (1 ${bases.map((r) => signed(r.e3)).join(' ')})`
  for (const r of rows.filter((r) => r.operation === 'multiply')) text += ` × ${fmt3(1000 + r.e3)}`
  return `${text} = ${fmt3(c.resultE3)}（計算では ×${(dataGet(value.value, 100) / 100).toFixed(2)}）`
}

/** 行ごとの効き方と、補正先ごとの組み立ての式を出す。values が null なら式を消す。 */
export function renderBuffs(side: BuffSide, values: ValueCalc[] | null): void {
  const container = buffContainer(side)
  const rows = readRows(side)
  const rowElements = [...list(container).querySelectorAll('.buff-row')]
  const e3s = rows.map((row) => {
    const amount = Number(row.amount)
    return row.amount.trim() === '' || !Number.isFinite(amount) ? null : amountE3(amount, calcSide(side))
  })
  rowElements.forEach((row, i) => {
    const e3 = e3s[i]
    part(row, 'effect').textContent = e3 === null || e3 === undefined ? '' : effectText(e3, rows[i]!.operation)
  })
  const sum = container.querySelector<HTMLElement>('.buff-sum')!
  if (values === null) {
    sum.replaceChildren()
    return
  }
  const lines = values
    .filter((value) => value.composition !== null && rows.some((row) => row.key === value.key))
    .map((value) => {
      const own = rows.flatMap((row, i) => (row.key === value.key && e3s[i] !== null ? [{ e3: e3s[i]!, operation: row.operation }] : []))
      const line = document.createElement('div')
      const key = document.createElement('span')
      key.className = 'buff-sum-key'
      key.textContent = value.key
      line.append(key, document.createTextNode(compositionText(value, own)))
      return line
    })
  sum.replaceChildren(...lines)
}
