import type { ReactNode } from 'react'
import { Redirect } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'

/** Log in and sign up are for visitors only: a signed-in user is sent to the notebook. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Redirect href="/" />
  return <>{children}</>
}
