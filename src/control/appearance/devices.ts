/** Viewports offered by the publishing preview. Sizes are CSS pixels of the rendered page. */
export type PreviewDevice = 'phone' | 'tablet' | 'landscape' | 'desktop'

export const PREVIEW_DEVICES: ReadonlyArray<{ value: PreviewDevice; label: string; width: number; height: number }> = [
  { value: 'phone', label: 'Phone portrait', width: 390, height: 780 },
  { value: 'tablet', label: 'Tablet portrait', width: 768, height: 960 },
  { value: 'landscape', label: 'Tablet landscape', width: 1024, height: 700 },
  { value: 'desktop', label: 'Desktop', width: 1280, height: 800 }
]
