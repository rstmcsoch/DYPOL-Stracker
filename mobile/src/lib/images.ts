/**
 * Mistake photos, handled the way the website does it: the picked image is scaled to at most 1600 px
 * on its longest side, encoded as WebP at quality 0.78, kept as a `data:image/webp` URL until sync,
 * and then uploaded to the `mistake-images` bucket at `${userId}/${uuid}.webp`.
 */
import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_EDGE = 1600
export const WEBP_QUALITY = 0.78
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1)
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) table[BASE64_ALPHABET.charCodeAt(index)] = index
  return table
})()

/** Decodes standard base64 without relying on `atob`, which is not guaranteed on every Hermes build. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '')
  const output = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let index = 0
  for (let position = 0; position < clean.length; position += 1) {
    const value = BASE64_LOOKUP[clean.charCodeAt(position)] ?? -1
    if (value < 0) continue
    buffer = ((buffer << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      output[index] = (buffer >> bits) & 0xff
      index += 1
    }
  }
  return output.subarray(0, index)
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0 || !dataUrl.slice(0, comma).endsWith(';base64')) {
    throw new Error('The saved photo is not a valid image.')
  }
  return base64ToBytes(dataUrl.slice(comma + 1))
}

export function isAcceptedImage(mimeType: string | null | undefined, uri: string, sizeBytes: number | null | undefined): boolean {
  const lowered = uri.toLowerCase().split('?')[0] ?? ''
  const byExtension = /\.(jpe?g|png|webp)$/.test(lowered)
  const typeOk = mimeType ? ACCEPTED_TYPES.includes(mimeType) : byExtension
  const sizeOk = sizeBytes === null || sizeBytes === undefined || sizeBytes <= MAX_IMAGE_BYTES
  return typeOk && sizeOk
}

export function scaledEdges(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Opens the system photo picker and returns the compressed WebP as a data URL, or null if the user
 * cancelled. Throws a user-facing error for unsupported or oversized files.
 */
export async function pickMistakePhoto(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
    base64: false,
    exif: false
  })
  if (result.canceled || !result.assets[0]) return null
  const asset = result.assets[0]
  if (!isAcceptedImage(asset.mimeType, asset.uri, asset.fileSize)) {
    throw new Error('Choose a JPG, PNG, or WebP image under 10 MB.')
  }
  const edges = scaledEdges(asset.width, asset.height)
  const context = ImageManipulator.ImageManipulator.manipulate(asset.uri)
  context.resize({ width: edges.width, height: edges.height })
  const rendered = await context.renderAsync()
  const saved = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.WEBP, compress: WEBP_QUALITY, base64: true })
  if (!saved.base64) throw new Error('That image could not be compressed on this device.')
  return `data:image/webp;base64,${saved.base64}`
}

/** Encodes bytes as standard base64. Used to embed cloud photos in a JSON backup. */
export function bytesToBase64(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const triple = (first << 16) | (second << 8) | third
    output += BASE64_ALPHABET[(triple >> 18) & 63]
    output += BASE64_ALPHABET[(triple >> 12) & 63]
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : '='
    output += index + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '='
  }
  return output
}
