import type { ViewStyle } from 'react-native'

/**
 * The website's signature notebook corners. Each card and button has a slightly different radius per
 * corner (for example `15px 17px 14px 16px`), which gives the hand-drawn feel. Values are in dp.
 */
export function notebookCorners(topLeft: number, topRight: number, bottomRight: number, bottomLeft: number): ViewStyle {
  return {
    borderTopLeftRadius: topLeft,
    borderTopRightRadius: topRight,
    borderBottomRightRadius: bottomRight,
    borderBottomLeftRadius: bottomLeft
  }
}

export const CARD_CORNERS = notebookCorners(15, 17, 14, 16)
export const BUTTON_CORNERS = notebookCorners(9, 11, 10, 8)
export const DIALOG_CORNERS = notebookCorners(16, 19, 16, 18)
export const FAB_CORNERS = notebookCorners(19, 17, 20, 16)
export const PILL_CORNERS = notebookCorners(999, 999, 999, 999)
