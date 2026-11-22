import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconPaperclipOutline16,
  IconSendOutline16,
  IconStopFill16,
} from '../base/icons.js'
import { GlobeToggleIcon, ThinkToggleIcon } from './ToggleIcons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey, providerSupportsFiles, hasOfficialFeatures, canUploadFiles } from '../settings/settingsDialogState.js'
import { useProviders } from '../../services/providers.js'
import { useCurrentModelEntry } from '../../services/modelCatalog.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { ModelPicker } from './ModelPicker.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, MAX_COUNT, MAX_SIZE_MB, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/**
 * 输入字符上限：官网 client-settings `model_configs[*].input_character_limit`
 * 的下发值（2,621,440），见 .temp/_reference/client-settings.json。
 */
const INPUT_CHARACTER_LIMIT = 2_621_440

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  // 订阅凭据与供应商变化，保证隐藏/恢复的入口能即时刷新
  useSettings((state) => state.apiKey)
  useSettings((state) => state.providerId)
  useProviders((state) => state.providers)
  const currentModel = useCurrentModelEntry()
  const showOfficialFeatures = hasOfficialFeatures()
  const showUpload = canUploadFiles()
  // 深度思考是模型能力：非思考模型不展示开关
  const showThinking = currentModel?.reasoning === true
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !showUpload) {
      return
    }
    // 自定义提供商没有 Files API，附件无法发送；先提示，避免白上传。
    if (!providerSupportsFiles()) {
      showToast({ key: 'providerFilesUnsupported' })
      return
    }
    if (!ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 官网 yG hook（bundle @656043，模块 64603 消费者）：超长百分比、提交拦截、粘贴超长提示。
  // 徽标只在首次「提交/粘贴超长」触发 toast 后出现（官网 state n）。
  const [overLimitShown, setOverLimitShown] = useState(false)
  const overLimit = text.length > INPUT_CHARACTER_LIMIT
  const overLimitPct = overLimit
    ? `${Math.round(((text.length - INPUT_CHARACTER_LIMIT) / text.length) * 100)}%`
    : null
  const notifyOverLimit = (pct: string) => {
    showToast({ key: 'inputLengthTooMuchToast', params: { count: pct }, type: 'error' })
    setOverLimitShown(true)
  }
  // 官网 interceptSubmit：超长时 toast 并阻止发送
  const interceptSubmit = () => {
    if (overLimit && overLimitPct !== null) {
      notifyOverLimit(overLimitPct)
      return true
    }
    return false
  }

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (interceptSubmit()) {
      return
    }
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  return (
    <div
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
          placeholder={t('chatInputPlaceholderChat')}
          rows={2}
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={importingHistory}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onMouseDown={(event) => {
            // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
              return
            }
            // 官网 notifyPasteOverLimit：粘贴超长文本不阻止粘贴，仅 toast 提示
            const pastedText = event.clipboardData.getData('text/plain')
            if (pastedText.length > INPUT_CHARACTER_LIMIT) {
              notifyOverLimit(
                `${Math.round(((pastedText.length - INPUT_CHARACTER_LIMIT) / pastedText.length) * 100)}%`
              )
            }
          }}
        />
        {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      <div className={styles.functionRow}>
        {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方；图标为 Lottie 动画，切换时形变 */}
        <div ref={togglesRef} className={styles.toggles}>
          {showThinking ? (
            <Tooltip content={t('deactivatedThinkTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, thinking && styles.selected)}
                aria-label={t('thinkingSwitch')}
                aria-pressed={thinking}
                onClick={() => setThinking(!thinking)}
              >
                <span className={styles.toggleIcon}>
                  <ThinkToggleIcon enabled={thinking} />
                </span>
                <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
              </button>
            </Tooltip>
          ) : null}
          {showOfficialFeatures ? (
            <Tooltip content={t('deactivatedSearchTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, search && styles.selected)}
                aria-label={t('search')}
                aria-pressed={search}
                onClick={() => setSearch(!search)}
              >
                <span className={styles.toggleIcon}>
                  <GlobeToggleIcon enabled={search} />
                </span>
                <span className={styles.toggleLabel}>{t('search')}</span>
              </button>
            </Tooltip>
          ) : null}
        </div>
        {/* 官网超长百分比徽标（yW.X）：首次提交/粘贴超长触发 toast 后出现 */}
        {overLimitShown && overLimitPct !== null ? (
          <span className={styles.overLimitBadge}>
            {t('inputOverLimitPercentage', { count: overLimitPct })}
          </span>
        ) : null}
        <div className={styles.right}>
          {/* 语音输入依赖官方转写接口；没有官方 Key 时隐藏 */}
          {showOfficialFeatures ? (
            <VoiceButton
              status={voice.status}
              disabled={!voice.available}
              seconds={voice.seconds}
              onClick={() => {
                if (
                  voice.status !== 'idle' ||
                  (!useChatStore.getState().importingHistory && ensureApiKey())
                ) {
                  void voice.toggle()
                }
              }}
            />
          ) : null}
          {/* 官网 27872：上传按钮 tooltip 显示模型上传限制（最多 N 个，每个 M MB） */}
          {showUpload ? (
            <Tooltip
              content={t('uploadFileButtonTooltipDesc', {
                count: MAX_COUNT,
                size: MAX_SIZE_MB,
              })}
            >
              <IconButton
                size="m"
                tone="primary"
                icon={<IconPaperclipOutline16 />}
                disabled={importingHistory}
                onClick={() => {
                  if (!providerSupportsFiles()) {
                    showToast({ key: 'providerFilesUnsupported' })
                    return
                  }
                  if (ensureApiKey()) {
                    fileInputRef.current?.click()
                  }
                }}
              />
            </Tooltip>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {/* 模型与思考强度：桌面端位于发送键左侧；移动端移到顶栏右侧 */}
          {!isMobile ? <ModelPicker /> : null}
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : canSend ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('send')}
              onClick={send}
            >
              <IconSendOutline16 />
            </button>
          ) : (
            /* 官网：输入为空时发送键禁用，悬停提示「请输入你的问题」；有内容时不显示提示 */
            <Tooltip content={t('chatInputEmptyPromptButtonTooltip')} placement="top">
              <button
                type="button"
                className={clsx(styles.sendButton, styles.disabled)}
                aria-label={t('chatInputEmptyPromptButtonTooltip')}
                aria-disabled
                onClick={send}
              >
                <IconSendOutline16 />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      {dragging ? <DragMask /> : null}
    </div>
  )
}
