// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { IsolatedMemoryRouter } from './canvas-router'

afterEach(cleanup)

let go: (path: string) => void = () => undefined
function Pages() {
  const navigate = useNavigate()
  go = path => navigate(path)
  return <Routes>
    <Route path="/tests" element={<p>page:tests</p>} />
    <Route path="/analytics" element={<p>page:analytics</p>} />
    <Route index element={<p>page:home</p>} />
  </Routes>
}

/** Mirrors production: the canvas renders inside the console's `/control-panel/*` route. */
function inConsole(initialPath: string) {
  return render(<MemoryRouter initialEntries={['/control-panel/preview/student-canvas']}>
    <Routes><Route path="/control-panel/*" element={<IsolatedMemoryRouter initialPath={initialPath}><Pages /></IsolatedMemoryRouter>} /></Routes>
  </MemoryRouter>)
}

describe('editor canvas router', () => {
  it('opens the requested student page inside the console route (not always Home)', () => {
    inConsole('/analytics')
    expect(screen.getByText('page:analytics')).toBeTruthy()
  })

  it('navigates between student pages', () => {
    inConsole('/analytics')
    act(() => go('/tests'))
    expect(screen.queryByText('page:analytics')).toBeNull()
    expect(screen.getByText('page:tests')).toBeTruthy()
  })
})
