// Metro configuration for the Stracker mobile app.
//
// The shared modules in src/shared are byte-for-byte copies of the website's TypeScript
// sources. Those sources import siblings with ESM-style `.js` specifiers (for example
// `../types/index.js`) that point at `.ts` files. TypeScript's bundler resolution accepts
// that; Metro does not, so this resolver maps `./x.js` onto `./x.ts` / `./x.tsx` when the
// TypeScript file exists and leaves every other specifier to Expo's default resolver.
const fs = require('node:fs')
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const upstreamResolveRequest = config.resolver.resolveRequest

// jsPDF imports fast-png at load time only to decode PNG images. Stracker draws every chart as vector
// shapes and never embeds a PNG, and fast-png needs a TextDecoder label (latin1) that Expo's UTF-8-only
// fallback rejects. Replacing it with an empty module keeps the report code loadable on every runtime.
const EMPTY_MODULES = new Set(['fast-png'])

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (EMPTY_MODULES.has(moduleName)) return { type: 'empty' }
  if ((moduleName.startsWith('./') || moduleName.startsWith('../')) && moduleName.endsWith('.js')) {
    const base = moduleName.slice(0, -'.js'.length)
    const origin = context.originModulePath
    for (const extension of ['.ts', '.tsx']) {
      if (fs.existsSync(path.resolve(path.dirname(origin), base + extension))) {
        return context.resolveRequest(context, base, platform)
      }
    }
  }
  if (upstreamResolveRequest) return upstreamResolveRequest(context, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
