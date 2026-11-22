import { create } from 'zustand'
import { resolveChatTarget, protocolNeedsKey, BUILTIN_PROVIDER_ID } from '../../services/providerRuntime.js'
import { setProvider, useSettings } from '../../services/settings.js'
import { useProviders } from '../../services/providers.js'

/** 设置弹窗的分组：通用设置 / 账号管理 / 数据管理 / 服务协议 */
export type SettingsSection = 'general' | 'account' | 'data' | 'terms'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 是否配置了官方 DeepSeek API Key（语音、朗读、智能搜索等官方接口依赖它） */
export const hasOfficialApiKey = () => !!useSettings.getState().apiKey?.trim()

/** 是否已经添加过任意供应商 */
export const hasAnyProvider = () => useProviders.getState().providers.length > 0

/** 只有「既没有 Key、也没有任何供应商」时才算首次使用，需要引导账号管理 */
export const needsAccountSetup = () => !hasOfficialApiKey() && !hasAnyProvider()

/**
 * 当前选中的提供商是否可以发请求：内置 DeepSeek 需要全局 API Key；
 * 自定义提供商只要求填了接口地址（Key 可以留空，交给本地网关或代理鉴权）。
 * 条件不满足且属于首次使用时才打开「账号管理」，有供应商时不再打扰用户。
 */
export const ensureApiKey = () => {
  const target = resolveChatTarget()
  if (
    !target.baseUrl ||
    (!target.custom && !target.apiKey) ||
    (target.custom && protocolNeedsKey(target.protocol) && !target.apiKey)
  ) {
    if (needsAccountSetup()) {
      openSettings('account')
    }
    return false
  }
  return true
}

/** 首屏引导：仅在完全没有凭据与供应商时弹出账号管理 */
export const promptAccountSetupOnStartup = () => {
  if (needsAccountSetup()) {
    openSettings('account')
  }
}

/** 没填官方 Key 但已有供应商时，自动切到第一个配置了模型的启用供应商 */
export const ensureUsableProvider = () => {
  if (hasOfficialApiKey()) {
    return
  }
  const { providerId } = useSettings.getState()
  if (providerId !== BUILTIN_PROVIDER_ID) {
    return
  }
  const candidate = useProviders
    .getState()
    .providers.find((provider) => provider.enabled && provider.models.some((model) => model.id.trim()))
  const firstModel = candidate?.models.find((model) => model.id.trim())
  if (candidate && firstModel) {
    setProvider(candidate.id, firstModel.id)
  }
}

/** 附件上传：官方 Key 可用，或者当前供应商显式声明兼容 Files API */
export const canUploadFiles = () => hasOfficialApiKey() || resolveChatTarget().filesApi

/** 官方接口功能（语音输入、朗读、智能搜索）要求配置了官方 API Key */
export const hasOfficialFeatures = () => hasOfficialApiKey()

/** 当前提供商是否支持上传附件（只有内置 DeepSeek 的 Files API） */
export const providerSupportsFiles = () => resolveChatTarget().filesApi
