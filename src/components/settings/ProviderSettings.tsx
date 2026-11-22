import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addProvider,
  addProviderModel,
  removeProvider,
  removeProviderModel,
  setProviderModels,
  updateProvider,
  updateProviderModel,
  useProviders,
  type CustomProvider,
  type ProviderModel,
  type ProviderProtocol,
} from '../../services/providers.js'
import {
  discoverProviderModels,
  normalizeBaseUrl,
  PROTOCOL_OPTIONS,
  providerBaseUrlPlaceholderKey,
  verifyProviderDraft,
} from '../../services/providerRuntime.js'
import { canonicalLogoVendor, hasModelLogo, loadModelsDev, useModelsDev } from '../../services/modelsDev.js'
import { ApiError } from '../../services/api/client.js'
import { translate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Checkbox } from '../base/Checkbox.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { Popover, type PopoverHandle } from '../base/Popover.js'
import { Select } from '../base/Select.js'
import { VendorLogo } from '../base/VendorLogo.js'
import { IconModelOutline14, IconTrashOutline16 } from '../base/icons.js'
import styles from './Settings.module.css'

const isHttpUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const describeError = (error: unknown): string => {
  if (error instanceof ApiError && error.localMessage) {
    return translate(error.localMessage.key, error.localMessage.params)
  }
  return error instanceof Error ? error.message : String(error)
}

/** 圆形模型图标选择器：只列 models.dev 里真正有专属 logo 的厂商 */
const ModelIconPicker = ({
  provider,
  model,
  index,
}: {
  provider: CustomProvider
  model: ProviderModel
  index: number
}) => {
  const t = useTranslate()
  const catalog = useModelsDev((state) => state.providers)
  const [query, setQuery] = useState('')
  const popover = useRef<PopoverHandle>(null)

  useEffect(() => {
    void loadModelsDev()
  }, [])

  const options = useMemo(
    () =>
      Object.values(catalog)
        .filter((vendor) => hasModelLogo(vendor.id) && canonicalLogoVendor(vendor.id) === vendor.id)
        .sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        ),
    [catalog]
  )
  const keyword = query.trim().toLowerCase()
  const filtered = options.filter(
    (vendor) => !keyword || `${vendor.name} ${vendor.id}`.toLowerCase().includes(keyword)
  )

  const choose = (icon: string | undefined) => {
    // 复用同一 logo 的区域版/套餐版统一存代表 id，避免面板里出现重复图标
    updateProviderModel(provider.id, index, { icon: icon ? canonicalLogoVendor(icon) ?? undefined : undefined })
    popover.current?.setIsOpen(false)
  }

  return (
    <Popover
      componentRef={popover}
      trigger="click"
      placement="bottom-start"
      zIndex={1200}
      offsetOptions={{ mainAxis: 6, crossAxis: 0 }}
      renderTrigger={({ domRef, domProps }) => (
        <button
          ref={domRef as React.RefObject<HTMLButtonElement>}
          type="button"
          className={styles.providerModelIconButton}
          aria-label={t('providerModelIcon')}
          title={t('providerModelIcon')}
          {...domProps}
        >
          <IconModelOutline14 />
          {model.icon && hasModelLogo(model.icon) ? (
            <VendorLogo vendor={model.icon} size={18} className={styles.providerModelIconLogo} />
          ) : null}
        </button>
      )}
      renderFloating={({ nodeRef, onMouseDown }) => (
        <div
          ref={nodeRef as React.RefObject<HTMLDivElement>}
          className={styles.providerIconPanel}
          role="dialog"
          aria-label={t('providerModelIcon')}
          onMouseDown={onMouseDown}
        >
          <input
            className={styles.providerInput}
            value={query}
            placeholder={t('providerIconSearch')}
            aria-label={t('providerIconSearch')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className={clsx(styles.providerIconOption, !model.icon && styles.providerIconSelected)}
            onClick={() => choose(undefined)}
          >
            <span className={styles.providerIconAuto}>
              <IconModelOutline14 />
            </span>
            {t('providerIconAuto')}
          </button>
          <div className={styles.providerIconList}>
            {filtered.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                className={clsx(
                  styles.providerIconOption,
                  model.icon && canonicalLogoVendor(model.icon) === vendor.id && styles.providerIconSelected
                )}
                onClick={() => choose(vendor.id)}
              >
                <span className={styles.providerIconAuto}>
                  <VendorLogo vendor={vendor.id} size={18} />
                </span>
                <span className={styles.providerIconName}>{vendor.name}</span>
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className={styles.providerIconEmpty}>{t('providerIconEmpty')}</div>
            ) : null}
          </div>
        </div>
      )}
    />
  )
}

/** 一行的模型编辑器：ID、展示名、上下文窗口与能力开关 */
const ModelRow = ({
  provider,
  model,
  index,
}: {
  provider: CustomProvider
  model: ProviderModel
  index: number
}) => {
  const t = useTranslate()
  return (
    <div className={styles.providerModelRow}>
      <div className={styles.providerModelMain}>
        <ModelIconPicker provider={provider} model={model} index={index} />
        <input
          className={clsx(styles.providerInput, styles.providerModelId)}
          value={model.id}
          placeholder={t('providerModelIdPlaceholder')}
          aria-label={t('providerModelIdPlaceholder')}
          onChange={(event) => updateProviderModel(provider.id, index, { id: event.target.value })}
        />
        <input
          className={clsx(styles.providerInput, styles.providerModelName)}
          value={model.name ?? ''}
          placeholder={t('providerModelNamePlaceholder')}
          aria-label={t('providerModelNamePlaceholder')}
          onChange={(event) =>
            updateProviderModel(provider.id, index, { name: event.target.value || undefined })
          }
        />
        <input
          className={clsx(styles.providerInput, styles.providerModelNumber)}
          type="number"
          min={1}
          value={model.contextWindow ?? ''}
          placeholder={t('providerModelContextWindow')}
          aria-label={t('providerModelContextWindow')}
          onChange={(event) => {
            const value = event.target.value === '' ? undefined : Number(event.target.value)
            updateProviderModel(provider.id, index, {
              contextWindow: value && Number.isFinite(value) ? value : undefined,
            })
          }}
        />
        <IconButton
          className={styles.providerModelRemove}
          icon={<IconTrashOutline16 />}
          tooltip={t('providerRemoveModel')}
          onClick={() => removeProviderModel(provider.id, index)}
        />
      </div>
      <div className={styles.providerModelCapabilities}>
        <label className={styles.providerCapability}>
          <Checkbox
            checked={model.reasoning === true}
            ariaLabel={t('providerModelReasoning')}
            onChange={(reasoning) => updateProviderModel(provider.id, index, { reasoning })}
          />
          <span>{t('providerModelReasoning')}</span>
        </label>
        <label className={styles.providerCapability}>
          <Checkbox
            checked={model.supportsImages === true}
            ariaLabel={t('providerModelImages')}
            onChange={(supportsImages) => updateProviderModel(provider.id, index, { supportsImages })}
          />
          <span>{t('providerModelImages')}</span>
        </label>
        <label className={styles.providerCapability}>
          <Checkbox
            checked={model.supportsTools === true}
            ariaLabel={t('providerModelTools')}
            onChange={(supportsTools) => updateProviderModel(provider.id, index, { supportsTools })}
          />
          <span>{t('providerModelTools')}</span>
        </label>
      </div>
    </div>
  )
}

/** 从端点拉取模型列表并勾选，结果在独立弹窗里展示 */
const ModelCandidates = ({
  provider,
  onClose,
}: {
  provider: CustomProvider
  onClose: () => void
}) => {
  const t = useTranslate()
  const providerRef = useRef(provider)
  providerRef.current = provider
  const [fetching, setFetching] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<ProviderModel[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const fetchModels = async () => {
    const current = providerRef.current
    const baseUrl = normalizeBaseUrl(current.baseUrl)
    if (!baseUrl) {
      setResult(t('providerTestNeedsBaseUrl'))
      return
    }
    if (!isHttpUrl(baseUrl)) {
      setResult(t('providerBaseUrlInvalid'))
      return
    }
    setFetching(true)
    setResult(null)
    try {
      const models = await discoverProviderModels({
        protocol: current.protocol,
        baseUrl,
        apiKey: current.apiKey,
        headers: current.headers,
      })
      if (models.length === 0) {
        setResult(t('providerFetchEmpty'))
        return
      }
      setCandidates(models)
      setPicked(new Set(current.models.map((model) => model.id)))
    } catch (error) {
      setResult(t('providerFetchFailed', { message: describeError(error) }))
    } finally {
      setFetching(false)
    }
  }

  const adoptPicked = () => {
    if (!candidates) {
      return
    }
    const current = providerRef.current
    // 已配置的模型保留原能力设置；新选中的沿用端点返回的元数据。
    const existing = new Map(current.models.map((model) => [model.id, model]))
    const merged = candidates
      .filter((model) => picked.has(model.id))
      .map((model) => existing.get(model.id) ?? model)
    // 端点没列出的手填模型继续保留，不会被一次“获取”清空。
    for (const model of current.models) {
      if (!candidates.some((candidate) => candidate.id === model.id) && model.id.trim()) {
        merged.push(model)
      }
    }
    setProviderModels(current.id, merged)
    setCandidates(null)
  }

  return (
    <>
      <Modal
        title={t('providerModelsTitle')}
        closable
        width={560}
        onClose={onClose}
        footer={
          <Button size="s" onClick={onClose}>
            {t('providerManageDone')}
          </Button>
        }
      >
        <div className={styles.providerModelHead}>
          <span className={styles.providerFieldLabel}>
            {t('providerModelCount', { count: provider.models.length })}
          </span>
          <div className={styles.providerModelActions}>
            <button
              type="button"
              className={styles.providerLinkButton}
              disabled={fetching}
              onClick={() => void fetchModels()}
            >
              {fetching ? t('providerFetching') : t('providerFetchModels')}
            </button>
          </div>
        </div>
        {provider.models.length === 0 ? (
          <div className={styles.providerModelsEmpty}>{t('providerModelsEmpty')}</div>
        ) : (
          <div className={styles.providerModels}>
            {provider.models.map((model, index) => (
              <ModelRow key={index} provider={provider} model={model} index={index} />
            ))}
          </div>
        )}
        <button
          type="button"
          className={styles.providerAddModel}
          onClick={() => addProviderModel(provider.id)}
        >
          + {t('providerAddModel')}
        </button>
        {result ? <div className={styles.providerError}>{result}</div> : null}
      </Modal>
      {candidates ? (
        <Modal
          title={t('providerFetchTitle')}
          closable
          width={420}
          onClose={() => setCandidates(null)}
          footer={
            <>
              <Button size="s" variant="outlined" onClick={() => setCandidates(null)}>
                {t('providerFetchCancel')}
              </Button>
              <Button size="s" disabled={picked.size === 0} onClick={adoptPicked}>
                {t('providerFetchConfirm')}
              </Button>
            </>
          }
        >
          <div className={styles.providerCandidates}>
            <label className={styles.providerCandidateAll}>
              <Checkbox
                checked={candidates.length > 0 && candidates.every((model) => picked.has(model.id))}
                ariaLabel={t('providerFetchSelectAll')}
                onChange={(checked) =>
                  setPicked(checked ? new Set(candidates.map((model) => model.id)) : new Set())
                }
              />
              <span>{t('providerFetchSelectAll')}</span>
              <span className={styles.providerCandidateCount}>
                {t('providerFetchSelected', { count: picked.size, total: candidates.length })}
              </span>
            </label>
            {candidates.map((model) => (
              <label key={model.id} className={styles.providerCandidate}>
                <Checkbox
                  checked={picked.has(model.id)}
                  ariaLabel={model.id}
                  onChange={(checked) =>
                    setPicked((current) => {
                      const next = new Set(current)
                      if (checked) {
                        next.add(model.id)
                      } else {
                        next.delete(model.id)
                      }
                      return next
                    })
                  }
                />
                <span className={styles.providerCandidateId}>{model.id}</span>
                {model.name && model.name !== model.id ? (
                  <span className={styles.providerCandidateName}>{model.name}</span>
                ) : null}
              </label>
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  )
}

/** 测试连接的按钮：点击后按钮本身显示结果，1 秒后恢复 */
const TestConnectionButton = ({ provider }: { provider: CustomProvider }) => {
  const t = useTranslate()
  const providerRef = useRef(provider)
  providerRef.current = provider
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [text, setText] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    []
  )

  const showResult = (ok: boolean, message: string) => {
    setState(ok ? 'ok' : 'fail')
    setText(message)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1000)
  }

  const test = async () => {
    const current = providerRef.current
    const baseUrl = normalizeBaseUrl(current.baseUrl)
    if (!baseUrl) {
      showResult(false, t('providerTestNeedsBaseUrl'))
      return
    }
    if (!isHttpUrl(baseUrl)) {
      showResult(false, t('providerBaseUrlInvalid'))
      return
    }
    setState('testing')
    try {
      await verifyProviderDraft({
        protocol: current.protocol,
        baseUrl,
        apiKey: current.apiKey,
        headers: current.headers,
      })
      showResult(true, t('providerTestOk'))
    } catch (error) {
      showResult(false, t('providerTestFailed', { message: describeError(error) }))
    }
  }

  return (
    <button
      type="button"
      className={clsx(
        styles.providerLinkButton,
        state === 'ok' && styles.providerTestOkText,
        state === 'fail' && styles.providerError
      )}
      disabled={state === 'testing'}
      onClick={() => void test()}
    >
      {state === 'idle'
        ? t('providerTest')
        : state === 'testing'
          ? t('providerTesting')
          : text}
    </button>
  )
}

/** 单张提供商卡片 */
const ProviderCard = ({ id }: { id: string }) => {
  const t = useTranslate()
  const provider = useProviders((state) => state.providers.find((item) => item.id === id))
  const [managing, setManaging] = useState(false)
  const baseUrl = normalizeBaseUrl(provider?.baseUrl ?? '')
  const baseUrlInvalid = !!provider?.baseUrl.trim() && !isHttpUrl(baseUrl)
  if (!provider) {
    return null
  }

  return (
    <div className={styles.providerCard}>
      <div className={styles.providerHead}>
        <input
          className={clsx(styles.providerInput, styles.providerName)}
          value={provider.name}
          placeholder={t('providerNamePlaceholder')}
          aria-label={t('providerNamePlaceholder')}
          onChange={(event) => updateProvider(id, { name: event.target.value })}
        />
        <Checkbox
          checked={provider.enabled}
          ariaLabel={t('providerEnabled')}
          onChange={(enabled) => updateProvider(id, { enabled })}
        />
        <IconButton
          icon={<IconTrashOutline16 />}
          tooltip={t('providerRemove')}
          onClick={() => removeProvider(id)}
        />
      </div>

      <div className={styles.providerFieldRow}>
        <span className={styles.providerFieldLabel}>{t('providerProtocol')}</span>
        <Select<ProviderProtocol>
          value={provider.protocol}
          options={PROTOCOL_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          ariaLabel={t('providerProtocol')}
          onChange={(protocol) => updateProvider(id, { protocol })}
        />
      </div>

      <input
        className={styles.providerInput}
        value={provider.baseUrl}
        placeholder={t(providerBaseUrlPlaceholderKey(provider.protocol))}
        aria-label={t(providerBaseUrlPlaceholderKey(provider.protocol))}
        aria-invalid={baseUrlInvalid}
        onChange={(event) => updateProvider(id, { baseUrl: event.target.value })}
      />
      {baseUrlInvalid ? <div className={styles.providerError}>{t('providerBaseUrlInvalid')}</div> : null}

      <input
        className={styles.providerInput}
        type="password"
        value={provider.apiKey}
        placeholder={t('providerApiKeyPlaceholder')}
        aria-label={t('providerApiKeyPlaceholder')}
        autoComplete="off"
        onChange={(event) => updateProvider(id, { apiKey: event.target.value })}
      />

      <div className={styles.providerModelHead}>
        <span className={styles.providerFieldLabel}>
          {t('providerModelCount', { count: provider.models.length })}
        </span>
        <div className={styles.providerModelActions}>
          <button type="button" className={styles.providerLinkButton} onClick={() => setManaging(true)}>
            {t('providerManageModels')}
          </button>
          <TestConnectionButton provider={provider} />
        </div>
      </div>

      {provider.protocol === 'anthropic-messages' ? (
        <label className={styles.providerCapability}>
          <Checkbox
            checked={provider.filesApi}
            ariaLabel={t('providerFilesApi')}
            onChange={(filesApi) => updateProvider(id, { filesApi })}
          />
          <span>{t('providerFilesApi')}</span>
        </label>
      ) : null}

      {managing ? <ModelCandidates provider={provider} onClose={() => setManaging(false)} /> : null}
    </div>
  )
}

/** 账号管理页里的「模型提供商」区块 */
export const ProviderSettings = () => {
  const t = useTranslate()
  const providers = useProviders((state) => state.providers)
  const [adding, setAdding] = useState(false)
  return (
    <div className={styles.providerList}>
      {providers.map((provider) => (
        <ProviderCard key={provider.id} id={provider.id} />
      ))}
      <div className={styles.providerAddRow}>
        <button type="button" className={styles.providerAdd} onClick={() => setAdding(true)}>
          {t('providerAdd')}
        </button>
      </div>
      {adding ? (
        <Modal title={t('providerAddTitle')} closable width={400} onClose={() => setAdding(false)}>
          <p className={styles.providerAddHint}>{t('providerAddHint')}</p>
          <div className={styles.providerProtocols}>
            {PROTOCOL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.providerProtocolOption}
                onClick={() => {
                  addProvider(option.value)
                  setAdding(false)
                }}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
