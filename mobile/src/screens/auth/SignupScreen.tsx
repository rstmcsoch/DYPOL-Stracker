import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, NotebookPen, UserRound } from '../../components/icons'
import { AuthCard, AuthScaffold, FormNotice } from '../../components/auth/auth-ui'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Forms'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { useToast } from '../../contexts/ToastContext'
import { localPreviewEnabled, supabaseConfigured } from '../../lib/config'
import { MIN_PASSWORD_LENGTH } from '../../shared/lib/auth-rules'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PERKS = [
  'A seeded, editable JEE 2027 syllabus waiting for you',
  'Two exam dates, a daily study goal, and a plan for today',
  'Private by default: your records belong to your account only'
]

/** Creates a real Supabase account. Depending on the project's settings it opens the notebook or asks for an email confirmation. */
export function SignupScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { signUp, resendConfirmation, error, clearError, loading: authLoading } = useAuth()
  const { notify } = useToast()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const configured = supabaseConfigured

  const clearFieldError = (key: string) => setFieldErrors(current => {
    if (!current[key]) return current
    const next = { ...current }
    delete next[key]
    return next
  })

  const validate = () => {
    const next: Record<string, string> = {}
    if (!displayName.trim()) next.displayName = 'Tell Stracker what to call you.'
    if (displayName.trim().length > 100) next.displayName = 'Keep the name under 100 characters.'
    if (!email.trim()) next.email = 'Enter the email address you want to sign in with.'
    else if (!EMAIL_PATTERN.test(email.trim())) next.email = 'That email address does not look complete.'
    if (password.length < MIN_PASSWORD_LENGTH) next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    if (confirmPassword !== password) next.confirmPassword = 'Those passwords do not match.'
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async () => {
    if (submitting) return
    clearError()
    if (!validate()) return
    setSubmitting(true)
    try {
      const result = await signUp(email, password, displayName)
      if (result.needsEmailConfirmation) setSentTo(email.trim())
      // Otherwise the session is live and the root redirect opens the notebook.
    } catch (submitError) {
      notify(submitError instanceof Error ? submitError.message : 'Could not create the account. Try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const resend = async () => {
    if (!sentTo || resending) return
    setResending(true)
    try {
      await resendConfirmation(sentTo)
      notify('Confirmation email sent again. Check your inbox.')
    } catch (resendError) {
      notify(resendError instanceof Error ? resendError.message : 'Could not resend the email. Try again in a moment.', 'error')
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthScaffold
      kicker="CREATE YOUR NOTEBOOK"
      title="Start the record"
      emphasis="on day one."
      blurb="Set up your JEE 2027 syllabus once, then let every test, mistake, revision and study session land in the same place."
      note="The best time to start keeping the record is before the first test."
    >
      {sentTo ? (
        <AuthCard sticker="A NEW NOTEBOOK" icon={<Mail size={21} color={theme.colors.accent} />} eyebrow="CHECK YOUR INBOX" heading="Confirm your email">
          <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>
            Your account is created. We sent a confirmation link to <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{sentTo}</Text>. Open it to activate the notebook, then log in.
          </Text>
          {error ? <FormNotice tone="error">{error}</FormNotice> : null}
          <Button variant="secondary" fullWidth loading={resending} onPress={() => void resend()}>Resend the email</Button>
          <Button fullWidth onPress={() => router.replace('/login')} icon={<ArrowRight size={16} color={theme.colors.buttonPrimaryInk} />}>Go to log in</Button>
          <Pressable accessibilityRole="button" onPress={() => { setSentTo(null); clearError() }} style={styles.textLink}>
            <Text style={[theme.type.label, { color: theme.colors.accent }]}>Use a different email</Text>
          </Pressable>
        </AuthCard>
      ) : (
        <AuthCard
          sticker="A NEW NOTEBOOK"
          icon={<UserRound size={21} color={theme.colors.accent} />}
          eyebrow="NEW ACCOUNT"
          heading="Create your Stracker account"
        >
          <TextField
            label="What should Stracker call you?"
            required
            error={fieldErrors.displayName}
            value={displayName}
            maxLength={100}
            autoComplete="name"
            placeholder="Your name"
            onChangeText={value => { setDisplayName(value); clearFieldError('displayName') }}
            leading={<UserRound size={17} color={theme.colors.muted} />}
          />
          <TextField
            label="Email"
            required
            error={fieldErrors.email}
            value={email}
            maxLength={320}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@example.com"
            onChangeText={value => { setEmail(value); clearFieldError('email') }}
            leading={<Mail size={17} color={theme.colors.muted} />}
          />
          <TextField
            label="Password"
            required
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            error={fieldErrors.password}
            value={password}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="Create a strong password"
            onChangeText={value => { setPassword(value); clearFieldError('password') }}
            leading={<LockKeyhole size={17} color={theme.colors.muted} />}
            trailing={
              <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword(value => !value)} style={styles.toggle}>
                {showPassword ? <EyeOff size={17} color={theme.colors.muted} /> : <Eye size={17} color={theme.colors.muted} />}
              </Pressable>
            }
          />
          <TextField
            label="Confirm password"
            required
            error={fieldErrors.confirmPassword}
            value={confirmPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="Type it once more"
            onChangeText={value => { setConfirmPassword(value); clearFieldError('confirmPassword') }}
            leading={<LockKeyhole size={17} color={theme.colors.muted} />}
          />
          <View style={styles.perks}>
            {PERKS.map(perk => (
              <View key={perk} style={styles.perk}>
                <Check size={13} strokeWidth={3} color={theme.colors.green} />
                <Text style={[theme.type.caption, { color: theme.colors.inkSoft, flex: 1 }]}>{perk}</Text>
              </View>
            ))}
          </View>
          {error ? <FormNotice tone="error">{error}</FormNotice> : null}
          {!configured && !localPreviewEnabled ? <FormNotice tone="status">Supabase is not configured, so accounts cannot be created yet. Add the public project URL and anon key to the build environment, then rebuild.</FormNotice> : null}
          <Button size="lg" fullWidth loading={submitting || authLoading} disabled={!configured} onPress={() => void submit()}>
            Create my Stracker account
          </Button>
          <View style={styles.switchRow}>
            <Text style={[theme.type.caption, { color: theme.colors.muted }]}>Already have a notebook?</Text>
            <Pressable accessibilityRole="link" onPress={() => router.replace('/login')} style={styles.textLink}>
              <Text style={[theme.type.label, { color: theme.colors.accent }]}>Log in instead</Text>
            </Pressable>
          </View>
        </AuthCard>
      )}
      <View style={styles.hint}>
        <NotebookPen size={13} color={theme.colors.muted} />
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5, flex: 1 }]}>Accounts are created in the same Supabase project as the website.</Text>
      </View>
    </AuthScaffold>
  )
}

const styles = StyleSheet.create({
  toggle: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  perks: { gap: 8 },
  perk: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  textLink: { minHeight: 42, justifyContent: 'center', alignSelf: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }
})
