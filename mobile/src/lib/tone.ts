import { createAudioPlayer, type AudioPlayer } from 'expo-audio'

/** The same bundled tone the focus timer plays at the end of a block. Shared so Settings can preview it. */
const TONE = require('../../assets/sounds/focus-complete.wav') as number
let current: AudioPlayer | null = null

/** Plays the completion tone. Returns false when audio is unavailable, so the caller can say so. */
export function playFocusTone(): boolean {
  try {
    current?.remove()
    current = createAudioPlayer(TONE)
    current.play()
    return true
  } catch {
    return false
  }
}
