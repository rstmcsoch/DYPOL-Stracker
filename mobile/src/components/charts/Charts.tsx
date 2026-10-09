import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg'
import { format, parseISO } from 'date-fns'
import { useTheme } from '../../contexts/AppearanceContext'
import { fmtDuration } from '../../shared/lib/format'
import { prettyDate } from '../../shared/lib/date'
import type { HeatmapCell } from '../../shared/lib/study-aggregation'
import { withAlpha } from './color'

const DAY_MS = 86_400_000

/**
 * Renders children once the parent has a measured width, so SVG charts resize on rotation and on
 * every layout change. Nothing is drawn before the first measurement, which avoids a flash of zero size.
 */
export function MeasuredBox({ height, children }: { height?: number; children: (width: number) => ReactNode }) {
  const [width, setWidth] = useState(0)
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.floor(event.nativeEvent.layout.width)
    if (next !== width) setWidth(next)
  }
  return (
    <View onLayout={onLayout} style={[styles.measured, height !== undefined ? { height } : null]}>
      {width > 0 ? children(width) : null}
    </View>
  )
}

export interface ChartLegendItem { label: string; color: string; dashed?: boolean; value?: string }

/** Legend row. Each series appears with its swatch, and an optional latest value. */
export function ChartLegend({ items }: { items: ChartLegendItem[] }) {
  const theme = useTheme()
  return (
    <View accessibilityRole="list" accessibilityLabel="Chart series" style={styles.legend}>
      {items.map(item => (
        <View key={item.label} accessibilityRole="text" style={styles.legendItem}>
          {item.dashed ? (
            <View style={[styles.dashed, { borderColor: item.color }]} />
          ) : (
            <View style={[styles.swatch, { backgroundColor: item.color }]} />
          )}
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft, fontSize: 13 }]}>
            {item.label}
            {item.value ? <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{` ${item.value}`}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  )
}

export interface TrendPoint { date: string; values: Record<string, number | null> }
export interface TrendSeries { key: string; color: string; dashed?: boolean; strokeWidth?: number }

/**
 * Percentage trend on a true time axis, so a 13-day gap takes 13 days of width. Missing values break
 * the line instead of being drawn as zero.
 */
export function TrendChart({ points, series, height = 280 }: { points: TrendPoint[]; series: TrendSeries[]; height?: number }) {
  const theme = useTheme()
  const ordered = useMemo(
    () => points.map(point => ({ time: parseISO(`${point.date}T12:00:00`).getTime(), values: point.values })).sort((a, b) => a.time - b.time),
    [points]
  )
  if (ordered.length === 0) return null

  return (
    <MeasuredBox height={height}>
      {width => {
        const padLeft = 38
        const padRight = 14
        const padTop = 12
        const padBottom = 26
        const plotWidth = Math.max(1, width - padLeft - padRight)
        const plotHeight = Math.max(1, height - padTop - padBottom)
        const firstTime = ordered[0]?.time ?? 0
        const lastTime = ordered[ordered.length - 1]?.time ?? firstTime
        const tMin = lastTime - firstTime < DAY_MS ? firstTime - DAY_MS / 2 : firstTime
        const tMax = lastTime - firstTime < DAY_MS ? lastTime + DAY_MS / 2 : lastTime
        const x = (time: number) => padLeft + ((time - tMin) / (tMax - tMin)) * plotWidth
        const y = (value: number) => padTop + (1 - Math.max(0, Math.min(100, value)) / 100) * plotHeight
        const tickCount = width < 300 ? 2 : 4
        const xTicks = Array.from({ length: tickCount }, (_, index) => tMin + ((tMax - tMin) * index) / (tickCount - 1))
        const tickStyle = { fill: theme.colors.muted, fontSize: 11, fontFamily: theme.fonts.body }

        return (
          <Svg width={width} height={height} accessible={false}>
            {[0, 25, 50, 75, 100].map(level => (
              <Line key={`grid-${level}`} x1={padLeft} x2={width - padRight} y1={y(level)} y2={y(level)} stroke={theme.colors.chartGrid} strokeWidth={1} strokeDasharray="3 5" />
            ))}
            {[0, 25, 50, 75, 100].map(level => (
              <SvgText key={`label-${level}`} x={padLeft - 8} y={y(level) + 4} textAnchor="end" {...tickStyle}>{`${level}%`}</SvgText>
            ))}
            {xTicks.map((time, index) => (
              <SvgText
                key={`tick-${index}`}
                x={x(time)}
                y={height - 7}
                textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
                {...tickStyle}
              >
                {prettyDate(format(new Date(time), 'yyyy-MM-dd'), { day: 'numeric', month: 'short' })}
              </SvgText>
            ))}
            {series.map(line => {
              let path = ''
              let pendingMove = true
              const dots: ReactNode[] = []
              for (const point of ordered) {
                const value = point.values[line.key]
                if (value === null || value === undefined || !Number.isFinite(value)) {
                  pendingMove = true
                  continue
                }
                path += `${pendingMove ? 'M' : 'L'}${x(point.time).toFixed(1)} ${y(value).toFixed(1)} `
                pendingMove = false
                dots.push(<Circle key={`${line.key}-${point.time}`} cx={x(point.time)} cy={y(value)} r={line.dashed ? 3.5 : 3} fill={line.color} />)
              }
              return (
                <G key={line.key}>
                  {path ? <Path d={path.trim()} fill="none" stroke={line.color} strokeWidth={line.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={line.dashed ? '7 5' : undefined} /> : null}
                  {dots}
                </G>
              )
            })}
          </Svg>
        )
      }}
    </MeasuredBox>
  )
}

export interface ColumnItem { key: string; label: string; value: number; color?: string; valueText?: string }

/** Vertical bars with a shared baseline. Value labels show when there are few enough bars to read them. */
export function ColumnChart({ items, height = 230, emptyNote }: { items: ColumnItem[]; height?: number; emptyNote?: string }) {
  const theme = useTheme()
  if (items.length === 0) return emptyNote ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{emptyNote}</Text> : null
  return (
    <MeasuredBox height={height}>
      {width => {
        const padTop = 24
        const padBottom = 30
        const padX = 6
        const plotHeight = Math.max(1, height - padTop - padBottom)
        const max = Math.max(1, ...items.map(item => item.value))
        const slot = (width - padX * 2) / items.length
        const barWidth = Math.min(slot * 0.62, 34)
        const longest = Math.max(...items.map(item => item.label.length))
        const labelEvery = Math.max(1, Math.ceil((longest * 6.4 + 8) / slot))
        const showValues = items.length <= 10
        const baseline = padTop + plotHeight

        return (
          <Svg width={width} height={height} accessible={false}>
            <Line x1={padX} x2={width - padX} y1={baseline} y2={baseline} stroke={theme.colors.line} strokeWidth={1} />
            {items.map((item, index) => {
              const centre = padX + slot * index + slot / 2
              const barHeight = (Math.max(0, item.value) / max) * plotHeight
              const top = baseline - barHeight
              return (
                <G key={item.key}>
                  <Rect x={centre - barWidth / 2} y={top} width={barWidth} height={barHeight} rx={Math.min(6, barWidth / 2, barHeight / 2)} fill={item.color ?? theme.colors.accent} />
                  {showValues ? (
                    <SvgText x={centre} y={top - 6} textAnchor="middle" fill={theme.colors.inkSoft} fontSize={11} fontFamily={theme.fonts.bodyBold}>
                      {item.valueText ?? String(Math.round(item.value * 10) / 10)}
                    </SvgText>
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <SvgText x={centre} y={height - 8} textAnchor="middle" fill={theme.colors.muted} fontSize={11} fontFamily={theme.fonts.body}>
                      {item.label}
                    </SvgText>
                  ) : null}
                </G>
              )
            })}
          </Svg>
        )
      }}
    </MeasuredBox>
  )
}

export interface BarItem { key: string; label: string; value: number; color?: string; valueText?: string }

/** Horizontal bars, used where category names are long. Each row is a labelled meter with its count. */
export function HorizontalBars({ items, emptyNote }: { items: BarItem[]; emptyNote?: string }) {
  const theme = useTheme()
  const max = Math.max(1, ...items.map(item => item.value))
  if (items.length === 0) return emptyNote ? <Text style={[theme.type.caption, { color: theme.colors.muted }]}>{emptyNote}</Text> : null
  return (
    <View style={styles.bars}>
      {items.map(item => {
        const share = (Math.max(0, item.value) / max) * 100
        return (
          <View key={item.key} style={styles.barRow} accessibilityLabel={`${item.label}: ${item.valueText ?? item.value}`}>
            <View style={styles.barHead}>
              <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>{item.label}</Text>
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>{item.valueText ?? String(item.value)}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: theme.colors.ringTrack }]}>
              <View style={{ width: `${share}%`, height: '100%', borderRadius: 999, backgroundColor: item.color ?? theme.colors.accent }} />
            </View>
          </View>
        )
      })}
    </View>
  )
}

export interface RadarAxis { label: string; value: number | null }

/** Subject balance on a radar. Axes with no data sit at the centre and are labelled "—". */
export function RadarChart({ axes, height = 230, color }: { axes: RadarAxis[]; height?: number; color?: string }) {
  const theme = useTheme()
  const stroke = color ?? theme.colors.accent
  return (
    <MeasuredBox height={height}>
      {width => {
        const centreX = width / 2
        const centreY = height / 2
        const radius = Math.max(40, Math.min(width, height) / 2 - 46)
        const count = Math.max(3, axes.length)
        const angle = (index: number) => -Math.PI / 2 + (index * 2 * Math.PI) / count
        const point = (index: number, distance: number) => ({ x: centreX + distance * Math.cos(angle(index)), y: centreY + distance * Math.sin(angle(index)) })
        const ringPath = (level: number) =>
          `${axes.map((_, index) => {
            const p = point(index, (radius * level) / 100)
            return `${index === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
          }).join(' ')} Z`
        const valuePoints = axes.map((axis, index) => point(index, (radius * Math.max(0, Math.min(100, axis.value ?? 0))) / 100))
        const valuePath = `${valuePoints.map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} Z`

        return (
          <Svg width={width} height={height} accessible={false}>
            {[25, 50, 75, 100].map(level => (
              <Path key={`ring-${level}`} d={ringPath(level)} fill="none" stroke={theme.colors.chartGrid} strokeWidth={1} />
            ))}
            {axes.map((axis, index) => {
              const edge = point(index, radius)
              const label = point(index, radius + 22)
              const cos = Math.cos(angle(index))
              const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle'
              return (
                <G key={axis.label}>
                  <Line x1={centreX} y1={centreY} x2={edge.x} y2={edge.y} stroke={theme.colors.chartGrid} strokeWidth={1} />
                  <SvgText x={label.x} y={label.y} textAnchor={anchor} fill={theme.colors.inkSoft} fontSize={12} fontFamily={theme.fonts.bodySemibold}>
                    {axis.label}
                  </SvgText>
                  <SvgText x={label.x} y={label.y + 14} textAnchor={anchor} fill={theme.colors.muted} fontSize={11} fontFamily={theme.fonts.body}>
                    {axis.value === null ? '—' : `${Math.round(axis.value)}%`}
                  </SvgText>
                </G>
              )
            })}
            <Path d={valuePath} fill={withAlpha(stroke, 0.18)} stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
            {valuePoints.map((p, index) => (axes[index]?.value === null ? null : <Circle key={`dot-${index}`} cx={p.x} cy={p.y} r={3.5} fill={stroke} />))}
          </Svg>
        )
      }}
    </MeasuredBox>
  )
}

export type HeatLevel = HeatmapCell['level']

export function heatColor(theme: ReturnType<typeof useTheme>, level: HeatLevel): string {
  switch (level) {
    case 'none': return withAlpha(theme.colors.line, 0.32)
    case 'low': return withAlpha(theme.colors.accent, 0.26)
    case 'medium': return withAlpha(theme.colors.accent, 0.5)
    case 'high': return withAlpha(theme.colors.accent, 0.75)
    case 'goal': return theme.colors.accent
  }
}

/** Five-step legend shared by the heatmap and its caption. */
export function HeatLegend() {
  const theme = useTheme()
  const levels: HeatLevel[] = ['none', 'low', 'medium', 'high', 'goal']
  return (
    <View style={styles.heatLegend} accessibilityLabel="Legend: none, low, medium, high, goal">
      <Text style={[theme.type.badge, { color: theme.colors.muted }]}>Less</Text>
      {levels.map(level => <View key={level} style={[styles.heatSwatch, { backgroundColor: heatColor(theme, level) }]} />)}
      <Text style={[theme.type.badge, { color: theme.colors.muted }]}>Goal</Text>
    </View>
  )
}

/**
 * A 16-week calendar, one column per week starting Monday. Tapping a day shows its duration, since
 * touch screens have no hover tooltips.
 */
export function HeatGrid({ cells, months, columns = 16 }: { cells: HeatmapCell[]; months: { key: string; label: string; column: number }[]; columns?: number }) {
  const theme = useTheme()
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const selected = cells.find(cell => cell.date === selectedDate) ?? null
  const rows = 7
  const monthRow = 18
  const gap = 4

  return (
    <View style={styles.heatWrap}>
      <MeasuredBox>
        {width => {
          const cell = Math.floor((width - gap * (columns - 1)) / columns)
          const gridHeight = monthRow + rows * cell + (rows - 1) * gap
          return (
            <View style={{ width, height: gridHeight }} accessibilityRole="image" accessibilityLabel={`Study activity for the last ${columns} weeks`}>
              {months.map(item => (
                <Text
                  key={item.key}
                  numberOfLines={1}
                  style={[theme.type.badge, styles.monthLabel, { left: (item.column - 1) * (cell + gap), color: theme.colors.muted }]}
                >
                  {item.label}
                </Text>
              ))}
              {cells.map((item, index) => {
                const column = Math.floor(index / rows)
                const row = index % rows
                const isSelected = selectedDate === item.date
                return (
                  <Pressable
                    key={item.date}
                    onPress={() => setSelectedDate(isSelected ? null : item.date)}
                    accessibilityRole="button"
                    accessibilityLabel={`${prettyDate(item.date)}, ${item.future ? 'upcoming' : fmtDuration(item.minutes)}`}
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.heatCell,
                      {
                        left: column * (cell + gap),
                        top: monthRow + row * (cell + gap),
                        width: cell,
                        height: cell,
                        backgroundColor: item.future ? withAlpha(theme.colors.line, 0.12) : heatColor(theme, item.level),
                        borderColor: isSelected ? theme.colors.ink : 'transparent',
                        borderWidth: isSelected ? 2 : 0
                      }
                    ]}
                  />
                )
              })}
            </View>
          )
        }}
      </MeasuredBox>
      <View style={styles.heatCaption}>
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 13, flex: 1 }]}>
          {selected
            ? `${prettyDate(selected.date)} · ${selected.future ? 'Upcoming' : fmtDuration(selected.minutes)}`
            : 'Tap a day to see its study time.'}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  measured: { width: '100%' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  dashed: { width: 16, borderTopWidth: 2, borderStyle: 'dashed' },
  bars: { gap: 12 },
  barRow: { gap: 6 },
  barHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 10, borderRadius: 999, overflow: 'hidden' },
  heatWrap: { gap: 10 },
  monthLabel: { position: 'absolute', top: 0, fontSize: 11 },
  heatCell: { position: 'absolute', borderRadius: 4 },
  heatCaption: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heatLegend: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  heatSwatch: { width: 12, height: 12, borderRadius: 3 }
})
