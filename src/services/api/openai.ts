import type { ChatTarget } from '../providerRuntime.js'
import { ApiError, readErrorResponse, request } from './transport.js'
import { readServerSentEvents } from './sse.js'
import type {
  AssistantBlockParam,
  CreateMessageRequest,
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
} from './types.js'

/**
 * OpenAI Chat Completions 兼容协议的适配器。
 *
 * 请求侧把 Anthropic 形状的消息转成 OpenAI 的 messages；响应侧把 SSE 增量
 * 重新拼成应用内的 Anthropic 事件流，这样回复归并、会话存储与界面无需区分协议。
 */

/** OpenAI 请求里的消息；只支持文本（附件由上层提前拦截并给出提示） */
type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const joinText = (blocks: AssistantBlockParam[]): string =>
  blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

/** 用户消息里的文件块在 OpenAI 兼容端点没有等价物，直接报可读错误 */
const assertTextOnly = (message: MessageParam) => {
  if (typeof message.content === 'string') {
    return
  }
  if (message.content.some((block) => block.type === 'image' || block.type === 'document')) {
    throw new ApiError('protocol', { key: 'providerFilesUnsupported' })
  }
}

/** Anthropic messages → OpenAI messages（system 单独作为首条） */
export const toOpenAIMessages = (body: CreateMessageRequest): OpenAIMessage[] => {
  const messages: OpenAIMessage[] = []
  if (body.system.trim()) {
    messages.push({ role: 'system', content: body.system })
  }
  for (const message of body.messages) {
    assertTextOnly(message)
    switch (message.role) {
      case 'latest_reminder':
        // Anthropic 扩展角色；OpenAI 端点没有对应位置，作为追加的系统提示保留语义。
        messages.push({ role: 'system', content: message.content })
        break
      case 'user':
        messages.push({
          role: 'user',
          content:
            typeof message.content === 'string'
              ? message.content
              : joinText(
                  message.content.filter(
                    (block): block is { type: 'text'; text: string } => block.type === 'text'
                  )
                ),
        })
        break
      case 'assistant':
        messages.push({ role: 'assistant', content: joinText(message.content) })
        break
    }
  }
  return messages
}

/** 思考强度换算成 OpenAI 风格的 reasoning_effort */
const reasoningEffort = (body: CreateMessageRequest): string | undefined => {
  if (body.thinking.type !== 'enabled') {
    return undefined
  }
  const budget = body.thinking.budget_tokens ?? 0
  return budget >= 16384 ? 'high' : budget >= 8192 ? 'medium' : 'low'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const stopReasonOf = (value: unknown): StopReason => {
  switch (value) {
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    default:
      return 'end_turn'
  }
}

const usageOf = (value: unknown): MessageUsage | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const number = (field: unknown) =>
    typeof field === 'number' && Number.isFinite(field) && field >= 0 ? field : 0
  const cached = isRecord(value.prompt_tokens_details)
    ? number(value.prompt_tokens_details.cached_tokens)
    : 0
  return {
    // Anthropic 语义的 input_tokens 只算未命中缓存的输入，缓存命中单列。
    input_tokens: Math.max(0, number(value.prompt_tokens) - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: number(value.completion_tokens),
  }
}

/** 从 choices[0] 里读增量文本/推理文本 */
const readDelta = (chunk: Record<string, unknown>) => {
  const choices = Array.isArray(chunk.choices) ? chunk.choices : []
  const choice = isRecord(choices[0]) ? choices[0] : undefined
  const delta = choice && isRecord(choice.delta) ? choice.delta : undefined
  const text =
    delta && typeof delta.content === 'string' && delta.content.length > 0 ? delta.content : ''
  const reasoning =
    delta && typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : delta && typeof delta.reasoning === 'string'
        ? delta.reasoning
        : delta && typeof delta.thinking === 'string'
          ? delta.thinking
          : ''
  return {
    text,
    reasoning,
    finishReason: choice?.finish_reason ?? null,
  }
}

/** 逐帧消费 OpenAI SSE，并归一成 Anthropic 事件流 */
export async function* streamOpenAI(
  target: ChatTarget,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const payload: Record<string, unknown> = {
    model: body.model,
    messages: toOpenAIMessages(body),
    stream: true,
  }
  const effort = reasoningEffort(body)
  if (effort) {
    payload.reasoning_effort = effort
  }
  const response = await request(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      ...target.headers,
      ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  let started = false
  let thinkingIndex: number | null = null
  let textIndex: number | null = null
  let nextIndex = 0
  let finishReason: StopReason | null = null
  let usage: MessageUsage | undefined
  let stopped = false
  let messageId = ''

  const startEvents = (chunk: Record<string, unknown>): MessageStreamEvent[] => {
    if (started) {
      return []
    }
    started = true
    messageId =
      typeof chunk.id === 'string' && chunk.id
        ? chunk.id
        : `openai-${Date.now().toString(36)}`
    const usageValue = usageOf(chunk.usage)
    if (usageValue) {
      usage = usageValue
    }
    return [
      {
        type: 'message_start',
        message: {
          id: messageId,
          model:
            typeof chunk.model === 'string' && chunk.model ? chunk.model : body.model,
          ...(usageValue ? { usage: usageValue } : {}),
        },
      },
    ]
  }

  const stopBlocks = (): MessageStreamEvent[] => {
    const events: MessageStreamEvent[] = []
    if (thinkingIndex !== null) {
      events.push({ type: 'content_block_stop', index: thinkingIndex })
      thinkingIndex = null
    }
    if (textIndex !== null) {
      events.push({ type: 'content_block_stop', index: textIndex })
      textIndex = null
    }
    return events
  }

  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      break
    }
    let chunk: unknown
    try {
      chunk = JSON.parse(data)
    } catch {
      if (eventName === 'error') {
        throw new ApiError('stream', data)
      }
      continue
    }
    if (isRecord(chunk) && 'error' in chunk && isRecord(chunk.error)) {
      const message = chunk.error.message
      throw new ApiError('stream', typeof message === 'string' ? message : JSON.stringify(chunk.error))
    }
    if (!isRecord(chunk)) {
      continue
    }
    for (const event of startEvents(chunk)) {
      yield event
    }
    const chunkUsage = usageOf(chunk.usage)
    if (chunkUsage) {
      usage = chunkUsage
    }
    const delta = readDelta(chunk)
    if (delta.reasoning) {
      if (thinkingIndex === null) {
        thinkingIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: delta.reasoning },
      }
    }
    if (delta.text) {
      if (textIndex === null) {
        textIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: delta.text },
      }
    }
    if (delta.finishReason) {
      finishReason = stopReasonOf(delta.finishReason)
      for (const event of stopBlocks()) {
        yield event
      }
    }
    if (chunkUsage) {
      yield {
        type: 'message_delta',
        delta: { stop_reason: finishReason ?? 'end_turn', stop_sequence: null },
        usage: chunkUsage,
      }
      stopped = true
    }
  }

  // 流正常结束：没收到 finish_reason 时按正常结束收尾。
  for (const event of startEvents({})) {
    yield event
  }
  for (const event of stopBlocks()) {
    yield event
  }
  if (!stopped) {
    yield {
      type: 'message_delta',
      delta: { stop_reason: finishReason ?? 'end_turn', stop_sequence: null },
      usage: usage ?? {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    }
  }
  yield { type: 'message_stop' }
}
