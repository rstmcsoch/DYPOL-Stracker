/** Jest runs the shared-logic suites and the app's own unit tests under the jest-expo preset. */
module.exports = {
  preset: 'jest-expo',
  // Helpers under __tests__/support are fixtures, not suites.
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '/.expo/', '/__tests__/support/'],
  moduleNameMapper: {
    // Mirror the Metro resolver: `./x.js` in shared sources resolves to `./x.ts`.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // jsPDF's browser build is ES-module only. Tests use its CommonJS Node build, which has the same
    // API; the optional browser-only packages it loads are stubbed. Metro still ships the browser build.
    '^jspdf$': '<rootDir>/node_modules/jspdf/dist/jspdf.node.min.js',
    '^(canvg|dompurify|html2canvas|fast-png)$': '<rootDir>/__tests__/support/empty-module.js'
  },
  setupFiles: ['<rootDir>/jest.setup.js']
}
