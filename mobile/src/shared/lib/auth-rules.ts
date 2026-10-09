/** One password rule shared by sign-up, password reset and Settings → change password. */
export const MIN_PASSWORD_LENGTH = 8

export function passwordLengthError(password: string): string | null {
  return password.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : null
}
