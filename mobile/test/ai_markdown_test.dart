import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stracker/core/theme/app_theme.dart';
import 'package:stracker/core/theme/palettes.dart';
import 'package:stracker/features/ai/ai_markdown.dart';

Widget host(Widget child) => MaterialApp(
      theme: buildStrackerTheme(palette: strackerPalettes['default']!['light']!, brightness: Brightness.light),
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

String? copied;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    copied = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (MethodCall call) async {
        if (call.method == 'Clipboard.setData') copied = (call.arguments as Map<Object?, Object?>)['text'] as String?;
        return null;
      },
    );
  });

  testWidgets('AI answers render markdown, tables and a code panel', (WidgetTester tester) async {
    await tester.pumpWidget(host(const AiMarkdown(
      text: '## Plan\n\n**Revise** optics\n\n| Topic | Weight |\n| --- | --- |\n| Optics | 12% |\n\n```python\nprint(1)\n```',
    )));
    expect(tester.takeException(), isNull);
    expect(find.textContaining('**'), findsNothing);
    expect(find.byType(Table), findsOneWidget);
    expect(find.text('python'), findsOneWidget);
    await tester.tap(find.byTooltip('Copy python'));
    await tester.pump();
    expect(copied, 'print(1)');
  });

  testWidgets('the copy button copies the raw message', (WidgetTester tester) async {
    await tester.pumpWidget(host(const ChatCopyButton(text: '**raw** text', label: 'Copy response')));
    await tester.tap(find.byTooltip('Copy response'));
    await tester.pump();
    expect(copied, '**raw** text');
    expect(find.text('Copied'), findsOneWidget);
  });
}
