# Flutter and its plugins are already covered by the Flutter Gradle plugin's defaults.
# Supabase's Dart side is AOT-compiled, so only the thin Android shims need keeping.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-dontwarn io.flutter.embedding.**
