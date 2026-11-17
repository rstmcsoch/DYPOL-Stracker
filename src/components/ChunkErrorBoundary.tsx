import { Component, type ReactNode } from 'react'
import { isChunkLoadError, reloadOnce } from '../lib/chunk-recovery'

/**
 * Last line of defence when a page's code cannot be loaded even after the automatic reload:
 * shows a plain retry message instead of a blank screen. Other errors are rethrown unchanged.
 */
export class ChunkErrorBoundary extends Component<{ children: ReactNode }, { error: unknown; failed: boolean }> {
  state: { error: unknown; failed: boolean } = { error: null, failed: false }

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true }
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error)) reloadOnce()
  }

  render() {
    if (!this.state.failed) return this.props.children
    // Not a loading problem: let it reach the app's normal error handling exactly as before.
    if (!isChunkLoadError(this.state.error)) throw this.state.error
    return <div className="route-loading" role="alert">
      <span>This page didn’t load. Check your connection and retry.</span>
      <button type="button" className="button type-button button-secondary button-md" onClick={() => window.location.reload()}>Reload</button>
    </div>
  }
}
