import type { ReactNode } from 'react'
import { MemoryRouter, UNSAFE_LocationContext, UNSAFE_RouteContext } from 'react-router-dom'

const ROOT_ROUTE_CONTEXT = { outlet: null, matches: [], isDataRoute: false }

/**
 * In-memory router for the editor canvas, detached from the console router it is mounted in.
 * Both the outer location and the outer route matches are cleared: without the second, the
 * inner routes resolve against the console's `/control-panel/*` match and every student path
 * collapses to the index route (Home).
 */
export function IsolatedMemoryRouter({ initialPath, children }: { initialPath: string; children: ReactNode }) {
  return <UNSAFE_LocationContext.Provider value={null as never}>
    <UNSAFE_RouteContext.Provider value={ROOT_ROUTE_CONTEXT as never}>
      <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
    </UNSAFE_RouteContext.Provider>
  </UNSAFE_LocationContext.Provider>
}
