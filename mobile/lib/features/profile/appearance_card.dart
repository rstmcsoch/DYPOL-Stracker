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
            minItemWidth: 150,
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
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: <Widget>[
              for (final ({String id, String label, String description}) option in strackerPaletteOptions)
                Tooltip(
                  message: option.description,
                  child: ChoiceChip(
                    label: Text(option.label),
                    selected: appearance.paletteId == option.id,
                    showCheckmark: false,
                    onSelected: (_) async {
                      await controller.setPalette(option.id);
                      if (context.mounted)
                        await _save(context, ref, (AppSettings s) => s.copyWith(colorTheme: option.id));
                    },
                  ),
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

/// Website theme card: a three-line paper swatch, title, description and a check when chosen.
class ThemeChoiceCard extends StatelessWidget {
  const ThemeChoiceCard({
    super.key,
    required this.mode,
    required this.title,
    required this.description,
    required this.selected,
    required this.onTap,
  });

  final ThemeMode mode;
  final String title;
  final String description;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final (Color paper, Color line) = switch (mode) {
      ThemeMode.dark => (const Color(0xFF1F2A26), const Color(0xFF3C4A44)),
      ThemeMode.light => (const Color(0xFFFFFBF2), const Color(0xFFE4D9C4)),
      ThemeMode.system => (colors.palette.paperSoft, colors.palette.line),
    };
    return Semantics(
      selected: selected,
      button: true,
      label: '$title. $description',
      excludeSemantics: true,
      child: Material(
        color: colors.palette.paperSoft,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: selected ? colors.palette.accentDark : colors.palette.line, width: selected ? 2 : 1),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  height: 34,
                  decoration: BoxDecoration(
                    color: paper,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: line),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: <Widget>[
                      for (int i = 0; i < 3; i++) Container(height: 1.5, color: line),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: <Widget>[
                    Expanded(child: Text(title, style: Theme.of(context).textTheme.titleSmall)),
                    if (selected) Icon(Icons.check_circle, size: 16, color: colors.palette.accentDark),
                  ],
                ),
                Text(description, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
