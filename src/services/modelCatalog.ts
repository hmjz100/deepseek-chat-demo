import { useEffect, useMemo } from 'react'
import {
  useSettings,
  type ThinkingEffort,
} from './settings.js'
import {
  enabledProviders,
  useProviders,
  type CustomProvider,
  type ProviderModel,
} from './providers.js'
import {
  canonicalLogoVendor,
  findCatalogModel,
  hasModelLogo,
  loadModelsDev,
  resolveModelVendor,
  useModelsDev,
  type ModelsDevProvider,
} from './modelsDev.js'

/** 内置 DeepSeek 提供商的模型（请求走官方 Anthropic 兼容接口） */
const BUILTIN_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek Flash', vendor: 'deepseek' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vendor: 'deepseek' },
]

export const BUILTIN_PROVIDER_ID = 'deepseek'
export const EFFORTS: ThinkingEffort[] = ['standard', 'deep', 'max']

/**
 * 搜索归一化：空格、连字符、下划线、斜杠、反斜杠一律忽略，
 * 于是「DeepSeek V4」「DeepSeek-V4」「DeepSeek/V4」都能互相命中。
 */
export const normalizeModelQuery = (value: string) => value.toLowerCase().replace(/[\s\-_/\\]+/g, '')

export const matchesModelQuery = (model: { id: string; name: string }, query: string) => {
  const keyword = normalizeModelQuery(query)
  return keyword === '' || normalizeModelQuery(`${model.name} ${model.id}`).includes(keyword)
}

export type ModelEntry = {
  providerId: string
  providerName: string
  id: string
  name: string
  /** 该模型属于哪家厂商（models.dev 的 logo id），用于显示原厂 logo */
  vendor: string | null
  /** 该模型是否支持推理/思考参数 */
  reasoning: boolean
  /** models.dev / 端点返回的可用思考强度 */
  efforts: ThinkingEffort[]
  /** 是否支持图片输入 */
  supportsImages: boolean
  /** 是否支持工具调用 */
  supportsTools: boolean
}

/** 把 models.dev 的 effort id（low/medium/high/xhigh/max…）映射到界面的三档 */
export const mapEfforts = (raw: string[] | undefined): ThinkingEffort[] => {
  if (!raw || raw.length === 0) {
    return EFFORTS
  }
  const result: ThinkingEffort[] = []
  for (const value of raw) {
    const id = value.toLowerCase()
    // none 表示关闭思考，不对应界面上的强度档位
    if (id === 'none') {
      continue
    }
    const effort: ThinkingEffort =
      id === 'max' || id === 'xhigh' ? 'max' : id === 'low' || id === 'minimal' ? 'standard' : 'deep'
    if (!result.includes(effort)) {
      result.push(effort)
    }
  }
  return result.sort((left, right) => EFFORTS.indexOf(left) - EFFORTS.indexOf(right))
}

/** 按模型解析厂商；用户在设置里显式选择的图标优先，但只接受真实存在的 logo */
const resolveCustomVendor = (
  provider: CustomProvider,
  model: ProviderModel,
  catalog: Record<string, ModelsDevProvider>
): string | null =>
  (model.icon && hasModelLogo(model.icon) ? canonicalLogoVendor(model.icon) : null) ??
  canonicalLogoVendor(
    resolveModelVendor(
      {
        modelId: model.id,
        modelName: model.name,
        provider: { id: provider.id, name: provider.name, baseUrl: provider.baseUrl },
      },
      catalog
    )
  )

/** 组装可选模型：内置 DeepSeek + 每个启用的自定义提供商 */
export const buildEntries = (
  providers: CustomProvider[],
  catalog: Record<string, ModelsDevProvider>
): ModelEntry[] => {
  const entries: ModelEntry[] = BUILTIN_MODELS.map((model) => {
    // 名字尽量用目录里的真名；厂商固定是 deepseek，不再靠易错的模型 id 匹配推断
    const found = findCatalogModel(catalog.deepseek, model.id, catalog)
    return {
      providerId: BUILTIN_PROVIDER_ID,
      providerName: 'DeepSeek',
      id: model.id,
      name: found?.model.name ?? model.name,
      vendor: model.vendor,
      reasoning: true,
      efforts: mapEfforts(found?.model.efforts),
      supportsImages: found?.model.supportsImages ?? true,
      supportsTools: found?.model.supportsTools ?? true,
    }
  })
  for (const provider of enabledProviders(providers)) {
    for (const model of provider.models) {
      if (!model.id.trim()) {
        continue
      }
      const id = model.id
      const vendor = resolveCustomVendor(provider, model, catalog)
      const found = findCatalogModel(vendor ? catalog[vendor] : undefined, id, catalog)
      entries.push({
        providerId: provider.id,
        providerName: provider.name || provider.id,
        id,
        name: model.name ?? found?.model.name ?? id,
        vendor,
        reasoning: model.reasoning ?? found?.model.reasoning ?? false,
        efforts: mapEfforts(model.efforts ?? found?.model.efforts),
        supportsImages: model.supportsImages ?? found?.model.supportsImages ?? false,
        supportsTools: model.supportsTools ?? found?.model.supportsTools ?? false,
      })
    }
  }
  return entries
}

/** 当前设置选中的模型（找不到时回落到第一个可用模型） */
export const useCurrentModelEntry = (): ModelEntry | undefined => {
  const providerId = useSettings((state) => state.providerId)
  const model = useSettings((state) => state.model)
  const providers = useProviders((state) => state.providers)
  const catalog = useModelsDev((state) => state.providers)
  const entries = useMemo(() => buildEntries(providers, catalog), [providers, catalog])
  return entries.find((entry) => entry.providerId === providerId && entry.id === model) ?? entries[0]
}

/** 页面进入时拉取目录，保证能力信息（思考强度/图片/工具）可用 */
export const useLoadModelCatalog = () => {
  useEffect(() => {
    void loadModelsDev()
  }, [])
}
