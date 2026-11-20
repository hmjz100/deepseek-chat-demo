import { useMemo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { useProviders } from '../../services/providers.js'
import {
  findCatalogModel,
  matchCatalogProvider,
  useModelsDev,
} from '../../services/modelsDev.js'
import type { AssistantMessage, Session } from '../../services/chat/types.js'
import { Popover } from '../base/Popover.js'
import styles from './ConversationInfo.module.css'

/** 圆环几何：14px 视窗，2px 描边 */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
/** 内置 DeepSeek 没有目录数据时的上下文兜底（V4 Flash 为 1M） */
const BUILTIN_CONTEXT_WINDOW = 1_048_576

const formatTokens = (value: number): string => {
  const scaled = (candidate: number) =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) {
    return String(value)
  }
  if (value < 1_000_000) {
    return `${scaled(value / 1_000)}K`
  }
  return `${scaled(value / 1_000_000)}M`
}

/**
 * 对话框底部的上下文用量：圆环 + 百分比，点击展开「已用 / 上限」。
 * 数据来自最近一条助手消息的 usage；没有 usage 或不知道上下文窗口时不渲染。
 */
export const ConversationInfo = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const settingsModel = useSettings((state) => state.model)
  const providerId = useSettings((state) => state.providerId)
  const providers = useProviders((state) => state.providers)
  const catalog = useModelsDev((state) => state.providers)

  const usage = useMemo(() => {
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      const message = session.messages[index]
      if (message.role === 'assistant' && message.usage) {
        return message.usage
      }
    }
    return null
  }, [session.messages])

  if (!usage) {
    return null
  }
  const usedTokens =
    usage.input_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens +
    usage.output_tokens

  const model = [...session.messages]
    .reverse()
    .find((message): message is AssistantMessage => message.role === 'assistant' && Boolean(message.model))
    ?.model ?? settingsModel
  // 记录在消息上的模型可能来自另一个提供商：先按模型归属找，再回落到当前选择。
  const customProvider =
    providers.find((provider) => provider.models.some((item) => item.id === model)) ??
    (providerId === 'deepseek'
      ? undefined
      : providers.find((provider) => provider.id === providerId))
  const customModel = customProvider?.models.find((item) => item.id === model)
  const catalogMatch = findCatalogModel(
    matchCatalogProvider(
      customProvider
        ? {
            id: customProvider.id,
            name: customProvider.name,
            baseUrl: customProvider.baseUrl,
          }
        : { id: 'deepseek', name: 'DeepSeek' },
      catalog
    ),
    model ?? '',
    catalog
  )
  const contextWindow =
    customModel?.contextWindow ??
    catalogMatch?.model.contextWindow ??
    (customProvider ? undefined : BUILTIN_CONTEXT_WINDOW)
  if (!contextWindow) {
    return null
  }

  const percent = Math.min(100, Math.round((usedTokens / contextWindow) * 100))
  const reading = `${percent}%`
  const aria = t('contextUsageAria', { percent: reading })

  return (
    <div className={styles.row}>
      <Popover
        trigger="click"
        placement="top-start"
        offsetOptions={{ mainAxis: 8, crossAxis: 0 }}
        renderTrigger={({ domRef, domProps }) => (
          <button
            ref={domRef as React.RefObject<HTMLButtonElement>}
            type="button"
            className={styles.trigger}
            aria-label={aria}
            aria-haspopup="dialog"
            {...domProps}
          >
            <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
              <circle className={styles.track} cx="7" cy="7" r={RADIUS} />
              <circle
                className={styles.fill}
                cx="7"
                cy="7"
                r={RADIUS}
                strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`}
                transform="rotate(-90 7 7)"
              />
            </svg>
            <span>{reading}</span>
          </button>
        )}
        renderFloating={({ nodeRef, onMouseDown }) => (
          <div
            ref={nodeRef as React.RefObject<HTMLDivElement>}
            className={styles.panel}
            role="dialog"
            aria-label={t('contextUsage')}
            onMouseDown={onMouseDown}
          >
            <div className={styles.header}>
              <span className={styles.headline}>{t('contextUsage')}</span>
              <span className={styles.percent}>{reading}</span>
              <span className={styles.figures}>
                {`~${formatTokens(usedTokens)} / ${formatTokens(contextWindow)}`}
              </span>
            </div>
            <div className={styles.bar}>
              <div className={styles.segment} style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      />
    </div>
  )
}
