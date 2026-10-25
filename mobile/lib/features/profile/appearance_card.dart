import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/palettes.dart';
import '../../core/theme/theme_controller.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/fields.dart';
import '../../core/widgets/notebook.dart';
import '../../data/data_controller.dart';
import '../../data/models.dart';

/// The one place the notebook's look is chosen (Profile): theme (Warm paper, Chalkboard or
/// Auto), colour palette and reading font, the same three choices as Settings → Appearance
/// on the website. Each choice applies at once and is saved to the account, so the
/// website and other devices open with the same look. There is no quick toggle elsewhere.
class AppearanceCard extends ConsumerWidget {
  const AppearanceCard({super.key});

  Future<void> _save(BuildContext context, WidgetRef ref, AppSettings Function(AppSettings) change) async {
    final AppSettings latest = ref.read(dataControllerProvider).data.settings;
    try {
      await ref.read(dataControllerProvider.notifier).saveSettings(change(latest));
    } catch (_) {
      // Already applied on this phone; the account copy is retried with the next save.
      if (context.mounted) showToast(context, 'Applied here, but not saved to your account yet.', error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ThemeState appearance = ref.watch(themeControllerProvider);
    final ThemeController controller = ref.read(themeControllerProvider.notifier);
    final StrackerColors colors = context.stracker;
    return NotebookCard(
      title: 'Appearance',
      subtitle: 'Shared with Settings → Appearance on the website.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text('Notebook theme', style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: 6),
          WrapGrid(
            minItemWidth: 96,
            children: <Widget>[
              for (final (ThemeMode mode, String title, String desc) in const <(ThemeMode, String, String)>[
                (ThemeMode.light, 'Warm paper', 'Light notebook paper'),
                (ThemeMode.dark, 'Chalkboard', 'Dark, high-contrast study mode'),
                (ThemeMode.system, 'Auto', 'Follow your device setting'),
              ])
                ThemeChoiceCard(
                  mode: mode,
                  title: title,
                  description: desc,
                  selected: appearance.mode == mode,
                  paletteId: appearance.paletteId,
                  onTap: () async {
                    unawaited(HapticFeedback.selectionClick());
                    await controller.setMode(mode);
                    final String stored = ref.read(themeControllerProvider).modeValue;
                    if (context.mounted) await _save(context, ref, (AppSettings s) => s.copyWith(theme: stored));
                  },
                ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6, bottom: 8),
            child: Text(
              appearance.mode == ThemeMode.system
                  ? 'Auto theme follows the device appearance.'
                  : 'Applied now and saved to your account.',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
            ),
          ),
          Text('Color theme', style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: 6),
          // Small cards in a grid, each previewing the palette's page, surface and accent.
          WrapGrid(
            minItemWidth: 96,
            children: <Widget>[
              for (final ({String id, String label, String description}) option in strackerPaletteOptions)
                PaletteChoiceCard(
                  key: ValueKey<String>('palette-${option.id}'),
                  id: option.id,
                  label: option.label,
                  description: option.description,
                  selected: appearance.paletteId == option.id,
                  onTap: () async {
                    unawaited(HapticFeedback.selectionClick());
                    await controller.setPalette(option.id);
                    if (context.mounted) await _save(context, ref, (AppSettings s) => s.copyWith(colorTheme: option.id));
                  },
                ),
            ],
          ),
          const SizedBox(height: 10),
          AppSelect<String>(
            label: 'Reading font',
            value: appearance.readingFont,
            items: const <String>['lexend', 'poppins', 'sora', 'open-sans'],
            labelFor: (String value) => switch (value) {
              'poppins' => 'Poppins',
              'sora' => 'Sora',
              'open-sans' => 'Open Sans',
              _ => 'Lexend (default)',
            },
            helper: 'Patrick Hand stays for headings — it is the Stracker identity.',
            onChanged: (String? value) async {
              if (value == null) return;
              await controller.setReadingFont(value);
              if (context.mounted) await _save(context, ref, (AppSettings s) => s.copyWith(interfaceFont: value));
            },
          ),
        ],
      ),
    );
  }
}

/// Background, surface and accent of a palette in the given brightness, for previews.
(Color, Color, Color) paletteSwatches(String id, Brightness brightness) {
  final Map<String, StrackerPalette> variants = strackerPalettes[id] ?? strackerPalettes['default']!;
  final StrackerPalette palette = variants[brightness == Brightness.dark ? 'dark' : 'light'] ?? variants.values.first;
  return (palette.bg, palette.paper, palette.accent);
}

/// A row of colour swatches with a hairline border, used by both kinds of theme card.
class _Swatches extends StatelessWidget {
  const _Swatches(this.colors);

  final List<Color> colors;

  @override
  Widget build(BuildContext context) {
    final Color border = context.stracker.palette.line;
    return ClipRRect(
      borderRadius: BorderRadius.circular(7),
      child: DecoratedBox(
        position: DecorationPosition.foreground,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(7),
          border: Border.all(color: border),
        ),
        child: SizedBox(
          height: 24,
          child: Row(
            children: <Widget>[
              for (final Color color in colors) Expanded(child: ColoredBox(color: color)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shared compact card: preview, name and a clear selected state (accent border, tint, tick).
class _ChoiceTile extends StatelessWidget {
  const _ChoiceTile({
    required this.label,
    required this.semantics,
    required this.preview,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String semantics;
  final Widget preview;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Semantics(
      selected: selected,
      button: true,
      label: semantics,
      excludeSemantics: true,
      child: Tooltip(
        message: semantics,
        excludeFromSemantics: true,
        child: Material(
          color: selected ? colors.palette.accentLight.withValues(alpha: 0.35) : colors.palette.paperSoft,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color: selected ? colors.palette.accentDark : colors.palette.line,
              width: selected ? 2 : 1,
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 8, 7),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  preview,
                  const SizedBox(height: 6),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                              ),
                        ),
                      ),
                      if (selected) Icon(Icons.check_circle, size: 14, color: colors.palette.accentDark),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Colour theme card: swatches of the palette's background, surface and accent plus its name.
class PaletteChoiceCard extends StatelessWidget {
  const PaletteChoiceCard({
    super.key,
    required this.id,
    required this.label,
    required this.description,
    required this.selected,
    required this.onTap,
  });

  final String id;
  final String label;
  final String description;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (Color bg, Color surface, Color accent) = paletteSwatches(id, Theme.of(context).brightness);
    return _ChoiceTile(
      label: label,
      semantics: '$label. $description',
      preview: _Swatches(<Color>[bg, surface, accent]),
      selected: selected,
      onTap: onTap,
    );
  }
}

/// Notebook theme card (Warm paper, Chalkboard or Auto): a compact preview and the name.
class ThemeChoiceCard extends StatelessWidget {
  const ThemeChoiceCard({
    super.key,
    required this.mode,
    required this.title,
    required this.description,
    required this.selected,
    required this.onTap,
    this.paletteId = 'default',
  });

  final ThemeMode mode;
  /// The chosen colour theme, so the preview shows its paper and chalkboard variants.
  final String paletteId;
  final String title;
  final String description;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (Color lightBg, Color lightSurface, Color lightAccent) = paletteSwatches(paletteId, Brightness.light);
    final (Color darkBg, Color darkSurface, Color darkAccent) = paletteSwatches(paletteId, Brightness.dark);
    final List<Color> preview = switch (mode) {
      ThemeMode.light => <Color>[lightBg, lightSurface, lightAccent],
      ThemeMode.dark => <Color>[darkBg, darkSurface, darkAccent],
      // Auto: half paper, half chalkboard.
      ThemeMode.system => <Color>[lightSurface, lightAccent, darkAccent, darkSurface],
    };
    return _ChoiceTile(
      label: title,
      semantics: '$title. $description',
      preview: _Swatches(preview),
      selected: selected,
      onTap: onTap,
    );
  }
}
