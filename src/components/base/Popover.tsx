import { autoUpdate, computePosition, flip, offset, shift, type Middleware, type Placement } from '@floating-ui/dom'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { FadeInZoomIn } from './Transition.js'

type TriggerEventProps = {
  onClick?: (event: React.MouseEvent) => void
  onMouseEnter?: (event: React.MouseEvent) => void
  onMouseLeave?: (event: React.MouseEvent) => void
  onFocus?: (event: React.FocusEvent) => void
  onBlur?: (event: React.FocusEvent) => void
  onKeyDown?: (event: React.KeyboardEvent) => void
}

export type PopoverHandle = {
  setIsOpen: (open: boolean) => void
  getIsOpen: () => boolean
  referenceDomRef: RefObject<HTMLElement | null>
}

/** 官方 placement → transform-origin（模块 38685 中的 f 映射） */
const TRANSFORM_ORIGIN: Record<string, string> = {
  bottom: 'top',
  'bottom-start': 'top left',
  'bottom-end': 'top right',
  left: 'right',
  'left-start': 'right top',
  'left-end': 'right bottom',
  right: 'left',
  'right-start': 'left top',
  'right-end': 'left bottom',
  top: 'bottom',
  'top-start': 'bottom left',
  'top-end': 'bottom right',
}

export type PopoverProps = {
  trigger?: 'click' | 'hover' | 'none'
  disabled?: boolean
  placement?: Placement
  offsetOptions?: { mainAxis?: number; crossAxis?: number }
  flipOptions?: { fallbackPlacements?: Placement[] }
  /** 官方 positionDomRef：浮层锚定到该元素而非触发器（官网二维码浮层锚定菜单项行时使用） */
  anchorRef?: RefObject<HTMLElement | null>
  /** 是否播放进出场动画（官方 floatingAnimated） */
  floatingAnimated?: boolean
  /** 浮层是否常驻（官方 wrapperDisplayPolicy，默认 keepAfterFirstOpen） */
  wrapperDisplayPolicy?: 'keepAfterFirstOpen' | 'alwaysKeep' | 'keepIfIsOpen'
  onIsOpenChange?: (open: boolean) => void
  onClickoutside?: () => void
  onExit?: () => void
  componentRef?: React.MutableRefObject<PopoverHandle | null>
  renderTrigger: (args: {
    domRef: RefObject<HTMLElement | null>
    domProps: TriggerEventProps
    isOpen: boolean
  }) => ReactNode
  renderFloating: (args: {
    nodeRef: RefObject<HTMLDivElement>
    onMouseDown: (event: React.MouseEvent) => void
    onMouseEnter: (event: React.MouseEvent) => void
    onMouseLeave: (event: React.MouseEvent) => void
  }) => ReactNode
  floatingWrapperClassName?: string
  /** 浮层 z-index；默认 1000，弹窗内的浮层需要更高 */
  zIndex?: number
}

/**
 * 官方 Popover（模块 38685）的移植。
 *
 * - 定位：@floating-ui/dom 的 autoUpdate + computePosition（offset/flip/shift）
 * - 动画：ds-fade-in-zoom-in-*（transform-origin 跟随最终 placement）
 * - 点击外部：document 上挂 clickoutside，关闭浮层
 * - 渲染：portal 到 body，结构为 .ds-floating-container > .ds-floating-position-wrapper
 */
export const Popover = ({
  trigger = 'none',
  disabled = false,
  placement = 'bottom-start',
  offsetOptions,
  flipOptions,
  anchorRef,
  floatingAnimated = true,
  wrapperDisplayPolicy = 'keepAfterFirstOpen',
  onIsOpenChange,
  onClickoutside,
  onExit,
  componentRef,
  renderTrigger,
  renderFloating,
  floatingWrapperClassName,
  zIndex = 1000,
}: PopoverProps) => {
  const [openState, setOpenState] = useState(false)
  const referenceRef = useRef<HTMLElement | null>(null)
  const floatingRef = useRef<HTMLDivElement | null>(null)
  const [everOpened, setEverOpened] = useState(false)

  const setOpen = useCallback((next: boolean) => {
    setOpenState((prev) => (prev === next ? prev : next))
    if (next) {
      setEverOpened(true)
    }
  }, [])

  useEffect(() => {
    onIsOpenChange?.(openState)
  }, [openState, onIsOpenChange])

  const isOpen = disabled ? false : openState

  useImperativeHandle(
    componentRef,
    () => ({
      setIsOpen: setOpen,
      getIsOpen: () => isOpen,
      referenceDomRef: referenceRef,
    }),
    [setOpen, isOpen]
  )

  useEffect(() => {
    if (disabled) {
      setOpen(false)
    }
  }, [disabled, setOpen])

  // 点击浮层与触发器之外时关闭（官方 clickoutside）
  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (referenceRef.current?.contains(target)) {
        return
      }
      if (floatingRef.current?.contains(target)) {
        return
      }
      onClickoutside?.()
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('touchstart', onPointerDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('touchstart', onPointerDown, true)
    }
  }, [isOpen, onClickoutside, setOpen])

  // 定位：与官方一致的 autoUpdate + computePosition；
  // anchorRef 提供时（官方 positionDomRef）锚定到它而非触发器元素
  useLayoutEffect(() => {
    const reference = anchorRef?.current ?? referenceRef.current
    const floating = floatingRef.current
    if (!isOpen || !reference || !floating) {
      return
    }

    const middleware: Middleware[] = [
      offset({
        mainAxis: offsetOptions?.mainAxis ?? 0,
        crossAxis: offsetOptions?.crossAxis ?? 0,
      }),
      // 官网只在横向放不下时避让；crossAxis 默认 true 会因纵向溢出翻转，纵向交 shift 收拢
      flip({
        padding: 8,
        crossAxis: false,
        fallbackPlacements: flipOptions?.fallbackPlacements,
      }),
      shift({ padding: 8 }),
    ]

    const update = () => {
      void computePosition(reference, floating, { placement, middleware }).then((result) => {
        const origin = TRANSFORM_ORIGIN[result.placement] ?? 'center'
        floating.setAttribute('data-transform-origin', origin)
        Object.assign(floating.style, {
          left: `${result.x}px`,
          top: `${result.y}px`,
        })
      })
    }

    update()
    return autoUpdate(reference, floating, update)
  }, [isOpen, placement, anchorRef, offsetOptions?.mainAxis, offsetOptions?.crossAxis, flipOptions?.fallbackPlacements])

  const keepWrapper =
    wrapperDisplayPolicy === 'alwaysKeep' ||
    (wrapperDisplayPolicy === 'keepAfterFirstOpen' && everOpened) ||
    (wrapperDisplayPolicy === 'keepIfIsOpen' && isOpen)

  const domProps: TriggerEventProps = {
    onClick: () => {
      if (disabled) {
        return
      }
      if (trigger === 'click') {
        setOpen(!isOpen)
      }
    },
    onMouseEnter: () => {
      if (disabled || trigger !== 'hover') {
        return
      }
      setOpen(true)
    },
    onMouseLeave: () => {
      if (disabled || trigger !== 'hover') {
        return
      }
      setOpen(false)
    },
    onFocus: () => {
      if (disabled || trigger !== 'hover') {
        return
      }
      setOpen(true)
    },
    onBlur: () => {
      if (disabled || trigger !== 'hover') {
        return
      }
      setOpen(false)
    },
  }

  return (
    <>
      {renderTrigger({ domRef: referenceRef, domProps, isOpen })}
      {keepWrapper
        ? createPortal(
            <div className="ds-floating-container" style={{ zIndex }}>
              <div
                ref={floatingRef}
                className={['ds-floating-position-wrapper', 'ds-theme', floatingWrapperClassName]
                  .filter(Boolean)
                  .join(' ')}
                style={{ zIndex }}
              >
                <FadeInZoomIn
                  in={isOpen}
                  appear
                  animated={floatingAnimated}
                  onExited={() => {
                    onExit?.()
                  }}
                >
                  {(nodeRef) =>
                    renderFloating({
                      nodeRef,
                      onMouseDown: (event) => event.preventDefault(),
                      onMouseEnter: () => {
                        if (trigger === 'hover') {
                          setOpen(true)
                        }
                      },
                      onMouseLeave: () => {
                        if (trigger === 'hover') {
                          setOpen(false)
                        }
                      },
                    })
                  }
                </FadeInZoomIn>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
