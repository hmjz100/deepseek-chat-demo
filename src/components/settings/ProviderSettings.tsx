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
import { loadModelsDev, useModelsDev } from '../../services/modelsDev.js'
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

/** 圆形模型图标选择器：默认自动按模型匹配，也可以手动指定厂商图标。 */
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
      Object.values(catalog).sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      ),
    [catalog]
  )
  const keyword = query.trim().toLowerCase()
  const filtered = options.filter(
    (vendor) => !keyword || `${vendor.name} ${vendor.id}`.toLowerCase().includes(keyword)
  )

  const choose = (icon: string | undefined) => {
    updateProviderModel(provider.id, index, { icon })
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
          {model.icon ? (
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
                  model.icon === vendor.id && styles.providerIconSelected
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
      </div>
    </div>
  )
}

/** 单张提供商卡片 */
const ProviderCard = ({ id }: { id: string }) => {
  const t = useTranslate()
  const provider = useProviders((state) => state.providers.find((item) => item.id === id))
  const [fetching, setFetching] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [candidates, setCandidates] = useState<ProviderModel[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  if (!provider) {
    return null
  }

  const baseUrl = normalizeBaseUrl(provider.baseUrl)
  const baseUrlInvalid = provider.baseUrl.trim() !== '' && !isHttpUrl(baseUrl)

  const fetchModels = async () => {
    if (!baseUrl || baseUrlInvalid) {
      setResult({ ok: false, text: t(baseUrlInvalid ? 'providerBaseUrlInvalid' : 'providerTestNeedsBaseUrl') })
      return
    }
    setFetching(true)
    setResult(null)
    try {
      const models = await discoverProviderModels({
        protocol: provider.protocol,
        baseUrl,
        apiKey: provider.apiKey,
        headers: provider.headers,
      })
      if (models.length === 0) {
        setResult({ ok: false, text: t('providerFetchEmpty') })
        return
      }
      setCandidates(models)
      setPicked(new Set(provider.models.map((model) => model.id)))
    } catch (error) {
      setResult({ ok: false, text: t('providerFetchFailed', { message: describeError(error) }) })
    } finally {
      setFetching(false)
    }
  }

  const testConnection = async () => {
    if (!baseUrl || baseUrlInvalid) {
      setResult({ ok: false, text: t(baseUrlInvalid ? 'providerBaseUrlInvalid' : 'providerTestNeedsBaseUrl') })
      return
    }
    setTesting(true)
    setResult(null)
    try {
      await verifyProviderDraft({
        protocol: provider.protocol,
        baseUrl,
        apiKey: provider.apiKey,
        headers: provider.headers,
      })
      setResult({ ok: true, text: t('providerTestOk') })
    } catch (error) {
      setResult({ ok: false, text: t('providerTestFailed', { message: describeError(error) }) })
    } finally {
      setTesting(false)
    }
  }

  const adoptPicked = () => {
    if (!candidates) {
      return
    }
    // 已配置的模型保留原能力设置；新选中的沿用端点返回的元数据。
    const existing = new Map(provider.models.map((model) => [model.id, model]))
    const merged = candidates
      .filter((model) => picked.has(model.id))
      .map((model) => existing.get(model.id) ?? model)
    // 端点没列出的手填模型继续保留，不会被一次“获取”清空。
    for (const model of provider.models) {
      if (!candidates.some((candidate) => candidate.id === model.id) && model.id.trim()) {
        merged.push(model)
      }
    }
    setProviderModels(id, merged)
    setCandidates(null)
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
        <span className={styles.providerFieldLabel}>{t('providerModelsTitle')}</span>
        <div className={styles.providerModelActions}>
          <button
            type="button"
            className={styles.providerLinkButton}
            disabled={fetching}
            onClick={() => void fetchModels()}
          >
            {fetching ? t('providerFetching') : t('providerFetchModels')}
          </button>
          <button
            type="button"
            className={styles.providerLinkButton}
            disabled={testing}
            onClick={() => void testConnection()}
          >
            {testing ? t('providerTesting') : t('providerTest')}
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
        onClick={() => addProviderModel(id)}
      >
        + {t('providerAddModel')}
      </button>

      {result ? (
        <div
          className={clsx(styles.providerResult, result.ok ? styles.providerResultOk : styles.providerError)}
          role="status"
        >
          {result.text}
        </div>
      ) : null}

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
