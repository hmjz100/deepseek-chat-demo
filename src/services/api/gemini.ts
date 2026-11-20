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

/** Google Gemini Generative AI 适配器：请求转成 contents/parts，SSE 再归一成内部事件。 */

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

const stopReasonOf = (value: unknown): StopReason => {
  switch (value) {
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
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
  const cached = number(value.cachedContentTokenCount)
  const prompt = number(value.promptTokenCount)
  return {
    input_tokens: Math.max(0, prompt - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: number(value.candidatesTokenCount) + number(value.thoughtsTokenCount),
  }
}

/**
 * POST {baseUrl}/models/{model}:streamGenerateContent?alt=sse。
 */
export async function* streamGemini(
  target: ChatTarget,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (!target.apiKey) {
    throw new ApiError('auth', { key: 'providerApiKeyRequired' })
  }
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = []
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      contents.push({ role: 'user', parts: [{ text: message.content }] })
      continue
    }
    assertTextOnly(message)
    if (message.role === 'user') {
      contents.push({
        role: 'user',
        parts: [
          {
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
      contents.push({ role: 'model', parts: [{ text: joinText(message.content) }] })
    }
  }
  const model = body.model.replace(/^models\//, '')
  const url = `${target.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`

  const generationConfig = {
    ...(body.max_tokens ? { maxOutputTokens: body.max_tokens } : {}),
    ...(body.thinking.type === 'enabled'
      ? {
          thinkingConfig: {
            includeThoughts: true,
            ...(body.thinking.budget_tokens
              ? { thinkingBudget: body.thinking.budget_tokens }
              : {}),
          },
        }
      : {}),
  }
  const response = await request(url, {
    method: 'POST',
    headers: {
      ...target.headers,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-goog-api-key': target.apiKey,
    },
    body: JSON.stringify({
      contents,
      ...(body.system.trim() ? { systemInstruction: { parts: [{ text: body.system }] } } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    }),
    signal,
  })
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  yield {
    type: 'message_start',
    message: { id: `gemini_${Date.now()}`, model: body.model },
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
    throw new ApiError('protocol', 'Gemini response has no body')
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
    if (isRecord(data.error)) {
      throw new ApiError(
        'protocol',
        typeof data.error.message === 'string' ? data.error.message : 'Gemini request failed'
      )
    }
    const candidate = Array.isArray(data.candidates)
      ? (data.candidates.find(isRecord) as Record<string, unknown> | undefined)
      : undefined
    if (isRecord(data.usageMetadata)) {
      usage = readUsage(data.usageMetadata) ?? usage
    }
    if (candidate) {
      const content = isRecord(candidate.content) ? candidate.content : undefined
      const parts = content && Array.isArray(content.parts) ? content.parts : []
      for (const part of parts) {
        if (!isRecord(part) || typeof part.text !== 'string' || !part.text) {
          continue
        }
        started = true
        const kind = part.thought === true ? 'thinking' : 'text'
        if (blockKind !== kind) {
          if (blockKind !== null) {
            yield { type: 'content_block_stop', index: blockIndex }
          }
          yield start(kind)
        }
        yield {
          type: 'content_block_delta',
          index: blockIndex,
          delta:
            kind === 'thinking'
              ? { type: 'thinking_delta', thinking: part.text }
              : { type: 'text_delta', text: part.text },
        }
      }
      if (typeof candidate.finishReason === 'string') {
        stopReason = stopReasonOf(candidate.finishReason)
        finished = true
      }
    }
    if (finished) {
      break
    }
  }

  if (!started && usage === undefined) {
    throw new ApiError('protocol', 'Empty Gemini stream')
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
