// node --test のレポーター。成功時は件数だけ、失敗時は名前・位置・エラーを出す。

interface TestEvent {
  type: string
  data: {
    name?: string
    file?: string
    line?: number
    message?: string
    details?: { type?: string; error?: { failureType?: string; message?: string; cause?: unknown } }
  }
}

const STDERR_LINES = 40

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const lines = [error.message]
  const assertion = error as Error & { expected?: unknown; actual?: unknown }
  if ('expected' in assertion || 'actual' in assertion) {
    lines.push(`expected: ${JSON.stringify(assertion.expected)}`, `actual:   ${JSON.stringify(assertion.actual)}`)
  }
  return lines.join('\n')
}

export default async function* reporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  let passed = 0
  const failures: string[] = []
  const stderr: string[] = []
  for await (const event of source) {
    const { data } = event
    if (event.type === 'test:stderr' && data.message) stderr.push(data.message.trimEnd())
    if (event.type === 'test:pass' && data.details?.type !== 'suite') passed++
    if (event.type === 'test:fail') {
      const error = data.details?.error
      if (error?.failureType === 'subtestsFailed') continue
      const where = data.file ? `${data.file}:${data.line ?? '?'}` : '(場所不明)'
      failures.push(`FAIL ${data.name} (${where})\n${describeError(error?.cause ?? error)}`)
    }
  }
  if (failures.length > 0) {
    const lines = stderr.join('\n').split('\n')
    const shown = lines.slice(0, STDERR_LINES).join('\n')
    const omitted = lines.length > STDERR_LINES ? `\n（stderr の残り ${lines.length - STDERR_LINES} 行は省略）` : ''
    const stderrBlock = stderr.length > 0 ? `\n\n--- stderr ---\n${shown}${omitted}` : ''
    yield `${failures.join('\n\n')}${stderrBlock}\n\n失敗 ${failures.length} 件 / 成功 ${passed} 件\n`
  } else if (passed === 0) {
    process.exitCode = 1
    yield 'テストが 1 件も実行されなかった\n'
  } else {
    yield `成功 ${passed} 件\n`
  }
}
