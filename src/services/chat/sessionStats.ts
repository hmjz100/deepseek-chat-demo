import { getVisibleMessages } from './branches.js'
import { SYSTEM_PROMPT, serverTools } from './prompt.js'
import type { AssistantMessage, Message, Session } from './types.js'

/** 粗略 token 估算：CJK 按 1 token/字，其余按 4 字符/token。仅用于旧记录补算。 */
export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  let raw = 0
  for (const char of text) {
    raw += (char.codePointAt(0) ?? 0) > 0xff ? 1 : 0.25
  }
  return Math.ceil(raw)
}

const estimateMessage = (message: Message): number =>
  message.role === 'user'
    ? estimateTokens(message.content) + message.files.reduce((sum, file) => sum + estimateTokens(file.name), 0)
    : message.blocks.reduce(
        (sum, block) =>
          sum +
          (block.type === 'text'
            ? estimateTokens(block.text)
            : block.type === 'thinking'
              ? estimateTokens(block.thinking)
              : 0),
        0
      )

export type SessionStats = {
  turns: number
  steps: number
  /** 未缓存输入 */
  inputTokens: number
  /** 缓存读取 */
  cacheReadTokens: number
  /** 缓存写入 */
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
  /** 0–100；没有输入 token 时为 null */
  cacheHitPercent: number | null
  /** 模型用时（各回复 createdAt → completedAt 之和） */
  llmMs: number
  /** 首 token 延迟之和与可用步数 */
  ttftMs: number
  ttftSteps: number
  /** 输出 token 与解码时间 */
  decodeTokens: number
  decodeMs: number
  /** 当前上下文估算 token（无 usage 时用于上下文环） */
  contextTokens: number
  /** 上下文构成估算 */
  breakdown: { systemTokens: number; toolsTokens: number; messageTokens: number }
  /** 是否有旧消息缺 usage、按内容估算 */
  estimated: boolean
}

/**
 * 汇总当前分支的会话统计。优先使用消息上真实的 usage；
 * 旧记录缺 usage 时按内容估算，保证历史会话也有 token 数据。
 */
export const getSessionStats = (session: Session): SessionStats => {
  const messages = getVisibleMessages(session)
  const search = [...messages].reverse().find((message) => message.role === 'assistant')?.search ?? false
  const reminder = [...messages]
    .reverse()
    .find((message): message is AssistantMessage => message.role === 'assistant')
    ?.latestReminder
  const systemTokens = estimateTokens(SYSTEM_PROMPT + (reminder ?? ''))
  const toolsTokens = estimateTokens(JSON.stringify(serverTools(search)))

  let turns = 0
  let steps = 0
  let inputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let llmMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeTokens = 0
  let decodeMs = 0
  let estimated = false
  let contextTokens = systemTokens + toolsTokens

  for (const message of messages) {
    if (message.role === 'user') {
      turns += 1
      contextTokens += estimateMessage(message)
      continue
    }
    steps += 1
    const usage = message.usage
    const hasUsage =
      usage !== undefined &&
      usage.input_tokens +
        usage.cache_read_input_tokens +
        usage.cache_creation_input_tokens +
        usage.output_tokens >
        0
    const output = hasUsage ? usage.output_tokens : estimateMessage(message)
    if (hasUsage) {
      inputTokens += usage.input_tokens
      cacheReadTokens += usage.cache_read_input_tokens
      cacheWriteTokens += usage.cache_creation_input_tokens
      outputTokens += output
      contextTokens =
        usage.input_tokens +
        usage.cache_read_input_tokens +
        usage.cache_creation_input_tokens +
        output
    } else {
      estimated = true
      inputTokens += contextTokens
      outputTokens += output
      contextTokens += output
    }
    if (message.completedAt !== undefined && message.completedAt > message.createdAt) {
      llmMs += message.completedAt - message.createdAt
    }
    if (message.firstTokenAt !== undefined && message.firstTokenAt > message.createdAt) {
      ttftMs += message.firstTokenAt - message.createdAt
      ttftSteps += 1
    }
    const startedAt = message.firstTokenAt ?? message.createdAt
    if (message.completedAt !== undefined && message.completedAt > startedAt) {
      decodeMs += message.completedAt - startedAt
      decodeTokens += output
    }
  }

  const billedInput = inputTokens + cacheReadTokens + cacheWriteTokens
  const totalTokens = billedInput + outputTokens
  const cacheHitPercent =
    billedInput === 0
      ? null
      : cacheReadTokens >= billedInput
        ? 100
        : Math.min(99.9, Math.round((cacheReadTokens / billedInput) * 1000) / 10)
  let breakdownSystem = systemTokens
  let breakdownTools = toolsTokens
  let messageTokens = Math.max(0, contextTokens - systemTokens - toolsTokens)
  const staticTokens = systemTokens + toolsTokens
  if (staticTokens > contextTokens) {
    // 实际请求比静态估算还小：按比例压缩系统提示与工具，保证明细之和等于上下文用量。
    breakdownSystem =
      contextTokens === 0 ? 0 : Math.round((systemTokens / staticTokens) * contextTokens)
    breakdownTools = Math.max(0, contextTokens - breakdownSystem)
    messageTokens = 0
  }

  return {
    turns,
    steps,
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens,
    cacheHitPercent,
    llmMs,
    ttftMs,
    ttftSteps,
    decodeTokens,
    decodeMs,
    contextTokens,
    breakdown: {
      systemTokens: breakdownSystem,
      toolsTokens: breakdownTools,
      messageTokens,
    },
    estimated,
  }
}
