import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'palettes.dart';

/// Thin [ThemeExtension] so widgets can read the Stracker palette tokens that
/// Material's ColorScheme has no slot for (paper tones, subject hues, chart grid).
@immutable
class StrackerColors extends ThemeExtension<StrackerColors> {
  const StrackerColors(this.palette);

  final StrackerPalette palette;

  Color subjectColor(String subject) {
    switch (subject.toLowerCase()) {
      case 'physics':
        return palette.physics;
      case 'chemistry':
        return palette.chemistry;
      case 'maths':
      case 'mathematics':
        return palette.maths;
      default:
        return palette.accent;
    }
  }

  /// Short aliases for the surfaces used most often in screens.
  Color get ink => palette.ink;
  Color get inkSoft => palette.inkSoft;
  Color get muted => palette.muted;
  Color get line => palette.line;
  Color get accent => palette.accent;

  Color subjectSurface(String subject) {
    switch (subject.toLowerCase()) {
      case 'physics':
        return palette.physicsBg;
      case 'chemistry':
        return palette.chemistryBg;
      case 'maths':
      case 'mathematics':
        return palette.mathsBg;
      default:
        return palette.accentLight;
    }
  }

  @override
  StrackerColors copyWith({StrackerPalette? palette}) =>
      StrackerColors(palette ?? this.palette);

  @override
  StrackerColors lerp(ThemeExtension<StrackerColors>? other, double t) {
    if (other is! StrackerColors) return this;
    return StrackerColors(
      StrackerPalette(
        bg: Color.lerp(palette.bg, other.palette.bg, t)!,
        paper: Color.lerp(palette.paper, other.palette.paper, t)!,
        paperSoft: Color.lerp(palette.paperSoft, other.palette.paperSoft, t)!,
        paperMuted: Color.lerp(palette.paperMuted, other.palette.paperMuted, t)!,
        ink: Color.lerp(palette.ink, other.palette.ink, t)!,
        inkSoft: Color.lerp(palette.inkSoft, other.palette.inkSoft, t)!,
        muted: Color.lerp(palette.muted, other.palette.muted, t)!,
        line: Color.lerp(palette.line, other.palette.line, t)!,
        lineStrong: Color.lerp(palette.lineStrong, other.palette.lineStrong, t)!,
        accent: Color.lerp(palette.accent, other.palette.accent, t)!,
        accentDark: Color.lerp(palette.accentDark, other.palette.accentDark, t)!,
        accentLight: Color.lerp(palette.accentLight, other.palette.accentLight, t)!,
        textMuted: Color.lerp(palette.textMuted, other.palette.textMuted, t)!,
        textAccent: Color.lerp(palette.textAccent, other.palette.textAccent, t)!,
        physics: Color.lerp(palette.physics, other.palette.physics, t)!,
        chemistry: Color.lerp(palette.chemistry, other.palette.chemistry, t)!,
        maths: Color.lerp(palette.maths, other.palette.maths, t)!,
        physicsBg: Color.lerp(palette.physicsBg, other.palette.physicsBg, t)!,
        chemistryBg: Color.lerp(palette.chemistryBg, other.palette.chemistryBg, t)!,
        mathsBg: Color.lerp(palette.mathsBg, other.palette.mathsBg, t)!,
        red: Color.lerp(palette.red, other.palette.red, t)!,
        redBg: Color.lerp(palette.redBg, other.palette.redBg, t)!,
        green: Color.lerp(palette.green, other.palette.green, t)!,
        greenBg: Color.lerp(palette.greenBg, other.palette.greenBg, t)!,
        orange: Color.lerp(palette.orange, other.palette.orange, t)!,
        orangeBg: Color.lerp(palette.orangeBg, other.palette.orangeBg, t)!,
        blueBg: Color.lerp(palette.blueBg, other.palette.blueBg, t)!,
        yellowBg: Color.lerp(palette.yellowBg, other.palette.yellowBg, t)!,
        chartGrid: Color.lerp(palette.chartGrid, other.palette.chartGrid, t)!,
        ringTrack: Color.lerp(palette.ringTrack, other.palette.ringTrack, t)!,
        focusAccent: Color.lerp(palette.focusAccent, other.palette.focusAccent, t)!,
      ),
    );
  }
}

extension StrackerThemeX on BuildContext {
  StrackerColors get stracker =>
      Theme.of(this).extension<StrackerColors>() ??
      const StrackerColors(StrackerPalette(
        bg: Color(0xFFF7F4EC),
        paper: Color(0xFFFFFDF7),
        paperSoft: Color(0xFFFCFAF3),
        paperMuted: Color(0xFFF1EEE4),
        ink: Color(0xFF29332D),
        inkSoft: Color(0xFF566057),
        muted: Color(0xFF6B6C62),
        line: Color(0xFFE8E2D4),
        lineStrong: Color(0xFFD5CDBB),
        accent: Color(0xFF526C9A),
        accentDark: Color(0xFF415982),
        accentLight: Color(0xFFE8EDF5),
        textMuted: Color(0xFF5F655C),
        textAccent: Color(0xFF415982),
        physics: Color(0xFF3F639B),
        chemistry: Color(0xFF40694E),
        maths: Color(0xFF8F5620),
        physicsBg: Color(0xFFE8EEF7),
        chemistryBg: Color(0xFFE9F1E8),
        mathsBg: Color(0xFFF7EDDF),
        red: Color(0xFFA03F38),
        redBg: Color(0xFFF8E9E5),
        green: Color(0xFF3D6A47),
        greenBg: Color(0xFFE6F0E6),
        orange: Color(0xFF8F5620),
        orangeBg: Color(0xFFF8EDDD),
        blueBg: Color(0xFFE8EEF7),
        yellowBg: Color(0xFFFBF2CE),
        chartGrid: Color(0xFFDBD3BF),
        ringTrack: Color(0xFFD8D1BD),
        focusAccent: Color(0xFFDFC47E),
      ));

  TextTheme get text => Theme.of(this).textTheme;
}

/// Reading-font choices, mirroring Settings → Appearance → Reading font.
const Map<String, String> readingFontFamily = <String, String>{
  'default': 'Lexend',
  'lexend': 'Lexend',
  'poppins': 'Poppins',
  'sora': 'Sora',
  'open-sans': 'OpenSans',
};

const List<({String id, String label})> readingFontOptions = [
  (id: 'lexend', label: 'Lexend (default)'),
  (id: 'poppins', label: 'Poppins'),
  (id: 'sora', label: 'Sora'),
  (id: 'open-sans', label: 'Open Sans'),
];

String readingFamily(String id) => readingFontFamily[id] ?? 'Lexend';

/// Builds the app theme from a palette plus the signed-in reading font.
ThemeData buildStrackerTheme({
  required StrackerPalette palette,
  required Brightness brightness,
  String readingFont = 'lexend',
}) {
  final bool dark = brightness == Brightness.dark;
  final String body = readingFamily(readingFont);
  final ColorScheme scheme = ColorScheme(
    brightness: brightness,
    primary: dark ? palette.accent : palette.accentDark,
    onPrimary: dark ? palette.bg : Colors.white,
    secondary: palette.accent,
    onSecondary: dark ? palette.bg : Colors.white,
    error: palette.red,
    onError: Colors.white,
    surface: palette.paper,
    onSurface: palette.ink,
    surfaceContainerHighest: palette.paperMuted,
    outline: palette.lineStrong,
  );

  TextStyle bodyStyle(double size, FontWeight weight, {double? height}) => TextStyle(
        fontFamily: body,
        fontSize: size,
        fontWeight: weight,
        height: height,
        color: palette.ink,
        letterSpacing: 0.05,
      );

  final TextTheme textTheme = TextTheme(
    displayLarge: bodyStyle(34, FontWeight.w700),
    displayMedium: bodyStyle(28, FontWeight.w700),
    headlineLarge: TextStyle(fontFamily: 'PatrickHand', fontSize: 30, color: palette.ink, height: 1.15),
    headlineMedium: TextStyle(fontFamily: 'PatrickHand', fontSize: 25, color: palette.ink, height: 1.15),
    headlineSmall: TextStyle(fontFamily: 'PatrickHand', fontSize: 21, color: palette.ink, height: 1.2),
    titleLarge: bodyStyle(18, FontWeight.w600),
    titleMedium: bodyStyle(15.5, FontWeight.w600),
    titleSmall: bodyStyle(13.5, FontWeight.w600),
    bodyLarge: bodyStyle(15, FontWeight.w400, height: 1.45),
    bodyMedium: bodyStyle(13.8, FontWeight.w400, height: 1.45),
    bodySmall: bodyStyle(12.4, FontWeight.w400, height: 1.4),
    labelLarge: TextStyle(fontFamily: 'PatrickHand', fontSize: 16, color: palette.ink),
    labelMedium: TextStyle(fontFamily: 'PatrickHand', fontSize: 14, color: palette.inkSoft),
    labelSmall: bodyStyle(11.5, FontWeight.w500),
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: palette.bg,
    canvasColor: palette.bg,
    dividerColor: palette.line,
    fontFamily: body,
    textTheme: textTheme,
    // Press and hover feedback is an accent wash mixed from the notebook's own ink. The
    // Material defaults (white at 8–12% over a dark surface, InkSparkle's shader) read as a
    // pale grey rectangle on large surfaces such as the chat list or a table row.
    splashColor: palette.accent.withValues(alpha: 0.10),
    highlightColor: palette.accent.withValues(alpha: 0.06),
    hoverColor: palette.accent.withValues(alpha: 0.06),
    focusColor: palette.accent.withValues(alpha: 0.10),
    splashFactory: InkRipple.splashFactory,
    extensions: <ThemeExtension<dynamic>>[StrackerColors(palette)],
    appBarTheme: AppBarTheme(
      backgroundColor: palette.bg,
      foregroundColor: palette.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontFamily: 'PatrickHand', fontSize: 23, color: palette.ink),
      // Pin the system bars to the notebook colour so the OS never draws its own
      // translucent chips over the app bar (that is the "floating grey box").
      systemOverlayStyle: SystemUiOverlayStyle(
        // Painted with the page colour, so the system strip reads as part of the app.
        statusBarColor: palette.bg,
        statusBarIconBrightness: dark ? Brightness.light : Brightness.dark,
        statusBarBrightness: dark ? Brightness.dark : Brightness.light,
        systemNavigationBarColor: palette.bg,
        systemNavigationBarIconBrightness: dark ? Brightness.light : Brightness.dark,
        systemNavigationBarDividerColor: Colors.transparent,
      ),
    ),
    // Tooltips styled as part of the notebook instead of Material's grey rectangle.
    tooltipTheme: TooltipThemeData(
      waitDuration: const Duration(milliseconds: 650),
      showDuration: const Duration(seconds: 2),
      decoration: BoxDecoration(
        color: palette.ink,
        borderRadius: BorderRadius.circular(8),
      ),
      textStyle: TextStyle(fontFamily: body, fontSize: 12, color: palette.bg),
    ),
    // Android 14+ predictive back: the page follows the back swipe and reveals the one
    // below, and can be cancelled mid-gesture. Older Android versions and button presses
    // get the platform's fade-forwards transition. (The Cupertino builder lives in
    // package:flutter/cupertino.dart and is not needed by an Android-only app.)
    pageTransitionsTheme: PageTransitionsTheme(
      builders: <TargetPlatform, PageTransitionsBuilder>{
        TargetPlatform.android: PredictiveBackPageTransitionsBuilder(fallbackColor: palette.bg),
        TargetPlatform.fuchsia: const ZoomPageTransitionsBuilder(),
        TargetPlatform.iOS: const ZoomPageTransitionsBuilder(),
        TargetPlatform.macOS: const ZoomPageTransitionsBuilder(),
        TargetPlatform.windows: const ZoomPageTransitionsBuilder(),
        TargetPlatform.linux: const ZoomPageTransitionsBuilder(),
      },
    ),
    cardTheme: CardThemeData(
      color: palette.paper,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: palette.line),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: palette.paperSoft,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      hintStyle: TextStyle(color: palette.muted, fontFamily: body),
      labelStyle: TextStyle(color: palette.inkSoft, fontFamily: body),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: palette.lineStrong),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: palette.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: palette.accent, width: 1.6),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: palette.red),
      ),
      errorStyle: TextStyle(color: palette.red, fontFamily: body, fontSize: 12),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: dark ? palette.accent : palette.accentDark,
        foregroundColor: dark ? palette.bg : Colors.white,
        elevation: 0,
        minimumSize: const Size(0, 46),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        textStyle: TextStyle(fontFamily: 'PatrickHand', fontSize: 17),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: palette.ink,
        minimumSize: const Size(0, 44),
        side: BorderSide(color: palette.lineStrong),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        textStyle: TextStyle(fontFamily: 'PatrickHand', fontSize: 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: palette.accentDark,
        textStyle: TextStyle(fontFamily: 'PatrickHand', fontSize: 15.5),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: palette.paperSoft,
      selectedColor: palette.accentLight,
      side: BorderSide(color: palette.line),
      labelStyle: bodyStyle(12.5, FontWeight.w500),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: palette.paper,
      surfaceTintColor: Colors.transparent,
      indicatorColor: palette.accentLight,
      elevation: 0,
      height: 66,
      labelTextStyle: WidgetStatePropertyAll<TextStyle>(
        TextStyle(fontFamily: 'PatrickHand', fontSize: 12.5, color: palette.inkSoft),
      ),
      iconTheme: WidgetStatePropertyAll<IconThemeData>(IconThemeData(color: palette.inkSoft, size: 22)),
    ),
    drawerTheme: DrawerThemeData(backgroundColor: palette.paper, surfaceTintColor: Colors.transparent),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: palette.paper,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: palette.paper,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: palette.ink,
      contentTextStyle: TextStyle(fontFamily: body, color: palette.bg, fontSize: 13.5),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: palette.accent,
      linearTrackColor: palette.ringTrack,
      circularTrackColor: palette.ringTrack,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) =>
          states.contains(WidgetState.selected) ? palette.accent : palette.paper),
      trackColor: WidgetStateProperty.resolveWith((states) =>
          states.contains(WidgetState.selected) ? palette.accentLight : palette.paperMuted),
    ),
    listTileTheme: ListTileThemeData(iconColor: palette.inkSoft, textColor: palette.ink),
  );
}
