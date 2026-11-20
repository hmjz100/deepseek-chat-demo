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

/** OpenAI Responses 兼容协议的适配器：请求转成 responses 形状，SSE 再归一成内部事件。 */

type ResponsesContent = { type: 'input_text' | 'output_text'; text: string }
type ResponsesItem = { role: 'user' | 'assistant'; content: ResponsesContent[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const joinText = (blocks: AssistantBlockParam[]): string =>
  blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

const assertTextOnly = (message: MessageParam) => {
  if (typeof message.content === 'string') {
    return
  }
  if (message.content.some((block) => block.type === 'image' || block.type === 'document')) {
    throw new ApiError('protocol', { key: 'providerFilesUnsupported' })
  }
}

const reasoningEffort = (body: CreateMessageRequest): string | undefined => {
  if (body.thinking.type !== 'enabled') {
    return undefined
  }
  const budget = body.thinking.budget_tokens ?? 0
  return budget >= 16384 ? 'high' : budget >= 8192 ? 'medium' : 'low'
}

const stopReasonOf = (value: unknown): StopReason => {
  switch (value) {
    case 'max_output_tokens':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    default:
      return 'end_turn'
  }
}

const readUsage = (value: unknown): MessageUsage | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const number = (field: unknown) =>
    typeof field === 'number' && Number.isFinite(field) ? Math.max(0, Math.round(field)) : 0
  const cached = isRecord(value.input_tokens_details)
    ? number(value.input_tokens_details.cached_tokens)
    : 0
  const prompt = number(value.input_tokens)
  return {
    input_tokens: Math.max(0, prompt - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: number(value.output_tokens),
  }
}

/**
 * POST {baseUrl}/responses（stream: true），逐个产出内部流式事件。
 */
export async function* streamOpenAIResponses(
  target: ChatTarget,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const reminders: string[] = []
  const input: ResponsesItem[] = []
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      reminders.push(message.content)
      continue
    }
    assertTextOnly(message)
    if (message.role === 'user') {
      input.push({
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              typeof message.content === 'string'
                ? message.content
                : message.content
                    .filter(
                      (block): block is { type: 'text'; text: string } => block.type === 'text'
                    )
                    .map((block) => block.text)
                    .join(''),
          },
        ],
      })
    } else {
      input.push({
        role: 'assistant',
        content: [{ type: 'output_text', text: joinText(message.content) }],
      })
    }
  }
  const instructions = [body.system, ...reminders].filter((part) => part.trim()).join('\n\n')
  const effort = reasoningEffort(body)

  const response = await request(`${target.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      ...target.headers,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: body.model,
      input,
      ...(instructions ? { instructions } : {}),
      stream: true,
      ...(body.max_tokens ? { max_output_tokens: body.max_tokens } : {}),
      ...(effort ? { reasoning: { effort, summary: 'auto' } } : {}),
    }),
    signal,
  })
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  yield {
    type: 'message_start',
    message: { id: `resp_${Date.now()}`, model: body.model },
  }

  let nextIndex = 0
  let blockIndex = -1
  let blockKind: 'text' | 'thinking' | null = null
  let usage: MessageUsage | undefined
  let stopReason: StopReason = 'end_turn'
  let started = false
  let finished = false

  const start = (kind: 'text' | 'thinking'): MessageStreamEvent => {
    blockIndex = nextIndex
    blockKind = kind
    nextIndex += 1
    return {
      type: 'content_block_start',
      index: blockIndex,
      content_block:
        kind === 'text'
          ? { type: 'text', text: '' }
          : { type: 'thinking', thinking: '', signature: '' },
    }
  }

  if (!response.body) {
    throw new ApiError('protocol', 'Responses response has no body')
  }
  const stream = response.body

  for await (const event of readServerSentEvents(stream, signal)) {
    if (event.data === '[DONE]') {
      break
    }
    let data: unknown
    try {
      data = JSON.parse(event.data)
    } catch {
      continue
    }
    if (!isRecord(data)) {
      continue
    }
    switch (data.type) {
      case 'response.output_text.delta': {
        started = true
        const text = typeof data.delta === 'string' ? data.delta : ''
        if (!text) {
          break
        }
        if (blockKind !== 'text') {
          if (blockKind !== null) {
            yield { type: 'content_block_stop', index: blockIndex }
          }
          yield start('text')
        }
        yield {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text },
        }
        break
      }
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        started = true
        const text = typeof data.delta === 'string' ? data.delta : ''
        if (!text) {
          break
        }
        if (blockKind !== 'thinking') {
          if (blockKind !== null) {
            yield { type: 'content_block_stop', index: blockIndex }
          }
          yield start('thinking')
        }
        yield {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'thinking_delta', thinking: text },
        }
        break
      }
      case 'response.output_item.done': {
        if (blockKind !== null) {
          yield { type: 'content_block_stop', index: blockIndex }
          blockKind = null
        }
        break
      }
      case 'response.completed':
      case 'response.incomplete': {
        const payload = isRecord(data.response) ? data.response : {}
        usage = readUsage(payload.usage) ?? usage
        stopReason = stopReasonOf(
          isRecord(payload.incomplete_details) ? payload.incomplete_details.reason : undefined
        )
        finished = true
        break
      }
      case 'response.failed':
      case 'error': {
        const error = isRecord(data.error) ? data.error : data
        throw new ApiError(
          'protocol',
          typeof error.message === 'string' ? error.message : 'Responses request failed'
        )
      }
      default:
        break
    }
    if (finished) {
      break
    }
  }

  if (!started && usage === undefined) {
    throw new ApiError('protocol', 'Empty Responses stream')
  }
  if (blockKind !== null) {
    yield { type: 'content_block_stop', index: blockIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    ...(usage ? { usage } : {}),
  }
  yield { type: 'message_stop' }
}
