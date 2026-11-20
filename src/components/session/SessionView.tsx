import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { isEmptySession, renameSession } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { ContentCaveat } from '../base/ContentCaveat.js'
import { ConversationInfo } from './ConversationInfo.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  // 官网 89052 _V：点击标题进入重命名（Enter/blur 提交，maxLength 1024），空会话不可编辑
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const canRename = !isEmptySession(session.id)
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])
  const startEditing = () => {
    if (canRename) {
      setEditing(true)
    }
  }
  const commit = () => {
    const value = inputRef.current?.value.trim() ?? ''
    setEditing(false)
    if (value && value !== title) {
      renameSession(session.id, value)
    }
  }
  // 官网 _F 读 session.modelType；模型名标签已按需求移除
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.titleWrap, siderCollapsed && styles.withCollapsedSider)}>
            {editing ? (
              <input
                ref={inputRef}
                className={clsx(styles.renameInput)}
                maxLength={1024}
                defaultValue={title}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    commit()
                  }
                }}
              />
            ) : (
              <div
                role="button"
                tabIndex={canRename ? 0 : undefined}
                className={clsx(styles.title, canRename && styles.titleClickable)}
                style={{ outline: 'none' }}
                onClick={startEditing}
                onFocus={startEditing}
              >
                {title}
              </div>
            )}
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <ConversationInfo session={session} />
            <ContentCaveat className={styles.caveat} />
          </div>
        }
      />
    </div>
  )
}
