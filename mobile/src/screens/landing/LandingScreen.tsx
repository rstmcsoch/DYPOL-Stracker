import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { StrackerMark } from '../../components/brand/Logo'
import {
  AlarmClock, ArrowDown, ArrowRight, ArrowUp, BookOpen, CalendarCheck, Check, ChevronDown, ChevronUp, Compass, ListChecks, LockKeyhole,
  Menu, Moon, NotebookPen, Repeat, Shield, ShieldCheck, Sparkles, Sun, Target, TrendingUp, Timer, X
} from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { Screen } from '../../components/ui/Screen'
import { NotebookCard } from '../../components/ui/Surfaces'
import { ThemeOverride, useTheme } from '../../contexts/AppearanceContext'
import { buildTheme, type AppTheme } from '../../theme/theme'
import { NotebookPreview } from './NotebookPreview'
import {
  AI_FACTS, CHAPTER_COUNT, FEATURES, HERO_PILLARS, LOOP, PRINCIPLES, PRIVACY_POINTS, SECTIONS, STEPS, type FeatureKey
} from './landing-content'

type PublicTheme = 'light' | 'dark'
const PUBLIC_THEME_KEY = 'stracker-public-home-theme'

const FEATURE_ICONS: Record<FeatureKey, (color: string) => ReactNode> = {
  syllabus: color => <BookOpen size={19} color={color} />,
  tests: color => <ListChecks size={19} color={color} />,
  mistakes: color => <NotebookPen size={19} color={color} />,
  revision: color => <AlarmClock size={19} color={color} />,
  planning: color => <CalendarCheck size={19} color={color} />,
  focus: color => <Timer size={19} color={color} />,
  analytics: color => <TrendingUp size={19} color={color} />,
  ai: color => <Sparkles size={19} color={color} />
}

/**
 * The public homepage for signed-out visitors. Section links scroll inside the page, the theme
 * switch is local to the landing page, and the call-to-action buttons open the auth screens.
 */
export function LandingScreen() {
  const router = useRouter()
  const [publicTheme, setPublicTheme] = useState<PublicTheme>('light')
  const [menuOpen, setMenuOpen] = useState(false)
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const anchors = useRef<Record<string, number>>({})
  const appTheme: AppTheme = useMemo(() => buildTheme(publicTheme, 'default', 'default'), [publicTheme])

  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(PUBLIC_THEME_KEY).then(value => {
      if (active && value === 'dark') setPublicTheme('dark')
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const toggleTheme = () => {
    setPublicTheme(current => {
      const next: PublicTheme = current === 'dark' ? 'light' : 'dark'
      void SecureStore.setItemAsync(PUBLIC_THEME_KEY, next).catch(() => undefined)
      return next
    })
  }

  const jump = (id: string) => {
    setMenuOpen(false)
    if (id === 'top') {
      scrollRef.current?.scrollTo({ y: 0, animated: true })
      return
    }
    const y = anchors.current[id]
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 72), animated: true })
  }
  const registerAnchor = useCallback((id: string, y: number) => { anchors.current[id] = y }, [])
  const anchor = useCallback((id: string) => ({ onLayout: (event: { nativeEvent: { layout: { y: number } } }) => registerAnchor(id, event.nativeEvent.layout.y) }), [registerAnchor])

  return (
    <ThemeOverride theme={appTheme}>
      <Screen chrome={false} scrollRef={scrollRef} contentStyle={styles.content}>
        <Header
          isDark={publicTheme === 'dark'}
          onToggleTheme={toggleTheme}
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen(value => !value)}
          onJump={jump}
          onLogin={() => router.push('/login')}
          onSignup={() => router.push('/signup')}
        />

        <View style={styles.hero}>
          <Text style={[appTheme.type.overline, { color: appTheme.colors.accent }]}>✎ JEE 2027 · A DIGITAL STUDY NOTEBOOK</Text>
          <Text accessibilityRole="header" style={[appTheme.type.display, styles.heroTitle, { color: appTheme.colors.ink }]}>
            Your JEE preparation, organized in <Text style={{ color: appTheme.colors.accent }}>one serious study notebook.</Text>
          </Text>
          <Text style={[appTheme.type.body, { color: appTheme.colors.inkSoft }]}>
            Stracker keeps the syllabus, the tests, the mistakes, the revision queue, the daily plan, focus sessions and the analytics on the same page — then stays quiet while you actually study.
          </Text>
          <View style={styles.pillars}>
            {HERO_PILLARS.map(pillar => (
              <View key={pillar} style={[styles.pillar, { borderColor: appTheme.colors.line, backgroundColor: appTheme.colors.paperSoft }]}>
                <Check size={13} strokeWidth={3} color={appTheme.colors.green} />
                <Text style={[appTheme.type.badge, { color: appTheme.colors.inkSoft }]}>{pillar}</Text>
              </View>
            ))}
          </View>
          <View style={styles.ctaRow}>
            <Button size="lg" onPress={() => router.push('/signup')} icon={<ArrowRight size={17} color={appTheme.colors.buttonPrimaryInk} />}>Start with Stracker</Button>
            <Button size="lg" variant="secondary" onPress={() => router.push('/login')}>Log In</Button>
          </View>
          <Pressable accessibilityRole="link" onPress={() => jump('why-stracker')} style={styles.linkRow}>
            <Text style={[appTheme.type.label, { color: appTheme.colors.accent }]}>Explore how it works</Text>
            <ArrowDown size={14} color={appTheme.colors.accent} />
          </Pressable>
          <View style={styles.metaRow}>
            <LockKeyhole size={13} color={appTheme.colors.muted} />
            <Text style={[appTheme.type.caption, { color: appTheme.colors.muted, fontSize: 12.5, flex: 1 }]}>Private to your account · Works on phone and tablet · Syncs with the website</Text>
          </View>
          <View style={styles.preview}>
            <NotebookPreview />
          </View>
        </View>

        <Section id="why-stracker" anchor={anchor('why-stracker')} eyebrow="BUILT FOR SERIOUS JEE PREPARATION" title="A study loop built on evidence." lede="Stracker is organised around the loop you already study in. Each pass through it leaves a record, and that record is what the next decision is made from.">
          {LOOP.map((item, index) => (
            <NotebookCard key={item.step} accent={index === 0 ? 'blue' : 'plain'} padding={16}>
              <View style={styles.stepHead}>
                <Text style={[appTheme.type.metric, { color: appTheme.colors.accent, fontSize: 26, lineHeight: 28 }]}>{String(index + 1).padStart(2, '0')}</Text>
                <Text accessibilityRole="header" style={[appTheme.type.h3, { color: appTheme.colors.ink }]}>{item.step}</Text>
              </View>
              <Text style={[appTheme.type.body, { color: appTheme.colors.inkSoft }]}>{item.body}</Text>
              <Text style={[appTheme.type.badge, { color: appTheme.colors.accent }]}>→ {item.link}</Text>
            </NotebookCard>
          ))}
          <View style={styles.footnote}>
            <Repeat size={15} color={appTheme.colors.muted} />
            <Text style={[appTheme.type.caption, { color: appTheme.colors.muted, flex: 1 }]}>The loop repeats all year. Nothing you log is thrown away — it is what the next revision and the next plan are built from.</Text>
          </View>
        </Section>

        <Section id="features" anchor={anchor('features')} eyebrow="INSIDE THE NOTEBOOK" title={`One notebook. ${FEATURES.length} working parts.`} lede="Nothing here is a widget. Each part is a page you will open every week of your preparation.">
          {(featuresOpen ? FEATURES : FEATURES.slice(0, 3)).map((feature, index) => (
            <NotebookCard key={feature.key} padding={16}>
              <View style={styles.featureHead}>
                <Text style={[appTheme.type.badge, { color: appTheme.colors.muted }]}>{String(index + 1).padStart(2, '0')}</Text>
                <View style={[styles.iconTile, { borderColor: appTheme.colors.line, backgroundColor: appTheme.colors.paperSoft }]}>{FEATURE_ICONS[feature.key](appTheme.colors.accent)}</View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text accessibilityRole="header" style={[appTheme.type.h3, { color: appTheme.colors.ink }]}>{feature.title}</Text>
                  <Text style={[appTheme.type.caption, { color: appTheme.colors.inkSoft }]}>{feature.summary}</Text>
                </View>
              </View>
              <View style={styles.points}>
                {feature.points.map(point => (
                  <View key={point} style={styles.point}>
                    <Check size={13} strokeWidth={3} color={appTheme.colors.green} />
                    <Text style={[appTheme.type.caption, { color: appTheme.colors.inkSoft, flex: 1 }]}>{point}</Text>
                  </View>
                ))}
              </View>
            </NotebookCard>
          ))}
          <Button variant="secondary" fullWidth onPress={() => setFeaturesOpen(value => !value)} icon={featuresOpen ? <ChevronUp size={17} color={appTheme.colors.ink} /> : <ChevronDown size={17} color={appTheme.colors.ink} />}>
            {featuresOpen ? 'Show fewer features' : `See all ${FEATURES.length} features`}
          </Button>
          <Text style={[appTheme.type.caption, { color: appTheme.colors.muted, textAlign: 'center' }]}>Also in the notebook: JSON backup and restore, CSV test history, PDF and DOCX reports, a private mistake-image bucket, and an installable app.</Text>
        </Section>

        <Section id="principle" anchor={anchor('principle')} eyebrow="WHY NOT A GENERIC APP" title="A JEE system, not a generic app." lede="A todo list has no opinion about rotation, revision intervals, or the difference between a silly mistake and a concept gap. Stracker is built around JEE preparation itself — the syllabus, the test cycle, the mistakes, and the revision that holds it together.">
          <NotebookCard padding={16}>
            {PRINCIPLES.map(item => (
              <View key={item.title} style={styles.principle}>
                <View style={[styles.tick, { backgroundColor: appTheme.colors.greenBg, borderColor: appTheme.colors.green }]}>
                  <Check size={12} strokeWidth={3} color={appTheme.colors.green} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[appTheme.type.label, { color: appTheme.colors.ink }]}>{item.title}</Text>
                  <Text style={[appTheme.type.caption, { color: appTheme.colors.inkSoft }]}>{item.body}</Text>
                </View>
              </View>
            ))}
          </NotebookCard>
          <View style={styles.footnote}>
            <Compass size={15} color={appTheme.colors.muted} />
            <Text style={[appTheme.type.caption, { color: appTheme.colors.muted, flex: 1 }]}>Fewer places to look, and a clearer idea of what to do next.</Text>
          </View>
        </Section>

        <Section id="how-it-works" anchor={anchor('how-it-works')} eyebrow="HOW IT WORKS" title="Four steps, repeated all year." lede="This is the whole method. There is nothing to configure beyond your own syllabus and your own dates.">
          {STEPS.map((step, index) => (
            <View key={step.title} style={styles.step}>
              <View style={[styles.stepNumber, { borderColor: appTheme.colors.line, backgroundColor: appTheme.colors.paperSoft }]}>
                <Text style={[appTheme.type.label, { color: appTheme.colors.accent }]}>{String(index + 1).padStart(2, '0')}</Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text accessibilityRole="header" style={[appTheme.type.h3, { color: appTheme.colors.ink }]}>{step.title}</Text>
                <Text style={[appTheme.type.caption, { color: appTheme.colors.inkSoft }]}>{step.body}</Text>
              </View>
              <Check size={14} strokeWidth={3} color={appTheme.colors.green} />
            </View>
          ))}
        </Section>

        <Section id="ai" anchor={anchor('ai')} eyebrow="STRACKER AI" title="AI that reads your notebook." lede="Stracker AI is a second pair of eyes on the data you already keep. It is optional, it runs on your own provider account, and it never changes anything without your confirmation.">
          <NotebookCard padding={16} style={{ gap: 14 }}>
            {AI_FACTS.map(fact => (
              <View key={fact.title} style={{ gap: 4 }}>
                <Text style={[appTheme.type.label, { color: appTheme.colors.ink }]}>{fact.title}</Text>
                <Text style={[appTheme.type.caption, { color: appTheme.colors.inkSoft }]}>{fact.body}</Text>
              </View>
            ))}
          </NotebookCard>
          <NotebookCard accent="yellow" padding={16} style={{ gap: 10 }}>
            <Text style={[appTheme.type.overline, { color: appTheme.colors.muted, fontSize: 11 }]}>ILLUSTRATIVE EXCHANGE</Text>
            <Text style={[appTheme.type.label, { color: appTheme.colors.ink }]}>“Which chapters are dragging my Physics score down?”</Text>
            <Text style={[appTheme.type.caption, { color: appTheme.colors.inkSoft }]}>“Two tested chapters sit below your weak threshold: Current Electricity (48%) and Rotational Motion (52%). Both have mistakes logged as Concept errors, and one revision is due today.”</Text>
            <View style={styles.footnote}>
              <Shield size={13} color={appTheme.colors.muted} />
              <Text style={[appTheme.type.badge, { color: appTheme.colors.muted, flex: 1 }]}>An example of the kind of answer supported tools produce from your own figures — not a transcript of your data.</Text>
            </View>
          </NotebookCard>
          <Button size="lg" variant="secondary" fullWidth onPress={() => router.push('/login')} icon={<ArrowRight size={17} color={appTheme.colors.ink} />}>Explore Stracker AI</Button>
          <Text style={[appTheme.type.caption, { color: appTheme.colors.muted, textAlign: 'center' }]}>Sign in, then open Settings → AI Assistant to connect a provider.</Text>
        </Section>

        <Section id="privacy" anchor={anchor('privacy')} eyebrow="PRIVACY & SECURITY" title="Your preparation stays yours." lede="Stracker keeps personal academic records, so the access boundary is boring on purpose: your account, your rows, nothing shared.">
          <NotebookCard padding={16}>
            {PRIVACY_POINTS.map(point => (
              <View key={point.title} style={{ gap: 4, paddingVertical: 8 }}>
                <View style={styles.inline}>
                  <ShieldCheck size={15} color={appTheme.colors.green} />
                  <Text style={[appTheme.type.label, { color: appTheme.colors.ink }]}>{point.title}</Text>
                </View>
                <Text style={[appTheme.type.caption, { color: appTheme.colors.inkSoft }]}>{point.body}</Text>
              </View>
            ))}
          </NotebookCard>
          <View style={styles.footnote}>
            <LockKeyhole size={14} color={appTheme.colors.muted} />
            <Text style={[appTheme.type.caption, { color: appTheme.colors.muted, flex: 1 }]}>Not a claim about encryption we do not have: the app loads no advertising or third-party tracking scripts, and the only key it holds is the public one.</Text>
          </View>
        </Section>

        <View style={styles.section} {...anchor('dypol-labs')}>
          <NotebookCard padding={18} style={{ gap: 10 }}>
            <View style={styles.inline}>
              <View style={[styles.dypolMark, { backgroundColor: appTheme.colors.paperSoft, borderColor: appTheme.colors.line }]}>
                <Text style={[appTheme.type.brand, { color: appTheme.colors.ink }]}>S</Text>
              </View>
              <Text accessibilityRole="header" style={[appTheme.type.h2, { color: appTheme.colors.ink, flex: 1 }]}>Stracker by DYPOL LABS</Text>
            </View>
            <Text style={[appTheme.type.body, { color: appTheme.colors.inkSoft }]}>Stracker is a DYPOL LABS product. We build practical tools for serious learners — software that does one job properly, stays quiet while you work, and keeps your data where it belongs.</Text>
            <Text style={[appTheme.type.overline, { color: appTheme.colors.accent, fontSize: 11 }]}>A DYPOL LABS STUDY TOOL</Text>
          </NotebookCard>
        </View>

        <View style={styles.section}>
          <NotebookCard accent="blue" padding={18} style={{ gap: 12 }}>
            <Text style={[appTheme.type.overline, { color: appTheme.colors.accent }]}>✎ LAST PAGE, FIRST ENTRY</Text>
            <Text accessibilityRole="header" style={[appTheme.type.h1, { color: appTheme.colors.ink }]}>Build a system you can <Text style={{ color: appTheme.colors.accent }}>actually follow.</Text></Text>
            <Text style={[appTheme.type.body, { color: appTheme.colors.inkSoft }]}>Start organizing your JEE preparation with Stracker. Set your exam dates, work through the syllabus, log the next test — and let the notebook keep the record from there.</Text>
            <Button size="lg" fullWidth onPress={() => router.push('/signup')} icon={<ArrowRight size={17} color={appTheme.colors.buttonPrimaryInk} />}>Create your Stracker account</Button>
            <Button size="lg" variant="secondary" fullWidth onPress={() => router.push('/login')}>I already have an account</Button>
            <View style={styles.footnote}>
              <Target size={14} color={appTheme.colors.muted} />
              <Text style={[appTheme.type.caption, { color: appTheme.colors.muted, flex: 1 }]}>Your notebook starts with the seeded JEE 2027 syllabus ({CHAPTER_COUNT} chapters), which you can edit, reorder or replace. Set your own dates and daily goal, and the plan follows from there.</Text>
            </View>
          </NotebookCard>
        </View>

        <Footer
          onJump={jump}
          onLogin={() => router.push('/login')}
          onSignup={() => router.push('/signup')}
          onReset={() => router.push('/reset-password')}
        />
      </Screen>
    </ThemeOverride>
  )
}

function Header({ isDark, onToggleTheme, menuOpen, onToggleMenu, onJump, onLogin, onSignup }: {
  isDark: boolean
  onToggleTheme: () => void
  menuOpen: boolean
  onToggleMenu: () => void
  onJump: (id: string) => void
  onLogin: () => void
  onSignup: () => void
}) {
  const theme = useTheme()
  return (
    <View style={styles.headerWrap}>
      <View style={styles.headerRow}>
        <View style={styles.brand}>
          <StrackerMark size={30} />
          <View>
            <Text style={[theme.type.brand, { color: theme.colors.ink, fontSize: 20, lineHeight: 22 }]}>Stracker</Text>
            <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 11, lineHeight: 13 }]}>by DYPOL LABS</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: isDark }}
          accessibilityLabel={isDark ? 'Night mode on. Switch to light mode.' : 'Light mode on. Switch to night mode.'}
          onPress={onToggleTheme}
          style={[styles.themeToggle, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}
        >
          {isDark ? <Moon size={15} color={theme.colors.ink} /> : <Sun size={15} color={theme.colors.ink} />}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={menuOpen ? 'Close menu' : 'Open menu'} accessibilityState={{ expanded: menuOpen }} onPress={onToggleMenu} style={[styles.themeToggle, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
          {menuOpen ? <X size={18} color={theme.colors.ink} /> : <Menu size={18} color={theme.colors.ink} />}
        </Pressable>
      </View>
      {menuOpen ? (
        <View style={[styles.menu, { borderColor: theme.colors.line, backgroundColor: theme.colors.paper }]}>
          {SECTIONS.map(section => (
            <Pressable key={section.id} accessibilityRole="link" onPress={() => onJump(section.id)} style={styles.menuLink}>
              <Text style={[theme.type.label, { color: theme.colors.ink }]}>{section.label}</Text>
            </Pressable>
          ))}
          <View style={styles.menuActions}>
            <Button variant="secondary" onPress={onLogin}>Log In</Button>
            <Button onPress={onSignup}>Sign Up</Button>
          </View>
        </View>
      ) : null}
    </View>
  )
}

function Section({ id, anchor, eyebrow, title, lede, children }: {
  id: string
  anchor: { onLayout: (event: { nativeEvent: { layout: { y: number } } }) => void }
  eyebrow: string
  title: string
  lede?: string
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <View style={styles.section} {...anchor}>
      <View style={styles.sectionHead}>
        <Text style={[theme.type.overline, { color: theme.colors.accent }]}>✎ {eyebrow}</Text>
        <Text accessibilityRole="header" style={[theme.type.h1, { color: theme.colors.ink }]}>{title}</Text>
        {lede ? <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>{lede}</Text> : null}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

function Footer({ onJump, onLogin, onSignup, onReset }: {
  onJump: (id: string) => void
  onLogin: () => void
  onSignup: () => void
  onReset: () => void
}) {
  const theme = useTheme()
  const year = new Date().getFullYear()
  const groups: { title: string; links: { label: string; action: () => void }[] }[] = [
    { title: 'Product', links: [{ label: 'Features', action: () => onJump('features') }, { label: 'AI Assistant', action: () => onJump('ai') }, { label: 'How It Works', action: () => onJump('how-it-works') }] },
    { title: 'Account', links: [{ label: 'Log In', action: onLogin }, { label: 'Sign Up', action: onSignup }, { label: 'Reset password', action: onReset }] },
    { title: 'Information', links: [{ label: 'Privacy', action: () => onJump('privacy') }, { label: 'Study system', action: () => onJump('why-stracker') }] },
    { title: 'Brand', links: [{ label: 'DYPOL LABS', action: () => onJump('dypol-labs') }] }
  ]
  return (
    <View style={[styles.footer, { borderTopColor: theme.colors.line }]}>
      <View style={styles.footerGroups}>
        {groups.map(group => (
          <View key={group.title} style={styles.footerGroup}>
            <Text style={[theme.type.overline, { color: theme.colors.muted, fontSize: 11 }]}>{group.title}</Text>
            {group.links.map(link => (
              <Pressable key={link.label} accessibilityRole="link" onPress={link.action} style={styles.footerLink}>
                <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>{link.label}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to top" onPress={() => onJump('top')} style={styles.toTop}>
        <ArrowUp size={13} color={theme.colors.muted} />
        <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Back to top</Text>
      </Pressable>
      <Text style={[theme.type.caption, { color: theme.colors.muted, textAlign: 'center' }]}>© {year} DYPOL LABS · Stracker for JEE 2027</Text>
      <Text style={[theme.type.brand, { color: theme.colors.line, fontSize: 40, lineHeight: 42, textAlign: 'center', marginTop: 8 }]}>STRACKER</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { gap: 0 },
  headerWrap: { marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52 },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  themeToggle: { width: 42, height: 42, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  menu: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 4, marginTop: 6 },
  menuLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  menuActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  hero: { gap: 14, paddingTop: 10, paddingBottom: 28 },
  heroTitle: { fontSize: 34, lineHeight: 38 },
  pillars: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pillar: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  ctaRow: { gap: 10 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 42 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  preview: { marginTop: 10 },
  section: { paddingTop: 34, gap: 16 },
  sectionHead: { gap: 8 },
  sectionBody: { gap: 12 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footnote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconTile: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  points: { gap: 6, marginTop: 10 },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  principle: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  stepNumber: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dypolMark: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { marginTop: 40, paddingTop: 24, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 14 },
  footerGroups: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  footerGroup: { width: '45%', gap: 4 },
  footerLink: { minHeight: 36, justifyContent: 'center' },
  toTop: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', minHeight: 40 }
})
