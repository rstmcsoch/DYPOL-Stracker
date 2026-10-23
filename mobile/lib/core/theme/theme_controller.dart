import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/models.dart';

/// Appearance state: display mode (light / dark / follow device), the account's colour
/// palette and the reading font. Mirrors Settings → Appearance, and the app header has
/// a light/night switch that writes the same value.
class ThemeState {
  const ThemeState({
    this.mode = ThemeMode.system,
    this.paletteId = 'default',
    this.readingFont = 'lexend',
  });

  final ThemeMode mode;
  final String paletteId;
  final String readingFont;

  ThemeState copyWith({ThemeMode? mode, String? paletteId, String? readingFont}) => ThemeState(
        mode: mode ?? this.mode,
        paletteId: paletteId ?? this.paletteId,
        readingFont: readingFont ?? this.readingFont,
      );

  String get modeValue => mode == ThemeMode.dark ? 'dark' : (mode == ThemeMode.light ? 'light' : 'auto');

  static ThemeMode modeFrom(String? value) {
    switch (value) {
      case 'dark':
        return ThemeMode.dark;
      case 'light':
        return ThemeMode.light;
      default:
        return ThemeMode.system;
    }
  }
}

class ThemeController extends StateNotifier<ThemeState> {
  ThemeController(this._preferences) : super(const ThemeState()) {
    _restore();
  }

  final SharedPreferences _preferences;

  static const String _modeKey = 'stracker.theme.mode';
  static const String _paletteKey = 'stracker.theme.palette';
  static const String _fontKey = 'stracker.theme.font';

  void _restore() {
    state = ThemeState(
      mode: ThemeState.modeFrom(_preferences.getString(_modeKey)),
      paletteId: _preferences.getString(_paletteKey) ?? 'default',
      readingFont: _preferences.getString(_fontKey) ?? 'lexend',
    );
  }

  /// Applies the saved account settings once they load (the account is the source of
  /// truth; the local values only make the first frame use the last known appearance).
  Future<void> syncFromSettings(AppSettings settings) async {
    final ThemeState next = ThemeState(
      mode: ThemeState.modeFrom(settings.theme),
      paletteId: settings.colorTheme,
      readingFont: settings.interfaceFont,
    );
    if (next.mode == state.mode &&
        next.paletteId == state.paletteId &&
        next.readingFont == state.readingFont) {
      return;
    }
    state = next;
    await _persist();
  }

  Future<void> setMode(ThemeMode mode) async {
    state = state.copyWith(mode: mode);
    await _persist();
  }

  Future<void> toggle(Brightness current) async {
    await setMode(current == Brightness.dark ? ThemeMode.light : ThemeMode.dark);
  }

  Future<void> setPalette(String paletteId) async {
    state = state.copyWith(paletteId: paletteId);
    await _persist();
  }

  Future<void> setReadingFont(String fontId) async {
    state = state.copyWith(readingFont: fontId);
    await _persist();
  }

  Future<void> _persist() async {
    try {
      await _preferences.setString(_modeKey, state.modeValue);
      await _preferences.setString(_paletteKey, state.paletteId);
      await _preferences.setString(_fontKey, state.readingFont);
    } catch (_) {
      // Preference writes are best-effort; the in-memory state is already applied.
    }
  }
}

final StateNotifierProvider<ThemeController, ThemeState> themeControllerProvider =
    StateNotifierProvider<ThemeController, ThemeState>((Ref ref) {
  throw UnimplementedError('themeControllerProvider is overridden in main()');
});
