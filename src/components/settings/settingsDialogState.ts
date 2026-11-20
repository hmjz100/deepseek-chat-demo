import { create } from 'zustand'
import { resolveChatTarget } from '../../services/providerRuntime.js'

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

/**
 * 当前选中的提供商是否可以发请求：内置 DeepSeek 需要全局 API Key；
 * 自定义提供商只要求填了接口地址（Key 可以留空，交给本地网关或代理鉴权）。
 * 条件不满足时打开「账号管理」，返回是否已就绪。
 */
export const ensureApiKey = () => {
  const target = resolveChatTarget()
  if (!target.baseUrl || (!target.custom && !target.apiKey)) {
    openSettings('account')
    return false
  }
  return true
}

/** 当前提供商是否支持上传附件（只有内置 DeepSeek 的 Files API） */
export const providerSupportsFiles = () => resolveChatTarget().filesApi
