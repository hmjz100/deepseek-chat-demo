import { useMemo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { useProviders } from '../../services/providers.js'
import { findCatalogModel, matchCatalogProvider, useModelsDev } from '../../services/modelsDev.js'
import { getSessionStats } from '../../services/chat/sessionStats.js'
import type { AssistantMessage, Session } from '../../services/chat/types.js'
import { IconDatabaseOutline14, IconGaugeOutline14 } from '../base/icons.js'
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

const formatExactTokens = (value: number): string => value.toLocaleString()

const formatTps = (value: number): string => {
  const clamped = Math.max(0, value)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

const formatPercent = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)

/** 两段读数之间的小圆点分隔 */
const Reading = ({ first, second }: { first: string; second: string | null }) => (
  <>
    {first}
    {second === null ? null : (
      <>
        <span className={styles.sep} aria-hidden>
          ·
        </span>
        {second}
      </>
    )}
  </>
)

/**
 * 对话框底部的会话统计、Token 用量与上下文用量。
 * 旧会话缺少 usage 时按内容估算，保证历史记录也有 token 数据。
 */
export const ConversationInfo = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const settingsModel = useSettings((state) => state.model)
  const providerId = useSettings((state) => state.providerId)
  const providers = useProviders((state) => state.providers)
  const catalog = useModelsDev((state) => state.providers)
  const stats = useMemo(() => getSessionStats(session), [session])

  const model =
    [...session.messages]
      .reverse()
      .find(
        (message): message is AssistantMessage =>
          message.role === 'assistant' && Boolean(message.model)
      )
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

  const counts = t('statsCounts', { turns: stats.turns, steps: stats.steps })
  const speed =
    stats.decodeMs > 0 && stats.decodeTokens > 0
      ? t('tokensPerSecond', {
          tps: formatTps(stats.decodeTokens / (stats.decodeMs / 1_000)),
        })
      : null
  const cacheHit =
    stats.cacheHitPercent === null
      ? null
      : t('statsCacheHit', { percent: formatPercent(stats.cacheHitPercent) })
  const cacheHitValue =
    stats.cacheHitPercent === null ? '' : `${formatPercent(stats.cacheHitPercent)}%`
  const totalText = t('turnUsageCount', { count: formatTokens(stats.totalTokens) })
  const exactTotal = t('turnUsageCount', { count: formatExactTokens(stats.totalTokens) })
  const duration = (ms: number) => {
    const seconds = ms / 1_000
    if (seconds < 60) {
      return t('statsDurationSeconds', { seconds: Math.round(seconds * 10) / 10 })
    }
    const whole = Math.round(seconds)
    return t('statsDurationMinutes', {
      minutes: Math.floor(whole / 60),
      seconds: whole % 60,
    })
  }
  const contextUsed = stats.contextTokens
  const contextPercent =
    contextWindow === undefined
      ? null
      : Math.min(100, Math.round((contextUsed / contextWindow) * 100))
  const reading = `${contextPercent ?? 0}%`
  const aria = t('contextUsageAria', { percent: reading })
  const breakdown = stats.breakdown
  const breakdownTotal =
    breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens || 1
  const contextSegments = [
    { key: 'system', width: (contextPercent ?? 0) * (breakdown.systemTokens / breakdownTotal), cls: styles.segmentSystem },
    { key: 'tools', width: (contextPercent ?? 0) * (breakdown.toolsTokens / breakdownTotal), cls: styles.segmentTools },
    { key: 'messages', width: (contextPercent ?? 0) * (breakdown.messageTokens / breakdownTotal), cls: styles.segmentMessages },
  ].filter((segment) => segment.width > 0)

  const estimatedNote = stats.estimated ? (
    <p className={styles.note}>{t('statsDialogEstimated')}</p>
  ) : null

  return (
    <div className={styles.row}>
      {stats.steps > 0 ? (
        <Popover
          trigger="click"
          placement="top-start"
          offsetOptions={{ mainAxis: 8, crossAxis: 0 }}
          renderTrigger={({ domRef, domProps }) => (
            <button
              ref={domRef as React.RefObject<HTMLButtonElement>}
              type="button"
              className={styles.pill}
              aria-haspopup="dialog"
              aria-label={`${counts}${speed === null ? '' : ` · ${speed}`}`}
              title={`${counts}${speed === null ? '' : ` · ${speed}`}`}
              {...domProps}
            >
              <IconGaugeOutline14 />
              <span className={styles.label}>
                <Reading first={counts} second={speed} />
              </span>
            </button>
          )}
          renderFloating={({ nodeRef, onMouseDown }) => (
            <div
              ref={nodeRef as React.RefObject<HTMLDivElement>}
              className={styles.panel}
              role="dialog"
              aria-label={t('statsDialogTitle')}
              onMouseDown={onMouseDown}
            >
              <div className={styles.title}>
                <span className={styles.titleLabel}>
                  <IconGaugeOutline14 />
                  {t('statsDialogTitle')}
                </span>
                <span className={styles.titleValue}>{counts}</span>
              </div>
              <div className={styles.titleRule} aria-hidden />
              <dl className={styles.details}>
                {stats.llmMs > 0 ? (
                  <>
                    <dt>{t('statsDialogLlmTime')}</dt>
                    <dd>{duration(stats.llmMs)}</dd>
                  </>
                ) : null}
                {stats.ttftSteps > 0 ? (
                  <>
                    <dt>{t('statsDialogTtft')}</dt>
                    <dd>{duration(stats.ttftMs / stats.ttftSteps)}</dd>
                  </>
                ) : null}
                {speed === null ? null : (
                  <>
                    <dt>{t('statsDialogSpeed')}</dt>
                    <dd>{speed}</dd>
                  </>
                )}
              </dl>
              {estimatedNote}
            </div>
          )}
        />
      ) : null}

      {stats.totalTokens > 0 ? (
        <Popover
          trigger="click"
          placement="top-start"
          offsetOptions={{ mainAxis: 8, crossAxis: 0 }}
          renderTrigger={({ domRef, domProps }) => (
            <button
              ref={domRef as React.RefObject<HTMLButtonElement>}
              type="button"
              className={styles.pill}
              aria-haspopup="dialog"
              aria-label={`${totalText}${cacheHit === null ? '' : ` · ${cacheHit}`}`}
              title={`${totalText}${cacheHit === null ? '' : ` · ${cacheHit}`}`}
              {...domProps}
            >
              <IconDatabaseOutline14 />
              <span className={styles.label}>
                <Reading first={totalText} second={cacheHit} />
              </span>
            </button>
          )}
          renderFloating={({ nodeRef, onMouseDown }) => (
            <div
              ref={nodeRef as React.RefObject<HTMLDivElement>}
              className={styles.panel}
              role="dialog"
              aria-label={t('statsDialogUsageTitle')}
              onMouseDown={onMouseDown}
            >
              <div className={styles.title}>
                <span className={styles.titleLabel}>
                  <IconDatabaseOutline14 />
                  {t('statsDialogUsageTitle')}
                </span>
                <span className={styles.titleValue}>{exactTotal}</span>
              </div>
              <div className={styles.titleRule} aria-hidden />
              <dl className={styles.details}>
                {cacheHit === null ? null : (
                  <>
                    <dt>{t('turnUsageCacheHit')}</dt>
                    <dd>{cacheHitValue}</dd>
                  </>
                )}
                <dt>{t('turnUsageInput')}</dt>
                <dd>{t('turnUsageCount', { count: formatExactTokens(stats.inputTokens) })}</dd>
                <dt>{t('turnUsageCacheRead')}</dt>
                <dd>{t('turnUsageCount', { count: formatExactTokens(stats.cacheReadTokens) })}</dd>
                {stats.cacheWriteTokens > 0 ? (
                  <>
                    <dt>{t('turnUsageCacheWrite')}</dt>
                    <dd>
                      {t('turnUsageCount', { count: formatExactTokens(stats.cacheWriteTokens) })}
                    </dd>
                  </>
                ) : null}
                <dt>{t('turnUsageOutput')}</dt>
                <dd>{t('turnUsageCount', { count: formatExactTokens(stats.outputTokens) })}</dd>
              </dl>
              {estimatedNote}
            </div>
          )}
        />
      ) : null}

      {contextPercent === null ? null : (
        <Popover
          trigger="click"
          placement="top-start"
          offsetOptions={{ mainAxis: 8, crossAxis: 0 }}
          renderTrigger={({ domRef, domProps }) => (
            <button
              ref={domRef as React.RefObject<HTMLButtonElement>}
              type="button"
              className={styles.pill}
              aria-haspopup="dialog"
              aria-label={aria}
              title={aria}
              {...domProps}
            >
              <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
                <circle className={styles.track} cx="7" cy="7" r={RADIUS} />
                <circle
                  className={styles.fill}
                  cx="7"
                  cy="7"
                  r={RADIUS}
                  strokeDasharray={`${(CIRCUMFERENCE * contextPercent) / 100} ${CIRCUMFERENCE}`}
                  transform="rotate(-90 7 7)"
                />
              </svg>
              <span className={styles.label}>{reading}</span>
            </button>
          )}
          renderFloating={({ nodeRef, onMouseDown }) => (
            <div
              ref={nodeRef as React.RefObject<HTMLDivElement>}
              className={styles.contextPanel}
              role="dialog"
              aria-label={t('contextUsage')}
              onMouseDown={onMouseDown}
            >
              <div className={styles.contextHeader}>
                <span className={styles.headline}>{t('contextUsage')}</span>
                <span className={styles.percent}>{reading}</span>
                <span className={styles.figures}>
                  {`~${formatTokens(contextUsed)} / ${formatTokens(contextWindow ?? 0)}`}
                </span>
              </div>
              <div className={styles.bar}>
                {contextSegments.map((segment) => (
                  <div
                    key={segment.key}
                    className={`${styles.segment} ${segment.cls}`}
                    style={{ width: `${segment.width}%` }}
                  />
                ))}
              </div>
              <dl className={styles.rows}>
                <div className={styles.row2}>
                  <dt>
                    <span className={`${styles.swatch} ${styles.segmentSystem}`} aria-hidden />
                    {t('contextSystem')}
                  </dt>
                  <dd>{`~${formatTokens(breakdown.systemTokens)}`}</dd>
                </div>
                <div className={styles.row2}>
                  <dt>
                    <span className={`${styles.swatch} ${styles.segmentTools}`} aria-hidden />
                    {t('contextTools')}
                  </dt>
                  <dd>{`~${formatTokens(breakdown.toolsTokens)}`}</dd>
                </div>
                <div className={styles.row2}>
                  <dt>
                    <span className={`${styles.swatch} ${styles.segmentMessages}`} aria-hidden />
                    {t('contextMessages')}
                  </dt>
                  <dd>{`~${formatTokens(breakdown.messageTokens)}`}</dd>
                </div>
              </dl>
              {estimatedNote}
            </div>
          )}
        />
      )}
    </div>
  )
}
