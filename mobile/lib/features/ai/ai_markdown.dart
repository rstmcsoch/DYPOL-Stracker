import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as md;

import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';

/// Copies [text] exactly as written and confirms with a toast.
Future<void> copyChatText(BuildContext context, String text) async {
  await Clipboard.setData(ClipboardData(text: text));
  if (context.mounted) showToast(context, 'Copied');
}

/// Renders an AI answer as GitHub-flavoured Markdown: headings, emphasis, lists, task lists,
/// horizontally scrollable tables, quotes, rules and code panels with a copy button.
/// Raw HTML is never interpreted and links are not opened from inside the chat.
class AiMarkdown extends StatelessWidget {
  const AiMarkdown({super.key, required this.text, this.color});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final ThemeData theme = Theme.of(context);
    final TextStyle base = (theme.textTheme.bodyMedium ?? const TextStyle()).copyWith(color: color);
    final double size = (base.fontSize ?? 14) * 0.9;
    final TextStyle body = base.copyWith(fontSize: size, height: 1.45);
    final TextStyle heading = body.copyWith(fontWeight: FontWeight.w700, height: 1.3);
    return MarkdownBody(
      data: text,
      selectable: true,
      extensionSet: md.ExtensionSet.gitHubFlavored,
      builders: <String, MarkdownElementBuilder>{'pre': _CodePanelBuilder(colors, size)},
      styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
        p: body,
        listBullet: body,
        tableBody: body,
        tableHead: body.copyWith(fontWeight: FontWeight.w700),
        h1: heading.copyWith(fontSize: size * 1.3),
        h2: heading.copyWith(fontSize: size * 1.2),
        h3: heading.copyWith(fontSize: size * 1.1),
        h4: heading,
        h5: heading,
        h6: heading,
        strong: const TextStyle(fontWeight: FontWeight.w700),
        a: body.copyWith(color: colors.accent, decoration: TextDecoration.underline),
        code: body.copyWith(
          fontFamily: 'monospace',
          fontSize: size * 0.9,
          backgroundColor: colors.palette.paperMuted,
        ),
        blockquote: body.copyWith(color: colors.inkSoft),
        blockquoteDecoration: BoxDecoration(
          border: Border(left: BorderSide(color: colors.palette.lineStrong, width: 3)),
        ),
        blockquotePadding: const EdgeInsets.only(left: 10, top: 2, bottom: 2),
        horizontalRuleDecoration: BoxDecoration(
          border: Border(top: BorderSide(color: colors.line)),
        ),
        tableBorder: TableBorder.all(color: colors.line),
        tableColumnWidth: const IntrinsicColumnWidth(),
        tableCellsPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        tableHeadAlign: TextAlign.left,
      ),
    );
  }
}

class _CodePanelBuilder extends MarkdownElementBuilder {
  _CodePanelBuilder(this.colors, this.size);

  final StrackerColors colors;
  final double size;

  @override
  bool isBlockElement() => true;

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    final String code = element.textContent.replaceFirst(RegExp(r'\n$'), '');
    String language = 'code';
    final List<md.Node>? children = element.children;
    if (children != null && children.isNotEmpty && children.first is md.Element) {
      final String? cls = (children.first as md.Element).attributes['class'];
      if (cls != null && cls.startsWith('language-')) language = cls.substring(9);
    }
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: colors.palette.paperMuted,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: colors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Container(
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
              color: colors.palette.paperSoft,
              border: Border(bottom: BorderSide(color: colors.line)),
            ),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    language,
                    style: TextStyle(fontSize: size * 0.8, color: colors.muted, fontWeight: FontWeight.w600),
                  ),
                ),
                IconButton(
                  tooltip: 'Copy $language',
                  visualDensity: VisualDensity.compact,
                  iconSize: 16,
                  icon: Icon(Icons.copy_rounded, color: colors.muted),
                  onPressed: () => copyChatText(context, code),
                ),
              ],
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.all(10),
            child: SelectableText(
              code,
              style: TextStyle(fontFamily: 'monospace', fontSize: size * 0.85, color: colors.ink, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}

/// Small copy action shown under each chat message.
class ChatCopyButton extends StatelessWidget {
  const ChatCopyButton({super.key, required this.text, required this.label});

  final String text;
  final String label;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: label,
      visualDensity: VisualDensity.compact,
      iconSize: 15,
      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
      padding: EdgeInsets.zero,
      icon: Icon(Icons.copy_rounded, color: context.stracker.muted),
      onPressed: () => copyChatText(context, text),
    );
  }
}
