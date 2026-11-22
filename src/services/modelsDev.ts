import { create } from 'zustand'

/** models.dev 的目录缓存：一次抓取，24 小时内复用 */
/** private? 本地目录缓存版本：结构升级后换 key，强制重新拉取 */
const CACHE_KEY = 'chat-demo:models-dev:v3'
const CACHE_TTL = 24 * 60 * 60 * 1000
const ENDPOINT = 'https://models.dev/api.json'

/** 单个模型在 models.dev 里的元信息（只取我们需要的字段） */
export type ModelsDevModel = {
  id: string
  name: string
  /** 是否支持推理等级 */
  reasoning: boolean
  /** 推理等级的 id 列表；没有就是默认档位 */
  efforts: string[]
  /** 上下文窗口（token），用于对话底部用量条 */
  contextWindow?: number
  /** 单次最大输出（token） */
  maxTokens?: number
  /** 是否支持图片输入 */
  supportsImages?: boolean
  /** 是否支持工具调用（models.dev 的 tool_call） */
  supportsTools?: boolean
}

/**
 * models.dev 的 logo 权威清单来自开源仓库 https://github.com/sst/models.dev
 * 的 `providers/{id}/logo.svg`（git tree, dev 分支）。不靠抓页面猜：仓库里
 * 有 logo.svg 的才是有专属图标的厂商，其余 CDN 返回的是通用占位图。
 */
const LOGO_IDS = `302ai abacus abliteratedllm abliteration-ai above adaption adzuki agentrouter agnes ai-router ai21 aiand aigrow aihubmix aimlapi ainetcafe aipg aistupidlevel aixy aki-io alibaba alibaba-cn alibaba-coding-plan alibaba-coding-plan-cn alibaba-token-plan amazon-bedrock ambient amd anonrouter anthropic anyapi apiko arcee atomic-chat augure auriko autarcho azure azure-cognitive-services bailing baseten bee berget blueclaw bothub boundless bumo butler byteplus cedarllm cerebras cheapaimodel cheapest-token cheapllm clarifai claudinio cloudcode cloudferro-sherlock cloudflare-ai-gateway cloudflare-workers-ai cohere commandcode confidential-ai coralbricks crossmodel crusoe daoxe databricks decisionmodels deepinfra deepseek digitalocean dinference dothoosh doubleword drun ebcloud echo edenai elevenlabs empiriolabs engy entrim evroc ezkielyna fastrouter fiftyx fireworks-ai fluence fortytwo freemodel frequency friendli frogbot gisoo github-copilot gitlab google google-vertex google-vertex-anthropic graphn greenpt groq helicone hetzner hopper hostinger-router hpc-ai huawei-maas hubris huggingface humain hyper impossibl inception inceptron inco infer inferall inference inference-coop inferenceapis inferris infersia inferx infomaniak io-net isoquant iteracompute jad-ai jalapeno jiekou joingonka jzstoken keln kenari kilo kimi-code-plan-cn kimi-code-plan-global kitani klavo klingai klokintegration korouter kosmik kuae-cloud-coding-plan kunavo liquid lithosai llmgateway llmgateway-providers llmtech llmtr lmstudio logits longcat lowrouter lucidquery lyceum lynkr mallard meganova melious meragpt merge-gateway meta minimax minimax-cn minimax-cn-coding-plan minimax-coding-plan mistral mixlayer moark modal model-oracle-ai modelis modelscope modular moneo moonshotai moonshotai-cn munito munito-eu nan nano-gpt nearai nebius neon neosmith neuralwatt nodecode nokeep nova novita-ai nvidia oathbreaker obscurify oci ofox ollama-cloud openai openai-codex opencode opencode-go openreason openrouter opper orcarouter outerlabs ovhcloud paraloncloud pareto pendra perplexity perplexity-agent phala phase pioneer poe poolside powerspring prime privatemode-ai proxystacks qihang-ai qiniu-ai qvac rayline reflection refuseless regolo-ai routing-run ruapi runcrate runinfra sagg salad-cloud sambanova sandbase scaleway scnet-token-plan scx-ai sensenova siliconflow siliconflow-cn snowflake-cortex sokkan sparrowcodes stackit standardcompute steadyrouter stepfun stepfun-ai stepfun-ai-step-plan stepfun-step-plan stepping-stone subconscious submodel superbot-gg synthorai teamorouter teapot-router tencent-coding-plan tencent-token-plan tencent-tokenhub tensorx tenstorrent the-grid-ai therouter thinkingmachines tinfoil toapis togetherai tokengo tokenify tokenlab tokenrouter tokenwatt trustedrouter trustedtokens turion typesafe umans-ai umans-ai-coding-plan unbiased uncensuredai unorouter unrestricted uplinkswitch vancine venice verda vispark vivgrid volcengine volcengine-coding-plan vultr wafer.ai wallaby wally wandb watsonx watt xai xiaomi xiaomi-token-plan-ams xiaomi-token-plan-cn xiaomi-token-plan-sgp xpersona xxapi zai zai-coding-plan zeldoc zenifra zenmux zerogpu zhipuai zhipuai-coding-plan zro`.split(' ')

export const MODELS_DEV_LOGO_VENDORS = new Set(LOGO_IDS)

/** 同一个 logo 会被多个 provider id 复用（区域版 / 套餐版），只保留一个代表，避免选择器里重复 */
const LOGO_ALIASES: Record<string, string> = {
  'alibaba-coding-plan': 'alibaba',
  'alibaba-coding-plan-cn': 'alibaba',
  'alibaba-token-plan': 'alibaba',
  'azure-cognitive-services': 'azure',
  'cloudflare-workers-ai': 'cloudflare-ai-gateway',
  'google-vertex-anthropic': 'google-vertex',
  'kuae-cloud-coding-plan': 'zhipuai-coding-plan',
  'minimax-cn': 'minimax',
  'minimax-cn-coding-plan': 'minimax',
  'minimax-coding-plan': 'minimax',
  'moonshotai-cn': 'moonshotai',
  'munito-eu': 'munito',
  'opencode-go': 'opencode',
  'perplexity-agent': 'perplexity',
  'siliconflow-cn': 'siliconflow',
  'stepfun-ai': 'stepfun',
  'stepfun-ai-step-plan': 'stepfun',
  'stepfun-step-plan': 'stepfun',
  'tencent-token-plan': 'tencent-tokenhub',
  'umans-ai-coding-plan': 'umans-ai',
  'volcengine-coding-plan': 'volcengine',
  'xiaomi-token-plan-ams': 'xiaomi',
  'xiaomi-token-plan-cn': 'xiaomi',
  'xiaomi-token-plan-sgp': 'xiaomi',
  'zai-coding-plan': 'zai',
  zhipuai: 'zai',
}

/** 把复用同一 logo 的区域版/套餐版 id 收敛到代表 id */
export const canonicalLogoVendor = (vendor: string | null | undefined): string | null =>
  !vendor ? null : (LOGO_ALIASES[vendor] ?? (MODELS_DEV_LOGO_VENDORS.has(vendor) ? vendor : null))

export const hasModelLogo = (vendor: string | null | undefined): boolean =>
  !!vendor && MODELS_DEV_LOGO_VENDORS.has(vendor)

export type ModelsDevProvider = {
  id: string
  name: string
  /** 提供商的接口地址，用来和用户填的 Base URL 做智能匹配 */
  api: string
  models: ModelsDevModel[]
}

type Catalog = {
  fetchedAt: number
  providers: Record<string, ModelsDevProvider>
}

type State = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  providers: Record<string, ModelsDevProvider>
}

export const useModelsDev = create<State>(() => ({ status: 'idle', providers: {} }))

const readCache = (): Catalog | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Catalog
    if (!parsed?.providers || Date.now() - parsed.fetchedAt > CACHE_TTL) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const writeCache = (catalog: Catalog) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(catalog))
  } catch {
    // 存储不可用时只保留内存缓存
  }
}

/** models.dev 用 reasoning_options: [{type:'effort', values:['low','high',...]}] 描述可用强度 */
const readEfforts = (raw: Record<string, unknown>): string[] => {
  const values: string[] = []
  const options = raw.reasoning_options ?? raw.reasoningEfforts ?? raw.reasoning_efforts
  const push = (item: unknown) => {
    if (typeof item === 'string' && item.trim()) {
      values.push(item.trim())
    } else if (item && typeof item === 'object') {
      const nested = (item as { values?: unknown; id?: unknown }).values
      if (Array.isArray(nested)) {
        nested.forEach(push)
      } else if (typeof (item as { id?: unknown }).id === 'string') {
        values.push((item as { id: string }).id)
      }
    }
  }
  if (Array.isArray(options)) {
    options.forEach((option) => {
      // 只取 effort 类型的取值；toggle 表示可以开关思考，没有强度值
      if (option && typeof option === 'object') {
        const type = (option as { type?: unknown }).type
        if (typeof type === 'string' && type !== 'effort') {
          return
        }
      }
      push(option)
    })
  }
  return [...new Set(values)]
}

/** models.dev 原始结构里 reasoning 可能是布尔或对象，等级字段名也不统一 */
const normalizeModel = (id: string, raw: Record<string, unknown>): ModelsDevModel => {
  const reasoning = Boolean(raw.reasoning)
  const efforts = readEfforts(raw)
  const limit = raw.limit && typeof raw.limit === 'object' ? (raw.limit as Record<string, unknown>) : {}
  const positive = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
  const modalities =
    raw.modalities && typeof raw.modalities === 'object'
      ? (raw.modalities as { input?: unknown }).input
      : undefined
  const inputs = Array.isArray(modalities)
    ? modalities
    : typeof modalities === 'string'
      ? modalities.split(/\s+/)
      : []
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
    reasoning,
    efforts,
    ...(positive(limit.context) ? { contextWindow: positive(limit.context) } : {}),
    ...(positive(limit.output) ? { maxTokens: positive(limit.output) } : {}),
    ...(inputs.includes('image') ? { supportsImages: true } : {}),
    ...(raw.tool_call === true ? { supportsTools: true } : {}),
  }
}

/** 把 models.dev 的 api.json 归一化成 { providerId: { models[] } } */
export const normalizeCatalog = (payload: unknown): Record<string, ModelsDevProvider> => {
  const providers: Record<string, ModelsDevProvider> = {}
  if (!payload || typeof payload !== 'object') {
    return providers
  }
  for (const [providerId, rawProvider] of Object.entries(payload as Record<string, unknown>)) {
    if (!rawProvider || typeof rawProvider !== 'object') {
      continue
    }
    const rawModels = (rawProvider as { models?: unknown }).models
    const models: ModelsDevModel[] = []
    if (Array.isArray(rawModels)) {
      for (const item of rawModels) {
        if (item && typeof item === 'object') {
          const id = (item as { id?: unknown }).id
          if (typeof id === 'string') {
            models.push(normalizeModel(id, item as Record<string, unknown>))
          }
        }
      }
    } else if (rawModels && typeof rawModels === 'object') {
      for (const [modelId, item] of Object.entries(rawModels as Record<string, unknown>)) {
        if (item && typeof item === 'object') {
          models.push(normalizeModel(modelId, item as Record<string, unknown>))
        }
      }
    }
    providers[providerId] = {
      id: providerId,
      name:
        typeof (rawProvider as { name?: unknown }).name === 'string'
          ? (rawProvider as { name: string }).name
          : providerId,
      api: typeof (rawProvider as { api?: unknown }).api === 'string' ? (rawProvider as { api: string }).api : '',
      models,
    }
  }
  return providers
}

let inflight: Promise<void> | null = null

/**
 * 拉取 models.dev 目录（带本地缓存）。失败时静默降级：界面用模型 id 当名字。
 * 这是纯元信息来源，模型请求不依赖它。
 */
export const loadModelsDev = async (): Promise<void> => {
  if (useModelsDev.getState().status === 'ready' || inflight) {
    return inflight ?? Promise.resolve()
  }
  const cached = readCache()
  if (cached) {
    useModelsDev.setState({ status: 'ready', providers: cached.providers })
    return
  }
  useModelsDev.setState({ status: 'loading' })
  inflight = (async () => {
    try {
      const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        throw new Error(String(response.status))
      }
      const providers = normalizeCatalog(await response.json())
      useModelsDev.setState({ status: 'ready', providers })
      writeCache({ fetchedAt: Date.now(), providers })
    } catch {
      useModelsDev.setState({ status: 'error' })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** 按提供商 id 取目录（models.dev 用 `deepseek` 这类短 id） */
export const catalogProvider = (providerId: string): ModelsDevProvider | undefined =>
  useModelsDev.getState().providers[providerId]

/** 归一化用于比较的文本：去掉空格、连字符、斜杠等分隔符 */
const normalizeKey = (value: string) => value.toLowerCase().replace(/[\s\-_/.\\]+/g, '')

/** 取 URL 的主机名，取不到就返回空串 */
const hostOf = (value: string) => {
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * 智能匹配 models.dev 里的提供商：先用接口主机匹配（最可靠），
 * 再退到名称归一化后的相等 / 包含关系。匹配不到返回 null。
 */
export const matchCatalogProvider = (
  input: { id?: string; name?: string; baseUrl?: string },
  catalog?: Record<string, ModelsDevProvider>
): ModelsDevProvider | undefined => {
  const providers = Object.values(catalog ?? useModelsDev.getState().providers)
  if (providers.length === 0) {
    return undefined
  }
  const host = hostOf(input.baseUrl ?? '')
  const name = normalizeKey(input.name ?? '')
  const id = normalizeKey(input.id ?? '')
  let best: { provider: ModelsDevProvider; score: number } | undefined

  for (const provider of providers) {
    const providerHost = hostOf(provider.api)
    const providerName = normalizeKey(provider.name)
    let score = 0
    if (host && providerHost && (host === providerHost || host.endsWith(`.${providerHost}`) || providerHost.endsWith(`.${host}`))) {
      score = 100
    } else if (id && (id === provider.id || id === providerName)) {
      score = 80
    } else if (name && (name === providerName || name === provider.id)) {
      score = 70
    } else if (name && providerName && (name.includes(providerName) || providerName.includes(name))) {
      score = 50
    }
    if (score > 0 && (best === undefined || score > best.score)) {
      best = { provider, score }
    }
  }
  // 50 分只说明名字有包含关系，太容易误匹配，要求 >= 70
  return best && best.score >= 70 ? best.provider : undefined
}

/** 在目录里找某个模型（给定提供商优先，找不到再全局找 id 相同的） */
export const findCatalogModel = (
  provider: ModelsDevProvider | undefined,
  modelId: string,
  catalog?: Record<string, ModelsDevProvider>
): { provider: ModelsDevProvider; model: ModelsDevModel } | undefined => {
  const local = provider?.models.find((model) => model.id === modelId)
  if (provider && local) {
    return { provider, model: local }
  }
  for (const candidate of Object.values(catalog ?? useModelsDev.getState().providers)) {
    const model = candidate.models.find((item) => item.id === modelId)
    if (model) {
      return { provider: candidate, model }
    }
  }
  return undefined
}

/**
 * 在目录里按**完全相同的模型 id** 找它属于哪家：
 * 我们的 `deepseek-flash` 对应目录里的 `deepseek/deepseek-flash`，于是用 `deepseek.svg`。
 *
 * 同一个 id 常常被一堆中转站同时收录（例如 `gpt-4o-mini` 在 openai / azure / helicone 下都有），
 * 所以命中多个时选**收录模型最少**的那家：原厂只列自家模型（openai 51 个、deepseek 4 个），
 * 中转站动辄上百个。结论只来自目录数据，不写任何厂商规则。
 */
export const lookupModel = (
  modelId: string,
  catalog?: Record<string, ModelsDevProvider>
): { provider: ModelsDevProvider; model: ModelsDevModel } | undefined => {
  const providers = catalog ?? useModelsDev.getState().providers
  let best: { provider: ModelsDevProvider; model: ModelsDevModel } | undefined
  for (const provider of Object.values(providers)) {
    const model = provider.models.find((item) => item.id === modelId)
    if (!model) {
      continue
    }
    if (
      best === undefined ||
      provider.models.length < best.provider.models.length ||
      (provider.models.length === best.provider.models.length && provider.id < best.provider.id)
    ) {
      best = { provider, model }
    }
  }
  return best
}

/** 模型属于哪家厂商（= models.dev 的提供商 id），用于取原厂 logo；匹配不到返回 null */
export const modelVendor = (modelId: string, catalog?: Record<string, ModelsDevProvider>): string | null =>
  lookupModel(modelId, catalog)?.provider.id ?? null

/**
 * 按模型（而不是协议/提供商）解析图标：
 * 1. 配置的提供商本身在 models.dev 有同名模型时优先；
 * 2. 否则在目录里找完全相同的模型 id（含 `厂商/模型` 形式）；
 * 3. 同名模型有多家时，优先模型名/模型 id 中包含厂商名的那个。
 */
export const resolveModelVendor = (
  input: {
    modelId: string
    modelName?: string
    provider?: { id?: string; name?: string; baseUrl?: string }
  },
  catalog?: Record<string, ModelsDevProvider>
): string | null => {
  const providers = catalog ?? useModelsDev.getState().providers
  const configured = matchCatalogProvider(input.provider ?? {}, providers)
  if (configured && hasModelLogo(configured.id) && configured.models.some((model) => model.id === input.modelId)) {
    return canonicalLogoVendor(configured.id)
  }
  // 没有专属 logo 的厂商一律跳过；复用同一 logo 的只保留代表，避免重复图标
  const all = Object.values(providers).filter(
    (provider) => hasModelLogo(provider.id) && canonicalLogoVendor(provider.id) === provider.id
  )
  if (all.length === 0) {
    return null
  }
  const exact = all.filter((provider) =>
    provider.models.some(
      (model) => model.id === input.modelId || model.id.endsWith(`/${input.modelId}`)
    )
  )
  if (exact.length > 0) {
    const modelName = normalizeKey(`${input.modelName ?? ''} ${input.modelId}`)
    const scored = [...exact].sort((left, right) => {
      const score = (provider: ModelsDevProvider) =>
        (modelName.includes(normalizeKey(provider.name)) ? 10 : 0) +
        (input.modelId.startsWith(`${provider.id}/`) ? 5 : 0)
      const delta = score(right) - score(left)
      return delta !== 0 ? delta : left.models.length - right.models.length
    })
    return scored[0].id
  }
  // 没有同名模型时，允许按“模型名里包含厂商名”选一个唯一的图标。
  const modelName = normalizeKey(`${input.modelName ?? ''} ${input.modelId}`)
  const named = all.filter((provider) => modelName.includes(normalizeKey(provider.name)))
  return named.length === 1 ? named[0].id : null
}

/**
 * 每个厂 logo 是否真实存在（未知 id 在 models.dev 上返回的是 1421 字节的通用占位图）。
 * 只放内存：规则随时可改，不应该把匹配结果固化到 localStorage。
 */
const vendorLogoState = new Map<string, boolean>()
/** 未知提供商返回的占位图是 viewBox 0 0 24 24，真 logo 是 40×40 */
const LOGO_MARKER = 'viewBox="0 0 40 40"'

/** 读某厂 logo 的探测结论：undefined 表示还没探测过 */
export const vendorLogoReady = (vendor: string): boolean | undefined => vendorLogoState.get(vendor)

/**
 * 探测某个厂的 logo 是否存在，结论只缓存在内存里。
 * 同一个厂只会请求一次，组件拿到结论后直接渲染。
 */
export const ensureVendorLogo = async (vendor: string, onChange: () => void): Promise<boolean> => {
  const known = vendorLogoState.get(vendor)
  if (known !== undefined) {
    return known
  }
  try {
    const response = await fetch(`https://models.dev/logos/${encodeURIComponent(vendor)}.svg`)
    const text = await response.text()
    const ok = response.ok && text.includes(LOGO_MARKER)
    vendorLogoState.set(vendor, ok)
    onChange()
    return ok
  } catch {
    vendorLogoState.set(vendor, false)
    onChange()
    return false
  }
}

/** 真 logo 的地址 */
export const logoUrl = (logoId: string) =>
  `https://models.dev/logos/${encodeURIComponent(logoId)}.svg`
