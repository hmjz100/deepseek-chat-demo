import type { TranslationKey } from '../i18n/index.js'
import { API_ORIGIN, ApiError, request } from './api/client.js'
import {
  useProviders,
  type CustomProvider,
  type ProviderModel,
  type ProviderProtocol,
} from './providers.js'
import { useSettings } from './settings.js'

/** 内置 DeepSeek 提供商在设置里的 id */
export const BUILTIN_PROVIDER_ID = 'deepseek'

/** 内置 DeepSeek 的 Anthropic 兼容接口根地址 */
export const BUILTIN_ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic/v1`

/** 一次聊天请求实际会走到的目标 */
export type ChatTarget = {
  providerId: string
  providerName: string
  protocol: ProviderProtocol
  apiKey: string
  /** 根地址，末尾不带斜杠 */
  baseUrl: string
  /** 是否可用 Anthropic Files API 上传附件 */
  filesApi: boolean
  headers: Record<string, string>
  /** 是否为用户自行添加的提供商 */
  custom: boolean
}

/** 去掉末尾斜杠；空串保持空串，交给调用方报错 */
export const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, '')

/** 协议展示名（设置页下拉与请求头提示共用） */
export const PROTOCOL_OPTIONS: { value: ProviderProtocol; labelKey: TranslationKey }[] = [
  { value: 'openai-completions', labelKey: 'providerProtocolOpenai' },
  { value: 'openai-responses', labelKey: 'providerProtocolOpenaiResponses' },
  { value: 'anthropic-messages', labelKey: 'providerProtocolAnthropic' },
  { value: 'google-generative-ai', labelKey: 'providerProtocolGemini' },
]

/** 按协议给出 Base URL 的填写提示 */
export const providerBaseUrlPlaceholderKey = (
  protocol: ProviderProtocol
): TranslationKey => {
  switch (protocol) {
    case 'anthropic-messages':
      return 'providerBaseUrlPlaceholderAnthropic'
    case 'openai-responses':
      return 'providerBaseUrlPlaceholderOpenaiResponses'
    case 'google-generative-ai':
      return 'providerBaseUrlPlaceholderGemini'
    default:
      return 'providerBaseUrlPlaceholderOpenai'
  }
}

/** 与 DSH 的 protocol-rules 对齐：Gemini 的 pi-ai 实现没有 Key 会直接拒绝请求 */
export const protocolNeedsKey = (protocol: ProviderProtocol): boolean =>
  protocol === 'google-generative-ai'

/** 模型列表地址（Gemini 走 /models，其他协议也是 /models） */
export const providerModelsEndpoint = (baseUrl: string) => `${normalizeBaseUrl(baseUrl)}/models`

const customHeaders = (provider: CustomProvider): Record<string, string> => {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(provider.headers ?? {})) {
    if (key.trim() && value.trim()) {
      headers[key.trim()] = value.trim()
    }
  }
  return headers
}

/** 把自定义提供商解析成请求目标；空地址或未启用时返回 null */
export const providerTarget = (provider: CustomProvider): ChatTarget | null => {
  const baseUrl = normalizeBaseUrl(provider.baseUrl)
  if (!provider.enabled || !baseUrl) {
    return null
  }
  return {
    providerId: provider.id,
    providerName: provider.name.trim() || provider.id,
    protocol: provider.protocol,
    apiKey: provider.apiKey.trim(),
    baseUrl,
    filesApi: provider.protocol === 'anthropic-messages' && provider.filesApi === true,
    headers: customHeaders(provider),
    custom: true,
  }
}

/** 内置 DeepSeek 目标：API Key 来自全局设置，附件走 Files API */
export const builtinTarget = (): ChatTarget => ({
  providerId: BUILTIN_PROVIDER_ID,
  providerName: 'DeepSeek',
  protocol: 'anthropic-messages',
  apiKey: useSettings.getState().apiKey ?? '',
  baseUrl: BUILTIN_ANTHROPIC_BASE_URL,
  filesApi: true,
  headers: {},
  custom: false,
})

/** 取当前设置选中的提供商；未配置好时回落到内置 DeepSeek */
export const resolveChatTarget = (): ChatTarget => {
  const { providerId } = useSettings.getState()
  if (providerId === BUILTIN_PROVIDER_ID) {
    return builtinTarget()
  }
  const provider = useProviders.getState().providers.find((item) => item.id === providerId)
  return (provider && providerTarget(provider)) ?? builtinTarget()
}

/** 取指定提供商的模型配置；内置模型返回一个通用配置 */
export const providerModel = (providerId: string, modelId: string): ProviderModel => {
  if (providerId === BUILTIN_PROVIDER_ID) {
    return { id: modelId, reasoning: true, supportsImages: true }
  }
  const provider = useProviders.getState().providers.find((item) => item.id === providerId)
  return provider?.models.find((model) => model.id === modelId) ?? { id: modelId }
}

/** 模型列表接口的原始条目 */
type ModelListing = Record<string, unknown>

const readPositive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined

const readCapability = (raw: ModelListing, names: string[]): boolean | undefined => {
  for (const name of names) {
    if (raw[name] === true) {
      return true
    }
    if (raw[name] === false) {
      return false
    }
  }
  const capabilities = raw.capabilities
  if (capabilities && typeof capabilities === 'object') {
    for (const name of names) {
      if ((capabilities as Record<string, unknown>)[name] === true) {
        return true
      }
    }
  }
  return undefined
}

/** 把模型列表条目归一成设置里的模型结构 */
export const normalizeDiscoveredModel = (raw: ModelListing): ProviderModel | null => {
  const rawId =
    typeof raw.id === 'string'
      ? raw.id.trim()
      : typeof raw.name === 'string'
        ? raw.name.trim().replace(/^models\//, '')
        : ''
  if (!rawId) {
    return null
  }
  const name =
    typeof raw.displayName === 'string' && raw.displayName.trim()
      ? raw.displayName.trim()
      : typeof raw.name === 'string' && raw.name.trim() && raw.name.trim() !== rawId
        ? raw.name.trim()
        : undefined
  const contextWindow =
    readPositive(raw.contextWindow) ??
    readPositive(raw.context_length) ??
    readPositive(raw.context_window) ??
    readPositive(raw.max_context_length) ??
    readPositive(raw.max_input_tokens) ??
    readPositive(raw.inputTokenLimit)
  const maxTokens =
    readPositive(raw.maxTokens) ??
    readPositive(raw.max_tokens) ??
    readPositive(raw.max_output_tokens) ??
    readPositive(raw.outputTokenLimit)
  const reasoning = readCapability(raw, [
    'reasoning',
    'supports_reasoning',
    'reasoning_content',
    'thinking',
  ])
  const supportsImages = readCapability(raw, [
    'supportsImages',
    'supports_images',
    'vision',
    'image_input',
  ])
  return {
    id: rawId,
    ...(name && name !== rawId ? { name } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(supportsImages ? { supportsImages } : {}),
  }
}

/** 把任意模型列表响应归一成模型结构；兼容 data / models / 数组三种形状 */
export const normalizeModelList = (payload: unknown): ProviderModel[] => {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : payload && typeof payload === 'object' && Array.isArray((payload as { models?: unknown }).models)
        ? (payload as { models: unknown[] }).models
        : []
  const models: ProviderModel[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (typeof item === 'string') {
      if (item.trim() && !seen.has(item.trim())) {
        seen.add(item.trim())
        models.push({ id: item.trim() })
      }
      continue
    }
    if (!item || typeof item !== 'object') {
      continue
    }
    const model = normalizeDiscoveredModel(item as ModelListing)
    if (model && !seen.has(model.id)) {
      seen.add(model.id)
      models.push(model)
    }
  }
  return models
}

/** 未保存的探针配置：设置页“获取模型列表/测试连接”用表单当前值 */
export type ProviderDraft = {
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  headers?: Record<string, string>
}

const draftHeaders = (draft: ProviderDraft): Record<string, string> => {
  const headers: Record<string, string> = { ...draft.headers }
  if (draft.apiKey.trim()) {
    if (draft.protocol === 'anthropic-messages') {
      headers['x-api-key'] = draft.apiKey.trim()
      headers['anthropic-version'] ??= '2023-06-01'
    } else if (draft.protocol === 'google-generative-ai') {
      headers['x-goog-api-key'] = draft.apiKey.trim()
    } else {
      headers.Authorization = `Bearer ${draft.apiKey.trim()}`
    }
  }
  return headers
}

/** GET {baseUrl}/models；失败时抛出 ApiError（含服务端错误信息） */
export const discoverProviderModels = async (
  draft: ProviderDraft,
  signal?: AbortSignal
): Promise<ProviderModel[]> => {
  if (protocolNeedsKey(draft.protocol) && !draft.apiKey.trim()) {
    throw new ApiError('auth', { key: 'providerApiKeyRequired' })
  }
  const response = await request(providerModelsEndpoint(draft.baseUrl), {
    method: 'GET',
    headers: draftHeaders(draft),
    signal,
  })
  return normalizeModelList(await response.json())
}

/** 测试连接：能列出模型即视为可用 */
export const verifyProviderDraft = async (draft: ProviderDraft, signal?: AbortSignal) => {
  if (protocolNeedsKey(draft.protocol) && !draft.apiKey.trim()) {
    throw new ApiError('auth', { key: 'providerApiKeyRequired' })
  }
  await request(providerModelsEndpoint(draft.baseUrl), {
    method: 'GET',
    headers: draftHeaders(draft),
    signal,
  })
}
