// Entry point. The polyfills must load before expo-router, and therefore before any screen module.
import './src/lib/runtime/polyfills'
import 'expo-router/entry'
