import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck } from '../../components/icons'
import { AuthCard, AuthScaffold, FormNotice } from '../../components/auth/auth-ui'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Forms'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { useToast } from '../../contexts/ToastContext'
import { supabaseConfigured } from '../../lib/config'
import { MIN_PASSWORD_LENGTH } from '../../shared/lib/auth-rules'

/**
 * Password recovery. Opening the emailed link signs the app into a short recovery session, which
 * switches this screen to "choose a new password". A plain visit offers to send the link instead.
 */
export function ResetPasswordScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { user, loading: authLoading, sendPasswordReset, updatePassword, error, clearError, endRecovery } = useAuth()
  const { notify } = useToast()
  const [override, setOverride] = useState<'request' | 'update' | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mode: 'request' | 'update' = override ?? (user ? 'update' : 'request')

  const submit = async () => {
    if (submitting) return
    clearError()
    setMessage(null)
    if (mode === 'request') {
      setSubmitting(true)
      try {
        await sendPasswordReset(email)
        setSent(true)
      } catch (submitError) {
        setMessage(submitError instanceof Error ? submitError.message : 'Could not send the reset link. Try again.')
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (!user) {
      setMessage('Open the secure reset link from your email to continue here.')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`)
      return
    }
    if (password !== confirmPassword) {
      setMessage('Those passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      await updatePassword(password)
      endRecovery()
      notify('Your password has been updated.')
      router.replace('/home')
    } catch (submitError) {
      setMessage(submitError instanceof Error ? submitError.message : 'Could not save the new password. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthScaffold
      kicker={mode === 'update' ? 'NEW PASSWORD' : 'PASSWORD RESET'}
      title={mode === 'update' ? 'Choose a new' : 'Get back into'}
      emphasis={mode === 'update' ? 'password.' : 'your notebook.'}
      blurb={mode === 'update'
        ? 'Pick something you do not use anywhere else — you will use it the next time you log in.'
        : 'Enter the email you signed up with and Stracker will send a secure reset link. Nothing changes until you open it.'}
      note={mode === 'update' ? 'Secure link verified.' : 'Reset links expire, so use yours soon.'}
    >
      {sent ? (
        <AuthCard sticker="ACCOUNT RECOVERY" icon={<Mail size={21} color={theme.colors.accent} />} eyebrow="RESET LINK SENT" heading="Check your inbox">
          <Text style={[theme.type.body, { color: theme.colors.inkSoft }]}>
            If <Text style={{ fontFamily: theme.fonts.bodyBold, color: theme.colors.ink }}>{email.trim()}</Text> belongs to a Stracker account, a secure reset link is on its way. Open it on this phone to choose a new password.
          </Text>
          <Button variant="secondary" fullWidth onPress={() => { setSent(false); clearError() }}>Use another email</Button>
          <Button fullWidth onPress={() => router.replace('/login')} icon={<ArrowRight size={16} color={theme.colors.buttonPrimaryInk} />}>Back to log in</Button>
        </AuthCard>
      ) : (
        <AuthCard
          sticker="ACCOUNT RECOVERY"
          icon={mode === 'update' ? <ShieldCheck size={21} color={theme.colors.accent} /> : <KeyRound size={21} color={theme.colors.accent} />}
          eyebrow={mode === 'update' ? 'SET A NEW PASSWORD' : 'RECOVERY LINK'}
          heading={mode === 'update' ? 'Choose a new password' : 'Reset your password'}
          footer="Reset links are single-use and sent only to the account email"
        >
          {mode === 'request' ? (
            <TextField
              label="Account email"
              required
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              maxLength={320}
              placeholder="you@example.com"
              leading={<Mail size={17} color={theme.colors.muted} />}
            />
          ) : (
            <>
              <TextField
                label="New password"
                required
                hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
                value={password}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                placeholder="Create a strong password"
                onChangeText={setPassword}
                leading={<LockKeyhole size={17} color={theme.colors.muted} />}
                trailing={
                  <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword(value => !value)} style={styles.toggle}>
                    {showPassword ? <EyeOff size={17} color={theme.colors.muted} /> : <Eye size={17} color={theme.colors.muted} />}
                  </Pressable>
                }
              />
              <TextField
                label="Confirm new password"
                required
                value={confirmPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                placeholder="Type it once more"
                onChangeText={setConfirmPassword}
                leading={<LockKeyhole size={17} color={theme.colors.muted} />}
              />
            </>
          )}
          {error ? <FormNotice tone="error">{error}</FormNotice> : null}
          {message ? <FormNotice tone="status">{message}</FormNotice> : null}
          {mode === 'update' && !user ? <FormNotice tone="status">Open the secure reset link from your email to continue here.</FormNotice> : null}
          {!supabaseConfigured ? <FormNotice tone="status">Supabase is not configured, so password reset is unavailable in this build.</FormNotice> : null}
          <Button size="lg" fullWidth loading={submitting || authLoading} disabled={!supabaseConfigured || (mode === 'update' && !user)} onPress={() => void submit()}>
            {mode === 'update' ? 'Save new password' : 'Send reset link'}
          </Button>
          <View style={styles.links}>
            {mode === 'request' ? (
              <Pressable accessibilityRole="button" onPress={() => { clearError(); setMessage(null); setOverride('update') }} style={styles.textLink}>
                <Text style={[theme.type.label, { color: theme.colors.accent }]}>I already have a reset link</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => { clearError(); setMessage(null); setOverride('request') }} style={styles.textLink}>
                <Text style={[theme.type.label, { color: theme.colors.accent }]}>Send me a new link</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="link" onPress={() => { endRecovery(); router.replace('/login') }} style={styles.textLink}>
              <Text style={[theme.type.label, { color: theme.colors.accent }]}>Back to log in</Text>
            </Pressable>
          </View>
        </AuthCard>
      )}
    </AuthScaffold>
  )
}

const styles = StyleSheet.create({
  toggle: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  links: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  textLink: { minHeight: 42, justifyContent: 'center' }
})
