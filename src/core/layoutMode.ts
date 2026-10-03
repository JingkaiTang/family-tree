export type LayoutMode = 'family-grid' | 'focus-flow'
export type LayoutModePreference = 'auto' | LayoutMode

export function resolveLayoutMode(
  preference: LayoutModePreference,
  defaultMode: LayoutMode,
): LayoutMode {
  return preference === 'auto' ? defaultMode : preference
}

/** 只在 UI store 创建时检测一次，后续横竖屏或窗口缩放不会自动切换布局。 */
export function detectDefaultLayoutMode(): LayoutMode {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'family-grid'
  }
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches === true
  const compactViewport = window.matchMedia?.('(max-width: 1023px)').matches === true
  return mobileUserAgent || (coarsePointer && compactViewport)
    ? 'focus-flow'
    : 'family-grid'
}
