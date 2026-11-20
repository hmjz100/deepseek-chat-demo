import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { ModelPicker } from '../chatInput/ModelPicker.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/**
 * 移动端顶栏：左侧菜单打开侧边栏，右侧模型选择器与开启新对话；
 * 会话页中间再显示会话标题。
 */
export const MobileHeader = ({ title }: { title?: string }) => {
  const t = useTranslate()
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? null : <div className={styles.title}>{title}</div>}
      <div className={styles.actions}>
        <div className={styles.modelSlot}>
          <ModelPicker />
        </div>
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconNewChatOutline20 />}
          aria-label={t('newChat')}
          onClick={newChat}
        />
      </div>
    </div>
  )
}
