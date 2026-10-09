// ESLint for the mobile app. Uses Expo's flat preset; generated and synced files are excluded
// because they are produced from the website sources and must not be hand-edited.
const { defineConfig, globalIgnores } = require('eslint/config')
const expo = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expo,
  globalIgnores(['dist/**', 'android/**', 'ios/**', 'src/theme/design-tokens.generated.ts'])
])
