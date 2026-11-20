import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { setProvider, setThinkingEffort, useSettings, type ThinkingEffort } from '../../services/settings.js'
import { enabledProviders, useProviders, type CustomProvider } from '../../services/providers.js'
import {
  findCatalogModel,
  loadModelsDev,
  matchCatalogProvider,
  useModelsDev,
  type ModelsDevProvider,
} from '../../services/modelsDev.js'
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

/** 内置 DeepSeek 提供商的模型（请求走官方 Anthropic 兼容接口） */
const BUILTIN_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek Flash', vendor: 'deepseek' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vendor: 'deepseek' },
]

const EFFORTS: ThinkingEffort[] = ['standard', 'deep', 'max']

export const BUILTIN_PROVIDER_ID = 'deepseek'

/**
 * 搜索归一化：空格、连字符、下划线、斜杠、反斜杠一律忽略，
 * 于是「DeepSeek V4」「DeepSeek-V4」「DeepSeek/V4」都能互相命中。
 */
export const normalizeModelQuery = (value: string) => value.toLowerCase().replace(/[\s\-_/\\]+/g, '')

export const matchesModelQuery = (model: { id: string; name: string }, query: string) => {
  const keyword = normalizeModelQuery(query)
  return keyword === '' || normalizeModelQuery(`${model.name} ${model.id}`).includes(keyword)
}

type Pane = 'root' | 'model' | 'effort'

export type ModelEntry = {
  providerId: string
  providerName: string
  id: string
  name: string
  /** 该模型属于哪家厂商（models.dev 的 logo id），用于显示原厂 logo */
  vendor: string | null
  /** 该模型是否支持推理等级（自定义提供商在设置里逐模型声明） */
  reasoning: boolean
}

/** 按厂商在目录里找模型：先认提供商（按 baseUrl），再在它名下按 id 找 */
const resolveCustomVendor = (
  provider: CustomProvider,
  modelId: string,
  catalog: Record<string, ModelsDevProvider>
): string | null => {
  const matched = matchCatalogProvider(
    { id: provider.id, name: provider.name, baseUrl: provider.baseUrl },
    catalog
  )
  const found = findCatalogModel(matched, modelId, catalog)
  return found?.provider.id ?? matched?.id ?? null
}

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
    }
  })
  for (const provider of enabledProviders(providers)) {
    for (const model of provider.models) {
      if (!model.id.trim()) {
        continue
      }
      const id = model.id
      const found = findCatalogModel(matchCatalogProvider(
        { id: provider.id, name: provider.name, baseUrl: provider.baseUrl },
        catalog
      ), id, catalog)
      entries.push({
        providerId: provider.id,
        providerName: provider.name || provider.id,
        id,
        name: model.name ?? found?.model.name ?? id,
        vendor: resolveCustomVendor(provider, id, catalog),
        reasoning: model.reasoning ?? found?.model.reasoning ?? false,
      })
    }
  }
  return entries
}

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

  // 进页面就拉目录：按钮上的模型名要立刻是 models.dev 里的真名，而不是等点了才变
  useEffect(() => {
    void loadModelsDev()
  }, [])

  const entries = useMemo(() => buildEntries(providers, catalog), [providers, catalog])

  const current = entries.find((entry) => entry.providerId === providerId && entry.id === model) ?? entries[0]
  const filtered = entries.filter((entry) => matchesModelQuery(entry, query))
  // 推理等级是逐模型能力：模型不支持时，深度思考开关与强制等级都不展示。
  const showEffort = thinking && current?.reasoning === true

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

  // 当前模型不支持推理时，推理等级不参与请求，回到默认档位
  useEffect(() => {
    if (!showEffort && effort !== 'standard') {
      setThinkingEffort('standard')
    }
  }, [showEffort, effort])

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
              {EFFORTS.map((level) => (
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
