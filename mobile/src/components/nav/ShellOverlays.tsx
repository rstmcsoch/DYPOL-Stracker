import { GlobalSearch } from './GlobalSearch'
import { MoreSheet } from './MoreSheet'
import { QuickTaskDialog } from './QuickTaskDialog'

/** App-wide overlays that every app page can open. */
export function ShellOverlays() {
  return (
    <>
      <MoreSheet />
      <GlobalSearch />
      <QuickTaskDialog />
    </>
  )
}
