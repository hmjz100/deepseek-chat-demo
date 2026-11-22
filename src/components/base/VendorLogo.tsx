import { useEffect, useState } from 'react'

/**
 * 厂商 logo 内联渲染组件。
 *
 * models.dev 的 logo 是单色 SVG，但不同厂商的 viewBox 并不统一
 * （有 0 0 40 40，也有 0 0 24 24、0 0 28 32 等）。真正的占位图是那个
 * 三颗星形的通用 SVG，用特征路径判断即可，不能只看 viewBox。
 * 内联后 currentColor 会继承页面主题色，深色模式下也能正常显示。
 */

const CACHE_KEY = 'chat-demo:vendor-logos:v2'
/** 通用占位图的特征路径；命中即认为该厂商没有专属 logo */
const PLACEHOLDER_MARKER = 'M9.8132 15.9038'

type RootAttrs = Partial<Record<'fill' | 'stroke' | 'strokeWidth', string>>
type Logo = { markup: string; viewBox: string; attrs: RootAttrs }

/** 内存中已解析的结果：null 表示该厂商确实没有可用 logo */
const memory = new Map<string, Logo | null>()

type Cache = Record<string, Logo>

const readCache = (): Cache => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Cache
  } catch {
    return {}
  }
}

const writeCache = (cache: Cache) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // 存储不可用只保留内存缓存
  }
}

/** 从完整 SVG 里提取可安全内联的内部标记，拒绝脚本等危险标签 */
const extractLogo = (svg: string): Logo | null => {
  if (svg.includes(PLACEHOLDER_MARKER)) {
    return null
  }
  const match = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/i.exec(svg)
  if (!match) {
    return null
  }
  const viewBox = /viewBox\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1] ?? '0 0 24 24'
  // 有些 logo 把 fill/stroke 写在 <svg> 根节点上；内联时要一起带过去
  const attrs: RootAttrs = {}
  const safe = /^[#\w\s.,%()-]+$/
  const copy = (name: keyof RootAttrs, attr: string) => {
    const value = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i').exec(match[1])?.[1]
    if (value && safe.test(value)) {
      attrs[name] = value
    }
  }
  copy('fill', 'fill')
  copy('stroke', 'stroke')
  copy('strokeWidth', 'stroke-width')
  const inner = match[2].trim()
  // 只保留绘图类标签，杜绝 script / foreignObject / 事件属性
  if (/<\s*\/?\s*(script|foreignObject|iframe|object|embed)\b/i.test(inner) || /\bon\w+\s*=/i.test(inner)) {
    return null
  }
  return { markup: inner, viewBox, attrs }
}

/** 拉取并缓存某厂商的 logo 内部结构；结果只来自 models.dev 静态资源 */
export const loadVendorLogo = async (vendor: string): Promise<Logo | null> => {
  if (memory.has(vendor)) {
    return memory.get(vendor) ?? null
  }
  const cached = readCache()[vendor]
  if (cached?.markup) {
    memory.set(vendor, cached)
    return cached
  }
  try {
    const response = await fetch(`https://models.dev/logos/${encodeURIComponent(vendor)}.svg`)
    const logo = response.ok ? extractLogo(await response.text()) : null
    memory.set(vendor, logo)
    if (logo) {
      writeCache({ ...readCache(), [vendor]: logo })
    }
    return logo
  } catch {
    memory.set(vendor, null)
    return null
  }
}

export const VendorLogo = ({
  vendor,
  size = 16,
  className,
}: {
  vendor: string
  size?: number
  className?: string
}) => {
  const [logo, setLogo] = useState<Logo | null>(() => memory.get(vendor) ?? readCache()[vendor] ?? null)

  useEffect(() => {
    if (logo !== null || memory.has(vendor)) {
      return
    }
    let alive = true
    void loadVendorLogo(vendor).then((value) => {
      if (alive) {
        setLogo(value)
      }
    })
    return () => {
      alive = false
    }
  }, [vendor, logo])

  if (!logo) {
    return null
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={logo.viewBox}
      aria-hidden="true"
      {...logo.attrs}
      dangerouslySetInnerHTML={{ __html: logo.markup }}
    />
  )
}
