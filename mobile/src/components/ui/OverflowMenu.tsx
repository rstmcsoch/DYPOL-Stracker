import { useState } from 'react'
import { MoreHorizontal } from '../icons'
import { useTheme } from '../../contexts/AppearanceContext'
import { IconButton } from './Button'
import { ActionMenu, type MenuItem } from './Overlays'

/** A "more actions" button that opens an action sheet. It is the mobile form of the website's row menus. */
export function OverflowMenu({ label, title, items }: { label: string; title: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const theme = useTheme()
  return (
    <>
      <IconButton label={label} onPress={() => setOpen(true)}>
        <MoreHorizontal size={19} color={theme.colors.inkSoft} />
      </IconButton>
      <ActionMenu visible={open} onClose={() => setOpen(false)} title={title} items={items} />
    </>
  )
}
