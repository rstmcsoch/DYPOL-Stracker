import { Redirect } from 'expo-router'
import { useAuth } from '../contexts/AuthContext'
import { LandingScreen } from '../screens/landing/LandingScreen'

/** Signed-out visitors see the homepage. A signed-in user goes straight into the notebook. */
export default function Index() {
  const { user, loading, recovering } = useAuth()
  if (loading) return null
  if (user && recovering) return <Redirect href="/reset-password" />
  if (user) return <Redirect href="/home" />
  return <LandingScreen />
}
