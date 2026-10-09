import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles } from '../../components/icons'
import { AuthCard, AuthScaffold, FormNotice } from '../../components/auth/auth-ui'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Forms'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/AppearanceContext'
import { localPreviewEnabled, supabaseConfigured } from '../../lib/config'
import { useToast } from '../../contexts/ToastContext'

/** Log in. Registration and recovery are separate screens, as on the website. */
export function LoginScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { signIn, startLocalPreview, error, clearError, loading: authLoading } = useAuth()
  const { notify } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const configured = supabaseConfigured || localPreviewEnabled

  const submit = async () => {
    if (submitting) return
    clearError()
    setSubmitting(true)
    try {
      // On success the auth state changes and the root redirect opens the notebook.
      await signIn(email, password)
    } catch {
      // The context has already set a friendly message for the notice above.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthScaffold
      kicker="WELCOME BACK"
      title="Open your notebook"
      emphasis="where you left it."
      blurb="Your syllabus progress, test history, mistake list, revision queue and today’s plan are exactly where you left them."
      note="One page. One problem. One step forward."
    >
      <AuthCard
        sticker="YOUR NOTEBOOK AWAITS"
        icon={<ShieldCheck size={21} color={theme.colors.accent} />}
        eyebrow="ACCOUNT ACCESS"
        heading="Log in to Stracker"
        footer="Secure session · Study records stay private to your account"
      >
        <TextField
          label="Email"
          required
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          maxLength={320}
          placeholder="you@example.com"
          leading={<Mail size={17} color={theme.colors.muted} />}
        />
        <TextField
          label="Password"
          required
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="password"
          textContentType="password"
          placeholder="Your password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          leading={<LockKeyhole size={17} color={theme.colors.muted} />}
          trailing={
            <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword(value => !value)} style={styles.toggle}>
              {showPassword ? <EyeOff size={17} color={theme.colors.muted} /> : <Eye size={17} color={theme.colors.muted} />}
            </Pressable>
          }
        />
        {error ? <FormNotice tone="error">{error}</FormNotice> : null}
        {!configured ? <FormNotice tone="status">Supabase is not configured. Add the public project URL and anon key to the build environment, then rebuild.</FormNotice> : null}
        <Button size="lg" fullWidth loading={submitting || authLoading} disabled={!configured} onPress={() => void submit()}>
          Open my notebook
        </Button>
        <View style={styles.links}>
          <Pressable accessibilityRole="link" onPress={() => router.push('/reset-password')} style={styles.textLink}>
            <Text style={[theme.type.label, { color: theme.colors.accent }]}>Forgot your password?</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/signup')} style={styles.textLink}>
            <Text style={[theme.type.label, { color: theme.colors.accent }]}>Create an account</Text>
          </Pressable>
        </View>
      </AuthCard>

      {localPreviewEnabled ? (
        <View style={[styles.preview, { borderColor: theme.colors.line, backgroundColor: theme.colors.paperSoft }]}>
          <View style={styles.previewHead}>
            <View style={[styles.dot, { backgroundColor: theme.colors.accent }]} />
            <Text style={[theme.type.label, { color: theme.colors.ink }]}>Building or exploring locally?</Text>
          </View>
          <Text style={[theme.type.caption, { color: theme.colors.inkSoft }]}>Open a private, on-device preview. Nothing syncs to the cloud.</Text>
          <Button variant="secondary" fullWidth onPress={() => { startLocalPreview(); notify('Local preview: nothing syncs to the cloud.') }}>Continue on this device</Button>
        </View>
      ) : null}
      <View style={styles.hint}>
        <Sparkles size={13} color={theme.colors.muted} />
        <Text style={[theme.type.caption, { color: theme.colors.muted, fontSize: 12.5 }]}>Your sign-in uses the same account as the website.</Text>
      </View>
    </AuthScaffold>
  )
}

const styles = StyleSheet.create({
  toggle: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  links: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  textLink: { minHeight: 42, justifyContent: 'center' },
  preview: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 10, marginTop: 16 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }
})
