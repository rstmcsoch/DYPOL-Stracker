import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../date.dart';
import '../theme/app_theme.dart';

/// Labelled text field with inline error/helper text. The label sits above the field so the
/// input keeps its own hint space on small screens.
class AppField extends StatelessWidget {
  const AppField({
    super.key,
    required this.label,
    this.controller,
    this.hint,
    this.helper,
    this.error,
    this.required = false,
    this.keyboardType,
    this.textCapitalization = TextCapitalization.sentences,
    this.inputFormatters,
    this.obscure = false,
    this.maxLines = 1,
    this.maxLength,
    this.enabled = true,
    this.onChanged,
    this.prefix,
    this.suffix,
    this.autofillHints,
  });

  final String label;
  final TextEditingController? controller;
  final String? hint;
  final String? helper;
  final String? error;
  final bool required;
  final TextInputType? keyboardType;
  final TextCapitalization textCapitalization;
  final List<TextInputFormatter>? inputFormatters;
  final bool obscure;
  final int maxLines;
  final int? maxLength;
  final bool enabled;
  final ValueChanged<String>? onChanged;
  final IconData? prefix;
  final Widget? suffix;
  final Iterable<String>? autofillHints;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    // A password is typed exactly as it is stored. Android keyboards honour
    // `textCapitalization` and autocorrect, so the default (sentences + suggestions) would
    // turn "abcd@1234" into "Abcd@1234" and produce "Email or password is incorrect" for a
    // password that is perfectly correct. Obscured fields therefore never capitalise,
    // autocorrect or suggest.
    final TextCapitalization effectiveCaps =
        obscure ? TextCapitalization.none : textCapitalization;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Text(
                label,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(color: colors.palette.inkSoft),
              ),
              if (required)
                Text(' *', style: TextStyle(color: colors.palette.red, fontFamily: 'PatrickHand')),
            ],
          ),
          const SizedBox(height: 5),
          TextField(
            controller: controller,
            keyboardType: keyboardType,
            maxLines: obscure ? 1 : maxLines,
            minLines: 1,
            maxLength: maxLength,
            obscureText: obscure,
            enabled: enabled,
            inputFormatters: inputFormatters,
            onChanged: onChanged,
            textCapitalization: effectiveCaps,
            autocorrect: !obscure,
            enableSuggestions: !obscure,
            autofillHints: autofillHints,
            style: Theme.of(context).textTheme.bodyMedium,
            decoration: InputDecoration(
              hintText: hint,
              helperText: helper,
              helperMaxLines: 3,
              errorText: error,
              counterText: '',
              prefixIcon: prefix == null ? null : Icon(prefix, size: 18, color: colors.palette.muted),
              suffixIcon: suffix,
            ),
          ),
        ],
      ),
    );
  }
}

/// Dropdown with the same chrome as [AppField]. Uses `InputDecorator` + `DropdownButton`
/// so it behaves identically on every supported Flutter version.
class AppSelect<T> extends StatelessWidget {
  const AppSelect({
    super.key,
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
    this.labelFor,
    this.helper,
    this.error,
    this.enabled = true,
  });

  final String label;
  final T value;
  final List<T> items;
  final ValueChanged<T?> onChanged;
  final String Function(T value)? labelFor;
  final String? helper;
  final String? error;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final bool contains = items.contains(value);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(color: colors.palette.inkSoft),
          ),
          const SizedBox(height: 5),
          InputDecorator(
            decoration: InputDecoration(
              helperText: helper,
              errorText: error,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<T>(
                value: contains ? value : (items.isEmpty ? null : items.first),
                isExpanded: true,
                isDense: true,
                dropdownColor: colors.palette.paper,
                borderRadius: BorderRadius.circular(12),
                style: Theme.of(context).textTheme.bodyMedium,
                items: <DropdownMenuItem<T>>[
                  for (final T item in items)
                    DropdownMenuItem<T>(
                      value: item,
                      child: Text(
                        labelFor == null ? '$item' : labelFor!(item),
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                ],
                onChanged: enabled ? onChanged : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Date field storing `yyyy-MM-dd`, showing a friendly label and opening the platform date
/// picker. Clearing is explicit so a date is never lost by accident.
class AppDateField extends StatelessWidget {
  const AppDateField({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.helper,
    this.allowClear = false,
    this.firstDate,
    this.lastDate,
    this.error,
  });

  final String label;
  final String? value;
  final ValueChanged<String?> onChanged;
  final String? helper;
  final bool allowClear;
  final DateTime? firstDate;
  final DateTime? lastDate;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final DateTime initial = parseIsoOrToday(value);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(color: colors.palette.inkSoft),
          ),
          const SizedBox(height: 5),
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () async {
              final DateTime? picked = await showDatePicker(
                context: context,
                initialDate: initial,
                firstDate: firstDate ?? DateTime(2020),
                lastDate: lastDate ?? DateTime(2100),
                helpText: label,
              );
              if (picked != null) onChanged(isoDate(picked));
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
              decoration: BoxDecoration(
                color: colors.palette.paperSoft,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: error == null ? colors.palette.line : colors.palette.red),
              ),
              child: Row(
                children: <Widget>[
                  Icon(Icons.calendar_today_outlined, size: 16, color: colors.palette.muted),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Text(
                      value == null || value!.isEmpty ? 'Not set' : formatDate(value),
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: value == null || value!.isEmpty ? colors.muted : null,
                          ),
                    ),
                  ),
                  if (allowClear && value != null && value!.isNotEmpty)
                    InkWell(
                      onTap: () => onChanged(null),
                      child: Icon(Icons.close, size: 17, color: colors.palette.muted),
                    )
                  else
                    Icon(Icons.expand_more, size: 18, color: colors.palette.muted),
                ],
              ),
            ),
          ),
          if (helper != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                helper!,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
              ),
            ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                error!,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.palette.red),
              ),
            ),
        ],
      ),
    );
  }
}

class SwitchRow extends StatelessWidget {
  const SwitchRow({
    super.key,
    required this.title,
    required this.value,
    required this.onChanged,
    this.subtitle,
  });

  final String title;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onChanged(!value),
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title, style: Theme.of(context).textTheme.titleSmall),
                  if (subtitle != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        subtitle!,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: context.stracker.muted,
                            ),
                      ),
                    ),
                ],
              ),
            ),
            Switch(value: value, onChanged: onChanged),
          ],
        ),
      ),
    );
  }
}

/// Horizontal set of mutually exclusive chips. Wraps on narrow screens.
class ChoiceRow<T> extends StatelessWidget {
  const ChoiceRow({
    super.key,
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    this.labelFor,
  });

  final String label;
  final T value;
  final List<T> options;
  final ValueChanged<T> onChanged;
  final String Function(T value)? labelFor;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(color: colors.palette.inkSoft),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: <Widget>[
              for (final T option in options)
                ChoiceChip(
                  label: Text(labelFor == null ? '$option' : labelFor!(option)),
                  selected: option == value,
                  showCheckmark: false,
                  onSelected: (_) => onChanged(option),
                  labelStyle: TextStyle(
                    fontFamily: 'Lexend',
                    fontSize: 12,
                    color: option == value
                        ? colors.palette.textAccent
                        : colors.palette.inkSoft,
                  ),
                  backgroundColor: colors.palette.paperSoft,
                  selectedColor: colors.palette.accentLight,
                  side: BorderSide(
                    color: option == value ? colors.palette.accent : colors.palette.line,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class SearchBox extends StatelessWidget {
  const SearchBox({
    super.key,
    required this.controller,
    required this.hint,
    this.onChanged,
  });

  final TextEditingController controller;
  final String hint;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return TextField(
      controller: controller,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      style: Theme.of(context).textTheme.bodyMedium,
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: Icon(Icons.search, size: 19, color: colors.palette.muted),
        suffixIcon: ValueListenableBuilder<TextEditingValue>(
          valueListenable: controller,
          builder: (BuildContext context, TextEditingValue value, Widget? child) {
            if (value.text.isEmpty) return const SizedBox.shrink();
            return IconButton(
              tooltip: 'Clear',
              icon: const Icon(Icons.close, size: 17),
              onPressed: () {
                controller.clear();
                onChanged?.call('');
              },
            );
          },
        ),
      ),
    );
  }
}
