import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo } from 'react'
import { IconWarningOutline16 } from '../base/icons.js'
import {
  IconRegenerateOutline16,
} from '../base/iconsFeedback.js'

import { describeReply } from '../../services/chat/describe.js'
import { canContinueReply } from '../../services/chat/reply.js'
import { continueReply, regenerateReply } from '../../services/chat/store.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import type { AssistantMessage as AssistantMessageType } from '../../services/chat/types.js'
import { openSettings, hasOfficialFeatures } from '../settings/settingsDialogState.js'
import { useSettings } from '../../services/settings.js'
import { IconButton } from '../base/IconButton.js'
import { Tooltip } from '../base/Tooltip.js'
import { Button } from '../base/Button.js'
import { Markdown } from '../markdown/Markdown.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { ReadAloudButton } from './ReadAloudButton.js'
import { CopyButton } from './CopyButton.js'
import { ReplyArea } from './ReplyArea.js'
import { useReplyView } from './useReplyView.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import styles from './AssistantMessage.module.css'

const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

export const AssistantMessage = memo(function AssistantMessage({
  sessionId,
  message,
  isLast,
  streaming,
  busy,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: AssistantMessageType
  isLast: boolean
  streaming: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  const view = useReplyView(message, streaming)
  // 朗读走官方语音接口，没有官方 Key 时不展示
  useSettings((state) => state.apiKey)
  const showReadAloud = hasOfficialFeatures()
  const panelEntry = useSearchPanel((state) => state.entry)
  const notice = streaming ? null : describeReply(message)  // 安全拒绝：保留已下发的思考与正文，另外加一条拒答提示（含服务端给的原因）
  const refused = message.stopReason === 'refusal'
  const refusalReason = message.stopDetails?.explanation ?? null
  const answer = view.answer
  const responseText = [answer?.text, notice?.presentation === 'response' ? notice.text : null]
    .filter(Boolean)
    .join('\n\n')
  const copyText = responseText || notice?.text
  const waiting = streaming && view.steps.length === 0 && !view.answer && !message.thinking
  const summaryEntry = `${message.id}-summary`
  return (
    <div className={styles.message}>
      {refused && !streaming ? (
        <div className={clsx(styles.notice, styles.refusalNotice)}>
          <IconWarningOutline16 />
          <span>
            {t('replyRefused')}
            {refusalReason ? ` ${t('refusalReason', { reason: refusalReason })}` : null}
          </span>
        </div>
      ) : null}
      <ReplyArea
        message={message}
        view={view}
        streaming={streaming}
        hasResponse={!!responseText}
      />
      {answer ? (
        <Markdown
          className="ds-assistant-message-main-content"
          content={answer.markdown}
          loading={streaming}
          cacheKey={message.id}
          disableLink={false}
          sources={view.sources}
        />
      ) : null}
      {waiting ? (
        <div className={styles.waiting}>
          {[0, 1, 2].map((index) => (
            <span key={index} className={styles.waitingDot} />
          ))}
        </div>
      ) : null}
      {notice?.presentation === 'response' ? (
        <Markdown
          className="ds-assistant-message-main-content"
          content={notice.text}
          loading={false}
          cacheKey={`${message.id}-template`}
          disableLink={false}
        />
      ) : notice ? (
        <div className={styles.notice}>
          <IconWarningOutline16 />
          <span>
            {notice.text}
            {notice.action === 'apiKey' ? (
              <>
                {' '}
                <button
                  type="button"
                  className={styles.noticeAction}
                  onClick={() => openSettings('account')}
                >
                  {t('changeApiKey')}
                </button>
              </>
            ) : null}
            {notice.action === 'topUp' ? (
              <>
                {' '}
                <a
                  className={styles.noticeAction}
                  href={TOP_UP_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('topUp')}
                </a>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      {!streaming && !refused && view.searchResults.length > 0 ? (
        <Tooltip content={t('composeResultTooltip')}>
          <div
            className={clsx(styles.summary, panelEntry === summaryEntry && styles.summaryActive)}
            onClick={() => toggleSearchPanel(summaryEntry, view.searchResults)}
          >
            <SiteThumbnails sources={view.searchResults} />
            <span>
              {t(
                view.searchResults.length === 1 ? 'messageSearchSummary' : 'messageSearchSummaries',
                { count: view.searchResults.length }
              )}
            </span>
          </div>
        </Tooltip>
      ) : null}
      {streaming ? null : (
        <div className={styles.bottom}>
          <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
          <div className={clsx(styles.actions, isLast && styles.alwaysShow)}>
            {/* 官方顺序：复制 → 重新生成 →（点赞/点踩已按用户要求移除）→ 朗读 →（分享，需要服务端生成链接，未实现） */}
            {copyText ? <CopyButton text={copyText} /> : null}
            <IconButton
              icon={<IconRegenerateOutline16 />}
              tooltip={t('regenerate')}
              tooltipPlacement="bottom"
              disabled={busy}
              onClick={() => {
                stopReadAloud()
                regenerateReply(sessionId, message.id)
              }}
            />
            {responseText && !refused && showReadAloud ? (
              <ReadAloudButton messageId={message.id} text={responseText} />
            ) : null}
          </div>
          {isLast && canContinueReply(message) ? (
            <Button
              variant="outlined"
              size="s"
              className={styles.continueButton}
              disabled={busy}
              onClick={() => {
                stopReadAloud()
                continueReply(sessionId, message.id)
              }}
            >
              {t('continueGenerating')}
            </Button>
          ) : null}
          {/* 官网 20528：末条回复出错时的恢复行；官网走 resumeCompletion API，我们等价重新生成 */}
          {isLast && message.status === 'error' ? (
            <div className={styles.resumeRow}>
              <Button
                variant="outlined"
                size="s"
                className={styles.resumeRetry}
                disabled={busy}
                onClick={() => {
                  stopReadAloud()
                  regenerateReply(sessionId, message.id)
                }}
              >
                {t('resumeFailRetry')}
              </Button>
              <div className={styles.resumeHint}>
                <span className={styles.resumeIcon}>
                  <IconWarningOutline16 />
                </span>
                {t('resumeFail')}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
})
