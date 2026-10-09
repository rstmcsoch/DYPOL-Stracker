import { PublicOnly } from '../components/auth/PublicOnly'
import { SignupScreen } from '../screens/auth/SignupScreen'

export default function Signup() {
  return <PublicOnly><SignupScreen /></PublicOnly>
}
