import { create } from 'zustand'
import { canonicalLogoVendor } from './modelsDev.js'

/**
 * 兼容协议（与 DSH 的 pi-ai 协议标识一致）：
 * - anthropic-messages：Anthropic Messages API
 * - openai-completions：OpenAI Chat Completions
 * - openai-responses：OpenAI Responses
 * - google-generative-ai：Google Gemini Generative AI
 */
export type ProviderProtocol =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses'
  | 'google-generative-ai'

/** 一个提供商下可选的模型；除 id 外的字段都是可选的展示/能力元数据 */
export type ProviderModel = {
  /** 请求体里的 model 字段 */
  id: string
  /** 展示名；缺省时用 models.dev 或 id */
  name?: string
  /** 用户显式选择的厂商图标 id（models.dev provider id） */
  icon?: string
  /** 上下文窗口（token），仅用于展示与设置提示 */
  contextWindow?: number
  /** 单次最大输出（token），仅用于展示 */
  maxTokens?: number
  /** 该模型是否支持推理/思考参数 */
  reasoning?: boolean
  /** 该模型是否支持图片输入 */
  supportsImages?: boolean
  /** 该模型是否支持工具调用 */
  supportsTools?: boolean
  /** 端点返回的可用思考强度 id（models.dev 风格，如 low / high / max） */
  efforts?: string[]
}

/** 用户自行添加的模型提供商 */
export type CustomProvider = {
  /** 内部路由 id，唯一，用于选择与持久化 */
  id: string
  /** 展示名；空时回落到 id */
  name: string
  /** 接口根地址（含版本段，例如 https://api.openai.com/v1） */
  baseUrl: string
  /** 兼容协议 */
  protocol: ProviderProtocol
  /** API Key；允许为空（某些本地网关不需要） */
  apiKey: string
  /** 该提供商下可选用的模型 */
  models: ProviderModel[]
  /** 只有启用的提供商会出现在模型选择器里 */
  enabled: boolean
  /**
   * 是否支持 Anthropic Files API 上传附件。
   * 只有兼容 DeepSeek/Anthropic Files API 的端点才应打开；内置 DeepSeek 恒为支持。
   */
  filesApi: boolean
  /** 追加到每个请求的自定义请求头（可选） */
  headers?: Record<string, string>
}

const KEY = 'chat-demo:providers'

const createId = () => `p_${Math.random().toString(36).slice(2, 10)}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeProtocol = (value: unknown): ProviderProtocol => {
  switch (value) {
    case 'openai':
    case 'openai-completions':
      return 'openai-completions'
    case 'responses':
    case 'openai-responses':
      return 'openai-responses'
    case 'gemini':
    case 'google':
    case 'google-generative-ai':
      return 'google-generative-ai'
    default:
      return 'anthropic-messages'
  }
}

/** 协议对应的默认展示名，新建/旧空名字时使用 */
export const protocolDefaultName = (protocol: ProviderProtocol): string => {
  switch (protocol) {
    case 'openai-completions':
      return 'OpenAI'
    case 'openai-responses':
      return 'OpenAI Responses'
    case 'google-generative-ai':
      return 'Gemini'
    default:
      return 'Anthropic'
  }
}

const normalizeModel = (value: unknown): ProviderModel | null => {
  if (typeof value === 'string') {
    return value.trim() ? { id: value.trim() } : null
  }
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    return null
  }
  const number = (field: unknown) =>
    typeof field === 'number' && Number.isFinite(field) && field > 0 ? Math.round(field) : undefined
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : undefined
  return {
    id: value.id.trim(),
    ...(name ? { name } : {}),
    ...(typeof value.icon === 'string' && value.icon.trim()
      ? { icon: canonicalLogoVendor(value.icon.trim()) ?? value.icon.trim() }
      : {}),
    ...(number(value.contextWindow) ? { contextWindow: number(value.contextWindow) } : {}),
    ...(number(value.maxTokens) ? { maxTokens: number(value.maxTokens) } : {}),
    ...(value.reasoning === true ? { reasoning: true } : {}),
    ...(value.supportsImages === true ? { supportsImages: true } : {}),
    ...(value.supportsTools === true ? { supportsTools: true } : {}),
    ...(Array.isArray(value.efforts)
      ? {
          efforts: value.efforts.filter(
            (item): item is string => typeof item === 'string' && item.trim() !== ''
          ),
        }
      : {}),
  }
}

const normalizeModels = (value: unknown): ProviderModel[] => {
  if (!Array.isArray(value)) {
    return []
  }
  const models: ProviderModel[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const model = normalizeModel(item)
    if (model && !seen.has(model.id)) {
      seen.add(model.id)
      models.push(model)
    }
  }
  return models
}

const read = (): CustomProvider[] => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isRecord).map((item) => {
      const protocol = normalizeProtocol(item.protocol)
      return {
        id: typeof item.id === 'string' && item.id ? item.id : createId(),
        // 旧版本允许空名字；读取时补一个协议默认名，避免模型选择器显示内部 id
        name:
          typeof item.name === 'string' && item.name.trim()
            ? item.name
            : protocolDefaultName(protocol),
        baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl : '',
        protocol,
        apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
        models: normalizeModels(item.models),
        enabled: item.enabled !== false,
        filesApi: item.filesApi === true,
        ...(isRecord(item.headers)
          ? {
              headers: Object.fromEntries(
                Object.entries(item.headers).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string'
                )
              ),
            }
          : {}),
      }
    })
  } catch {
    return []
  }
}

const write = (providers: CustomProvider[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(providers))
  } catch {
    // 存储不可用时只保留内存状态
  }
}

type State = { providers: CustomProvider[] }

export const useProviders = create<State>(() => ({ providers: read() }))

const commit = (providers: CustomProvider[]) => {
  write(providers)
  useProviders.setState({ providers })
}

/** 新增一个空提供商，返回它的 id；协议决定默认占位地址 */
export const addProvider = (protocol: ProviderProtocol = 'openai-completions'): string => {
  const provider: CustomProvider = {
    id: createId(),
    // 默认给一个可读名字；用户可以在卡片头部直接改名
    name: protocolDefaultName(protocol),
    baseUrl: '',
    protocol,
    apiKey: '',
    models: [],
    enabled: true,
    filesApi: false,
  }
  commit([...useProviders.getState().providers, provider])
  return provider.id
}

export const updateProvider = (id: string, patch: Partial<Omit<CustomProvider, 'id'>>) => {
  commit(
    useProviders.getState().providers.map((provider) =>
      provider.id === id ? { ...provider, ...patch } : provider
    )
  )
}

export const removeProvider = (id: string) => {
  commit(useProviders.getState().providers.filter((provider) => provider.id !== id))
}

export const setProviderModels = (id: string, models: ProviderModel[]) => {
  updateProvider(id, { models: normalizeModels(models) })
}

export const addProviderModel = (id: string, model: ProviderModel = { id: '' }) => {
  const provider = useProviders.getState().providers.find((item) => item.id === id)
  if (!provider) {
    return
  }
  updateProvider(id, { models: [...provider.models, model] })
}

export const updateProviderModel = (id: string, index: number, patch: Partial<ProviderModel>) => {
  const provider = useProviders.getState().providers.find((item) => item.id === id)
  if (!provider || !provider.models[index]) {
    return
  }
  updateProvider(id, {
    models: provider.models.map((model, at) => (at === index ? { ...model, ...patch } : model)),
  })
}

export const removeProviderModel = (id: string, index: number) => {
  const provider = useProviders.getState().providers.find((item) => item.id === id)
  if (!provider) {
    return
  }
  updateProvider(id, { models: provider.models.filter((_model, at) => at !== index) })
}

/** 只返回启用的提供商，模型选择器与请求路由都用它 */
export const enabledProviders = (providers: CustomProvider[]) =>
  providers.filter((provider) => provider.enabled)

/** 一张全空的提供商卡片（只留默认名字）在设置关闭时自动丢弃 */
export const isBlankProvider = (provider: CustomProvider) => {
  const defaultName = protocolDefaultName(provider.protocol)
  return (
    (!provider.name.trim() || provider.name.trim() === defaultName) &&
    !provider.baseUrl.trim() &&
    !provider.apiKey.trim() &&
    provider.models.length === 0
  )
}

export const pruneBlankProviders = () => {
  const providers = useProviders.getState().providers
  const kept = providers.filter((provider) => !isBlankProvider(provider))
  if (kept.length !== providers.length) {
    commit(kept)
  }
}
