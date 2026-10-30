// Minecraft 1.20.4 の数値の扱いを写す。参照元はデコンパイル済みのサーバー（net.minecraft.*）。

export type NumberTag = 'float' | 'double'

const INT_MIN = -2147483648
export const INT_MAX = 2147483647

/** Java の (int) キャスト。 */
export function toInt(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value >= INT_MAX) return INT_MAX
  if (value <= INT_MIN) return INT_MIN
  return Math.trunc(value)
}

/** Mth.floor(double)。 */
export function floor(value: number): number {
  const truncated = toInt(value)
  return value < truncated ? truncated - 1 : truncated
}

/** NBT の数値タグに入れたときの値。 */
export function asTag(value: number, tag: NumberTag): number {
  return tag === 'float' ? Math.fround(value) : value
}

/** `data get <path> <scale>`（DataCommands）。 */
export function dataGet(value: number, scale: number): number {
  return floor(value * scale)
}

/** `execute store result storage ... double <scale>`。 */
export function storeDouble(result: number, scale: number): number {
  return result * scale
}

/** `attribute <target> <attribute> get <scale>`（AttributeCommand）。 */
export function attributeGet(value: number, scale: number): number {
  return toInt(value * scale)
}

/** scoreboard の `*=`。int の桁あふれも写す。 */
export function mul(a: number, b: number): number {
  return Math.imul(a, b)
}

/** scoreboard の `+=`。 */
export function add(a: number, b: number): number {
  return (a + b) | 0
}

/** scoreboard の `-=`。 */
export function sub(a: number, b: number): number {
  return (a - b) | 0
}

/** scoreboard の `/=`（OperationArgument）。 */
export function div(a: number, b: number): number {
  return Math.floor(a / b) | 0
}

/** scoreboard の `%=`（Mth.positiveModulo）。 */
export function mod(a: number, b: number): number {
  return (((a % b) + b) % b) | 0
}

/** scoreboard の `<`（小さい方）。 */
export function min(a: number, b: number): number {
  return Math.min(a, b)
}

/** scoreboard の `>`（大きい方）。 */
export function max(a: number, b: number): number {
  return Math.max(a, b)
}
