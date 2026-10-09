import { Redirect } from 'expo-router'

/** Unknown addresses return to the start, as the website's catch-all route does. */
export default function NotFound() {
  return <Redirect href="/" />
}
