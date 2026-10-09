import { useEffect, useState, type ReactNode } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { Stack, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { ToastProvider } from '../contexts/ToastContext'
import { DataProvider, useData } from '../contexts/DataContext'
import { AppearanceProvider, useTheme } from '../contexts/AppearanceContext'
import { SplashOverlay } from '../components/brand/SplashOverlay'
import { ToastViewport } from '../components/ui/Toasts'
import { useAppFonts } from '../theme/fonts'

// The native splash stays up until the fonts, the session, and the cache are ready.
void SplashScreen.preventAutoHideAsync().catch(() => undefined)

/** Minimum time the branded splash stays on screen, so the launch never flickers. */
const SPLASH_MIN_MS = 700

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ToastProvider>
          <DataProvider>
            <AppearanceProvider>
              <LaunchGate>
                <RootStack />
              </LaunchGate>
            </AppearanceProvider>
          </DataProvider>
        </ToastProvider>
      </AuthProvider>
    </SafeAreaProvider>
  )
}

/** Holds the branded splash over the app until fonts, the session, and the local cache are ready, then fades it out. */
function LaunchGate({ children }: { children: ReactNode }) {
  const { loaded: fontsLoaded, error: fontError } = useAppFonts()
  const { loading: authLoading } = useAuth()
  const { loading: dataLoading } = useData()
  const [minimumElapsed, setMinimumElapsed] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [opacity] = useState(() => new Animated.Value(1))
  useEffect(() => {
    const timer = setTimeout(() => setMinimumElapsed(true), SPLASH_MIN_MS)
    return () => clearTimeout(timer)
  }, [])
  const ready = (fontsLoaded || fontError !== null) && !authLoading && !dataLoading && minimumElapsed
  useEffect(() => {
    if (!ready) return
    void SplashScreen.hideAsync().catch(() => undefined)
    Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }).start(() => setOverlayVisible(false))
  }, [ready, opacity])
  return (
    <View style={styles.fill}>
      {children}
      {overlayVisible ? <SplashOverlay opacity={opacity} /> : null}
    </View>
  )
}

function RootStack() {
  const theme = useTheme()
  const segments = useSegments()
  const inApp = segments[0] === '(app)'
  return (
    <View style={styles.fill}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: theme.colors.bg }
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="signup" options={{ animation: 'fade' }} />
        <Stack.Screen name="reset-password" options={{ animation: 'fade' }} />
        <Stack.Screen name="(app)" options={{ animation: 'fade' }} />
      </Stack>
      <ToastViewport raised={inApp} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 }
})
