/**
 * Entry-screen navigation, rendered with React Native Testing Library. Expo Router, the auth state, and
 * the theme are replaced, so each test can read the route a control requests and the redirect the root applies.
 */
import type { ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context'
import Index from '../src/app/index'
import { LandingScreen } from '../src/screens/landing/LandingScreen'

const SAFE_AREA: Metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }

/** Screens read safe-area insets, so they render inside the real provider with fixed metrics. */
function renderScreen(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={SAFE_AREA}>{ui}</SafeAreaProvider>)
}

const mockPush = jest.fn()
const mockRedirects: string[] = []
const mockAuth: { user: { id: string } | null; loading: boolean; recovering: boolean } = { user: null, loading: false, recovering: false }

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/',
  useSegments: () => [],
  Redirect: ({ href }: { href: string }) => {
    mockRedirects.push(href)
    return null
  },
  Stack: { Screen: () => null }
}))
// Icon glyphs are not under test. lucide-react-native ships untransformed ES modules, so its icons render as nothing here.
jest.mock('lucide-react-native', () => {
  const Icon = () => null
  return new Proxy({ __esModule: true }, { get: (target, key) => (key in target ? Reflect.get(target, key) : Icon) })
})
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined)
}))
jest.mock('react-native-svg', () => {
  const React = jest.requireActual('react')
  const { View } = jest.requireActual('react-native')
  const Stub = ({ children }: { children?: unknown }) => React.createElement(View, null, children)
  return {
    __esModule: true,
    default: Stub,
    SvgXml: Stub,
    Svg: Stub,
    Path: Stub,
    G: Stub,
    Circle: Stub,
    Rect: Stub,
    Line: Stub,
    Polygon: Stub,
    Polyline: Stub,
    Defs: Stub,
    ClipPath: Stub,
    Text: Stub,
    Use: Stub,
    Stop: Stub,
    LinearGradient: Stub,
    Mask: Stub,
    Ellipse: Stub,
    Pattern: Stub
  }
})
jest.mock('../src/contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
jest.mock('../src/contexts/AppearanceContext', () => ({
  useTheme: () => require('../src/theme/theme').buildTheme('light', 'default', 'default'),
  ThemeOverride: ({ children }: { children: unknown }) => children,
  AppearanceProvider: ({ children }: { children: unknown }) => children
}))

beforeEach(() => {
  mockPush.mockClear()
  mockRedirects.length = 0
  Object.assign(mockAuth, { user: null, loading: false, recovering: false })
})

describe('landing page navigation', () => {
  it('sends a new visitor to sign-up and a returning visitor to log-in', () => {
    renderScreen(<LandingScreen />)
    fireEvent.press(screen.getByText('Start with Stracker'))
    expect(mockPush).toHaveBeenLastCalledWith('/signup')
    const logIn = screen.getAllByText('Log In')[0]
    if (!logIn) throw new Error('the landing page has no Log In control')
    fireEvent.press(logIn)
    expect(mockPush).toHaveBeenLastCalledWith('/login')
  })
})

describe('root route', () => {
  it('shows the public landing page to a signed-out visitor', () => {
    renderScreen(<Index />)
    expect(screen.getByText('Start with Stracker')).toBeTruthy()
    expect(mockRedirects).toEqual([])
  })

  it('sends a signed-in user straight into the notebook', () => {
    mockAuth.user = { id: 'user-1' }
    renderScreen(<Index />)
    expect(mockRedirects).toEqual(['/home'])
  })

  it('sends a password-recovery session to the reset screen', () => {
    mockAuth.user = { id: 'user-1' }
    mockAuth.recovering = true
    renderScreen(<Index />)
    expect(mockRedirects).toEqual(['/reset-password'])
  })
})
