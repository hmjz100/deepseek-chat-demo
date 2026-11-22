import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { setProvider, setThinkingEffort, useSettings, type ThinkingEffort } from '../../services/settings.js'
import { useProviders } from '../../services/providers.js'
import { loadModelsDev, useModelsDev } from '../../services/modelsDev.js'
import {
  buildEntries,
  EFFORTS,
  matchesModelQuery,
  useLoadModelCatalog,
  type ModelEntry,
} from '../../services/modelCatalog.js'
import { Popover } from '../base/Popover.js'
import { VendorLogo } from '../base/VendorLogo.js'
import { IconCheckOutline16 } from '../base/icons.js'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCloseFill14,
  IconSearchOutline16,
} from '../base/icons.js'
import styles from './ModelPicker.module.css'

type Pane = 'root' | 'model' | 'effort'

/**
 * 输入框右侧（发送键左侧）的模型与推理等级选择。
 * 结构参照 DSH 的 ModelSelect：根菜单是「模型 / 推理等级」两行，分别钻取；
 * 没有推理等级可选时（关闭深度思考）直接进入模型列表。
 * 移动端收缩成一个不带名称的小按钮，避免挤占输入区。
 */
export const ModelPicker = () => {
  const t = useTranslate()
  // 移动端在顶栏使用图标 + 名称；桌面端在输入框内只显示名称
  const isMobile = useIsMobile()
  const providerId = useSettings((state) => state.providerId)
  const model = useSettings((state) => state.model)
  const thinking = useSettings((state) => state.thinking)
  const effort = useSettings((state) => state.thinkingEffort)
  const providers = useProviders((state) => state.providers)
  const catalog = useModelsDev((state) => state.providers)
  const [pane, setPane] = useState<Pane>('root')
  const [query, setQuery] = useState('')
  // Popover 每次渲染都会回调 onIsOpenChange，必须只在实际打开的那一次重置面板
  const wasOpenRef = useRef(false)

  // 进页面就拉目录：按钮上的模型名与能力信息要立刻来自 models.dev
  useLoadModelCatalog()

  const entries = useMemo(() => buildEntries(providers, catalog), [providers, catalog])

  const current = entries.find((entry) => entry.providerId === providerId && entry.id === model) ?? entries[0]
  const filtered = entries.filter((entry) => matchesModelQuery(entry, query))
  // 推理等级是逐模型能力：模型不支持（或只有一个档位）时，深度思考菜单不展示。
  const availableEfforts = current?.efforts?.length ? current.efforts : EFFORTS
  const showEffort = thinking && current?.reasoning === true && availableEfforts.length > 1

  // 选中的供应商/模型被删除、禁用，或切换到不支持当前模型时，回落到当前可用条目。
  useEffect(() => {
    if (current && (current.providerId !== providerId || current.id !== model)) {
      setProvider(current.providerId, current.id)
    }
  }, [current, providerId, model])

  /** 按提供商分组 */
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; models: ModelEntry[] }>()
    for (const entry of filtered) {
      const bucket = map.get(entry.providerId) ?? { name: entry.providerName, models: [] }
      bucket.models.push(entry)
      map.set(entry.providerId, bucket)
    }
    return [...map.entries()].map(([id, value]) => ({ id, name: value.name, models: value.models }))
  }, [filtered])

  const effortLabel: Record<ThinkingEffort, string> = {
    standard: t('thinkingEffortStandard'),
    deep: t('thinkingEffortDeep'),
    max: t('thinkingEffortMax'),
  }

  // 当前模型不支持推理（或档位变化时），把强度收敛到可用档位
  useEffect(() => {
    if (!showEffort && effort !== 'standard') {
      setThinkingEffort('standard')
    } else if (showEffort && !availableEfforts.includes(effort)) {
      setThinkingEffort(availableEfforts[0])
    }
  }, [showEffort, effort, availableEfforts])

  const currentLabel = current?.name ?? model

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && !wasOpenRef.current) {
        setPane(showEffort ? 'root' : 'model')
        setQuery('')
        void loadModelsDev()
      }
      wasOpenRef.current = open
    },
    [showEffort]
  )

  return (
    <Popover
      trigger="click"
      placement="top-end"
      offsetOptions={{ mainAxis: 6, crossAxis: 0 }}
      onIsOpenChange={handleOpenChange}
      renderTrigger={({ domRef, domProps, isOpen }) => (
        <button
          ref={domRef as React.RefObject<HTMLButtonElement>}
          type="button"
          className={styles.button}
          aria-label={t('modelSelectorLabel')}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          title={showEffort ? `${currentLabel} · ${effortLabel[effort]}` : currentLabel}
          {...domProps}
        >
          {isMobile && current?.vendor ? (
            // 顶栏：有厂商图标时显示图标；没有图标时只显示模型名称
            <VendorLogo className={styles.logo} vendor={current.vendor} size={16} />
          ) : null}
          <span className={styles.buttonText}>{currentLabel}</span>
          {!isMobile && showEffort ? <span className={styles.effort}>{effortLabel[effort]}</span> : null}
          <IconChevronDownOutline14 />
        </button>
      )}
      renderFloating={({ nodeRef, onMouseDown }) => (
        <div
          ref={nodeRef as React.RefObject<HTMLDivElement>}
          role="menu"
          className={clsx('ds-dropdown-menu', 'ds-elevated', styles.panel)}
          onMouseDown={onMouseDown}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && showEffort && pane !== 'root') {
              event.stopPropagation()
              setPane('root')
            }
          }}
        >
          {pane === 'root' ? (
            <>
              <div
                role="menuitem"
                className={clsx('ds-dropdown-menu-option', styles.cell)}
                onClick={() => setPane('model')}
              >
                <span className={styles.cellLabel}>{t('modelSelectorModel')}</span>
                <span className={styles.cellValue}>{currentLabel}</span>
                <IconChevronRightOutline14 />
              </div>
              {showEffort ? (
                <div
                  role="menuitem"
                  className={clsx('ds-dropdown-menu-option', styles.cell)}
                  onClick={() => setPane('effort')}
                >
                  <span className={styles.cellLabel}>{t('reasoningLevel')}</span>
                  <span className={styles.cellValue}>{effortLabel[effort]}</span>
                  <IconChevronRightOutline14 />
                </div>
              ) : null}
            </>
          ) : null}

          {pane === 'model' ? (
            <>
              <div className={styles.search}>
                <IconSearchOutline16 />
                <input
                  className={styles.searchInput}
                  value={query}
                  placeholder={t('modelSearchPlaceholder')}
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query !== '' ? (
                  <button
                    type="button"
                    className={styles.searchClear}
                    aria-label={t('modelSearchClear')}
                    onClick={() => setQuery('')}
                  >
                    <IconCloseFill14 />
                  </button>
                ) : null}
              </div>
              <div className={styles.list}>
                {grouped.length === 0 ? (
                  <div className={styles.empty}>{t('modelSearchEmpty')}</div>
                ) : (
                  grouped.map((group) => (
                    <div key={group.id}>
                      <div className={styles.groupTitle}>{group.name}</div>
                      {group.models.map((entry) => {
                        const selected = entry.providerId === providerId && entry.id === model
                        return (
                          <div
                            key={`${entry.providerId}:${entry.id}`}
                            role="menuitemradio"
                            aria-checked={selected}
                            className={clsx('ds-dropdown-menu-option', styles.option)}
                            onClick={() => setProvider(entry.providerId, entry.id)}
                          >
                            {/* 厂商 logo：内联 SVG，currentColor 随主题，深色模式自动适配 */}
                            {entry.vendor ? (
                              <VendorLogo className={styles.logo} vendor={entry.vendor} size={16} />
                            ) : null}
                            <span className={styles.optionLabel}>{entry.name}</span>
                            {/* 用户定制：已选模型用右侧小钩标记，不做高亮 */}
                            {selected ? (
                              <span className={styles.optionCheck}>
                                <IconCheckOutline16 />
                              </span>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>
            </>
          ) : null}

          {pane === 'effort' ? (
            <div className={styles.list}>
              {availableEfforts.map((level) => (
                <div
                  key={level}
                  role="menuitemradio"
                  aria-checked={level === effort}
                  className={clsx('ds-dropdown-menu-option', styles.option)}
                  onClick={() => setThinkingEffort(level)}
                >
                  <span className={styles.optionLabel}>{effortLabel[level]}</span>
                  {level === effort ? (
                    <span className={styles.optionCheck}>
                      <IconCheckOutline16 />
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    />
  )
}
