import { PublicOnly } from '../components/auth/PublicOnly'
import { LoginScreen } from '../screens/auth/LoginScreen'

export default function Login() {
  return <PublicOnly><LoginScreen /></PublicOnly>
}
