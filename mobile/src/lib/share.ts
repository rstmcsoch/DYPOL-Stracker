import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

/**
 * Writes a file into the app's cache and opens the system share sheet. The same name is replaced on
 * each export, so repeated exports never pile up. Cache files are not user data and never leave the
 * device except through the share the user chooses.
 */
export async function shareFile(options: { name: string; content: string | Uint8Array; mimeType: string; dialogTitle: string }): Promise<void> {
  const file = new File(Paths.cache, options.name)
  if (file.exists) file.delete()
  file.create()
  file.write(options.content)
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device, so the file was not sent anywhere.')
  }
  await Sharing.shareAsync(file.uri, { mimeType: options.mimeType, dialogTitle: options.dialogTitle })
}

/** Builds a CSV with a byte-order mark, so spreadsheet apps read UTF-8 names and symbols correctly. */
export function toCsv(rows: (string | number | null)[][]): string {
  const body = rows
    .map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\r\n')
  return `\ufeff${body}`
}
