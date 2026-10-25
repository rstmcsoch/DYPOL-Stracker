import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/dialogs.dart';
import '../../core/widgets/notebook.dart';
import '../../data/ai_client.dart';
import '../../data/models.dart';
import '../shell/app_shell.dart';
import 'ai_markdown.dart';
import '../../core/widgets/wandering_eyes.dart';

/// Stracker AI. Talks only to the deployed `/api/ai/*` functions with the user's own
/// Supabase token; provider keys live server-side. Streams the same SSE events the website
/// consumes, and stops a running task through the tasks endpoint.
class AiChatPage extends ConsumerStatefulWidget {
  const AiChatPage({super.key});

  @override
  ConsumerState<AiChatPage> createState() => _AiChatPageState();
}

class _ChatBubble {
  _ChatBubble(
      {required this.id, required this.text, required this.isUser, this.streaming = false, this.failed = false});

  final String id;
  String text;
  final bool isUser;
  bool streaming;
  bool failed;
}

class _AiChatPageState extends ConsumerState<AiChatPage> {
  final AiClient _client = AiClient();
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final List<_ChatBubble> _messages = <_ChatBubble>[];

  String? _conversationId;
  String? _requestId;
  String? _pageContext = 'home';
  bool _sending = false;
  String? _error;
  String? _status;
  AiHealth? _health;
  AiProviderList? _models;
  bool _strackerFailed = false;
  List<AiConversation> _conversations = <AiConversation>[];

  @override
  void initState() {
    super.initState();
    _checkHealth();
    _loadModels();
    _loadConversations();
  }

  /// Which models the student can use: Stracker AI (Default) first, then their own.
  Future<void> _loadModels() async {
    try {
      final AiProviderList models = await _client.providerList();
      if (!mounted) return;
      setState(() {
        _models = models;
        if (models.stracker?.ready ?? false) _strackerFailed = false;
      });
    } catch (_) {
      // The chat still works; the strip simply stays hidden until the next load.
    }
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    _client.close();
    super.dispose();
  }

  Future<void> _checkHealth() async {
    try {
      final AiHealth health = await _client.health();
      if (!mounted) return;
      setState(() => _health = health);
    } catch (_) {
      if (!mounted) return;
      setState(() => _health = const AiHealth(configured: false, reason: 'unreachable'));
    }
  }

  Future<void> _loadConversations() async {
    try {
      final List<AiConversation> rows = await _client.conversations();
      if (!mounted) return;
      setState(() => _conversations = rows);
    } catch (_) {
      // History is optional; a failure here must not block a new chat.
    }
  }

  Future<void> _openConversation(AiConversation conversation) async {
    setState(() {
      _error = null;
    });
    try {
      final AiConversationDetail detail = await _client.conversation(conversation.id);
      if (!mounted) return;
      setState(() {
        _conversationId = detail.conversation.id;
        _messages
          ..clear()
          ..addAll(<_ChatBubble>[
            for (final AiMessage message in detail.messages)
              _ChatBubble(
                id: message.id,
                text: message.content,
                isUser: message.isUser,
                failed: message.status == 'failed',
              ),
          ]);
      });
      _scrollToEnd();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
      });
    }
  }

  void _newChat() {
    setState(() {
      _conversationId = null;
      _requestId = null;
      _messages.clear();
      _error = null;
      _status = null;
    });
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send() async {
    final String text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    final String requestId = newId();
    final String messageId = newId();
    final _ChatBubble reply = _ChatBubble(id: requestId, text: '', isUser: false, streaming: true);
    setState(() {
      _sending = true;
      _requestId = requestId;
      _error = null;
      _status = 'Thinking…';
      _messages.add(_ChatBubble(id: messageId, text: text, isUser: true));
      _messages.add(reply);
      _input.clear();
    });
    _scrollToEnd();

    try {
      final Stream<AiStreamEvent> stream = _client.chat(
        requestId: requestId,
        messageId: messageId,
        message: text,
        conversationId: _conversationId,
        pageContext: _pageContext,
      );
      await for (final AiStreamEvent event in stream) {
        if (!mounted) return;
        switch (event.name) {
          case 'task':
            final String? conversation = event.data['conversationId']?.toString();
            if (conversation != null) setState(() => _conversationId = conversation);
          case 'status':
            setState(() => _status = event.data['progress']?.toString());
          case 'delta':
            reply.text += event.text;
            setState(() {});
            _scrollToEnd();
          case 'reset':
            reply.text = '';
            setState(() => _status = 'Retrying with another model…');
          case 'fallback':
            setState(() =>
                _status = '${event.data['from'] ?? 'Model'} unavailable — trying ${event.data['to'] ?? 'a fallback'}.');
          case 'confirmation':
            final Map<String, dynamic>? action = event.action;
            setState(() {
              _status = null;
              reply.streaming = false;
              if (action != null) {
                reply.text +=
                    '\n\nThis needs your confirmation: ${action['title'] ?? action['toolName'] ?? 'an action'}. '
                    'Open the website to review and approve it — the app does not confirm writes on your '
                    'behalf.';
              }
            });
            _scrollToEnd();
          case 'done':
            setState(() {
              _status = null;
              reply.streaming = false;
              if (event.data['content'] != null && '${event.data['content']}'.isNotEmpty) {
                reply.text = '${event.data['content']}';
              }
            });
            _scrollToEnd();
          case 'cancelled':
            setState(() {
              _status = null;
              reply.streaming = false;
              reply.text += '\n\n(Stopped.)';
            });
          case 'error':
            final bool strackerIssue = '${event.data['error'] ?? ''}'.startsWith('stracker_ai');
            setState(() {
              _status = null;
              reply.streaming = false;
              reply.failed = true;
              if (strackerIssue) _strackerFailed = true;
              _error = event.data['message']?.toString() ?? 'The assistant failed to answer.';
            });
            if (strackerIssue) unawaited(_loadModels());
        }
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        reply.failed = true;
        reply.text = reply.text.isEmpty
            ? 'The assistant could not answer. Check your connection and any AI provider configured in '
                'the website’s settings.'
            : reply.text;
        _error = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
          _status = null;
          reply.streaming = false;
        });
        _loadConversations();
      }
    }
  }

  Future<void> _stop() async {
    final String? requestId = _requestId;
    if (requestId == null) return;
    try {
      final bool stopped = await _client.stop(requestId);
      if (!mounted) return;
      showToast(
        context,
        stopped ? 'Stopping. The answer will finish where it is.' : 'That task had already finished.',
      );
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final AiHealth? health = _health;
    final bool configured = health?.configured ?? true;

    return NotebookScaffold(
      title: 'Stracker AI',
      showBack: true,
      floatingActions: false,
      scrollBehindHeader: false,
      actions: <Widget>[
        IconButton(
          tooltip: 'New chat',
          icon: const Icon(Icons.add_comment_outlined, size: 20),
          onPressed: _newChat,
        ),
        IconButton(
          tooltip: 'History',
          icon: const Icon(Icons.history, size: 21),
          onPressed: _showHistory,
        ),
        IconButton(
          tooltip: 'AI models',
          icon: const Icon(Icons.hub_outlined, size: 20),
          onPressed: _showProviders,
        ),
      ],
      body: Column(
        children: <Widget>[
          if (health != null && !configured)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
              child: InfoBanner(
                health.reason == 'unreachable'
                    ? 'The assistant could not be reached. Check your connection, then try again.'
                    : 'Stracker AI is not available on this server right now. Try again in a moment.',
                tone: PillTone.warn,
                icon: Icons.smart_toy_outlined,
              ),
            ),
          _ModelStrip(
            models: _models,
            strackerFailed: _strackerFailed,
            onAddOwn: _showProviders,
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
              child: ErrorNotice(_error!, onRetry: _checkHealth, retryLabel: 'Try again'),
            ),
          Expanded(
            child: _messages.isEmpty
                ? _EmptyChat(promptSelected: _sendPrompt)
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                    itemCount: _messages.length,
                    itemBuilder: (BuildContext context, int index) {
                      final _ChatBubble bubble = _messages[index];
                      final bool showCopy = bubble.text.trim().isNotEmpty && !bubble.streaming;
                      return Align(
                        alignment: bubble.isUser ? Alignment.centerRight : Alignment.centerLeft,
                        child: ConstrainedBox(
                          constraints: BoxConstraints(
                            maxWidth: MediaQuery.sizeOf(context).width * 0.82,
                          ),
                          child: Column(
                            crossAxisAlignment: bubble.isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                            children: <Widget>[
                              Container(
                                margin: EdgeInsets.only(bottom: showCopy ? 0 : 8),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: bubble.isUser ? colors.palette.accentLight : colors.palette.paper,
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(
                                    color: bubble.failed ? colors.palette.red : colors.palette.line,
                                  ),
                                ),
                                child: bubble.streaming && bubble.text.isEmpty
                                    ? Row(
                                        children: <Widget>[
                                          const WanderingEyes(height: 13, delay: Duration.zero),
                                          const SizedBox(width: 8),
                                          Text(
                                            _status ?? 'Thinking…',
                                            style: Theme.of(context).textTheme.labelSmall,
                                          ),
                                        ],
                                      )
                                    : bubble.isUser
                                        ? SelectableText(
                                            bubble.text,
                                            style: _chatTextStyle(context),
                                          )
                                        : AiMarkdown(
                                            text: bubble.text,
                                            color: bubble.failed ? colors.palette.red : null,
                                          ),
                              ),
                              if (showCopy)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 4),
                                  child: ChatCopyButton(
                                    text: bubble.text,
                                    label: bubble.isUser ? 'Copy your message' : 'Copy response',
                                  ),
                                ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
          Container(
            decoration: BoxDecoration(
              color: colors.palette.paper,
              border: Border(top: BorderSide(color: colors.palette.line)),
            ),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 8, 8, 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Expanded(
                      child: TextField(
                        controller: _input,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 4000,
                        textCapitalization: TextCapitalization.sentences,
                        inputFormatters: <TextInputFormatter>[
                          LengthLimitingTextInputFormatter(4000),
                        ],
                        decoration: InputDecoration(
                          hintText: 'Ask about your syllabus, tests, revisions…',
                          counterText: '',
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          suffixIcon: PopupMenuButton<String>(
                            tooltip: 'Page context',
                            icon: Icon(Icons.link, size: 17, color: colors.palette.muted),
                            initialValue: _pageContext,
                            onSelected: (String value) => setState(() => _pageContext = value),
                            itemBuilder: (BuildContext context) => const <PopupMenuEntry<String>>[
                              PopupMenuItem<String>(value: 'home', child: Text('Dashboard')),
                              PopupMenuItem<String>(value: 'syllabus', child: Text('Syllabus')),
                              PopupMenuItem<String>(value: 'tests', child: Text('Tests')),
                              PopupMenuItem<String>(value: 'mistakes', child: Text('Mistakes')),
                              PopupMenuItem<String>(value: 'retry', child: Text('Retry')),
                              PopupMenuItem<String>(value: 'planner', child: Text('Planner')),
                              PopupMenuItem<String>(value: 'revision', child: Text('Revision')),
                              PopupMenuItem<String>(value: 'analytics', child: Text('Analytics')),
                              PopupMenuItem<String>(value: 'weak-areas', child: Text('Weak areas')),
                              PopupMenuItem<String>(value: 'settings', child: Text('Settings')),
                              PopupMenuItem<String>(value: 'backup', child: Text('Backup')),
                              PopupMenuItem<String>(value: 'focus', child: Text('Focus')),
                            ],
                          ),
                        ),
                        onSubmitted: (_) => _send(),
                      ),
                    ),
                    const SizedBox(width: 6),
                    if (_sending)
                      IconButton.filled(
                        tooltip: 'Stop',
                        onPressed: _stop,
                        icon: const Icon(Icons.stop, size: 19),
                      )
                    else
                      IconButton.filled(
                        tooltip: 'Send',
                        onPressed: _send,
                        icon: const Icon(Icons.arrow_upward, size: 19),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _sendPrompt(String text) {
    _input.text = text;
    _send();
  }

  Future<void> _showHistory() async {
    await _loadConversations();
    if (!mounted) return;
    await showAppSheet<void>(
      context,
      title: 'Recent conversations',
      builder: (BuildContext sheetContext) => _conversations.isEmpty
          ? const EmptyState(
              title: 'No conversations yet',
              message: 'Ask something and it will appear here.',
              icon: Icons.chat_bubble_outline,
            )
          : Column(
              children: <Widget>[
                for (final AiConversation conversation in _conversations)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(
                      conversation.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      conversation.updatedAt,
                      style: Theme.of(sheetContext).textTheme.labelSmall,
                    ),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      _openConversation(conversation);
                    },
                    trailing: IconButton(
                      tooltip: 'Clear conversation',
                      icon: const Icon(Icons.delete_outline, size: 17),
                      onPressed: () async {
                        final bool confirmed = await confirmAction(
                          sheetContext,
                          title: 'Clear this conversation?',
                          message: 'The stored messages are deleted from your account.',
                        );
                        if (!confirmed) return;
                        try {
                          await _client.deleteConversation(conversation.id);
                          if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                          if (mounted) {
                            if (_conversationId == conversation.id) _newChat();
                            showToast(context, 'Conversation cleared.');
                            await _loadConversations();
                          }
                        } catch (error) {
                          if (mounted) showToast(context, error.toString(), error: true);
                        }
                      },
                    ),
                  ),
              ],
            ),
    );
  }

  Future<void> _showProviders() async {
    await showAppSheet<void>(
      context,
      title: 'AI models',
      builder: (BuildContext sheetContext) => _ProvidersBody(client: _client),
    );
    if (mounted) unawaited(_loadModels());
  }
}

/// Compact line under the title: which model answers, a small "Add your own model" button,
/// and the professional warning when Stracker AI (Default) is unavailable.
/// Chat text is 90% of body size; the empty state uses smaller variants, matching the web chat.
TextStyle? _scaled(TextStyle? style, double factor) => style?.copyWith(fontSize: (style.fontSize ?? 14) * factor);

TextStyle? _chatTextStyle(BuildContext context) => _scaled(Theme.of(context).textTheme.bodyMedium, 0.9);

class _ModelStrip extends StatelessWidget {
  const _ModelStrip({required this.models, required this.strackerFailed, required this.onAddOwn});

  final AiProviderList? models;
  final bool strackerFailed;
  final VoidCallback onAddOwn;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    final AiProviderList? list = models;
    if (list == null) return const SizedBox.shrink();
    final StrackerAiStatus? stracker = list.stracker;
    final bool strackerReady = (stracker?.ready ?? false) && !strackerFailed;
    final List<AiProvider> own = <AiProvider>[
      for (final AiProvider row in list.providers)
        if (row.isReady) row
    ];
    final AiProvider? ownPreferred =
        own.isEmpty ? null : own.firstWhere((AiProvider row) => row.isDefault, orElse: () => own.first);
    final bool useStracker = strackerReady && (!list.prefersOwn || ownPreferred == null);
    final String? using = useStracker
        ? '${StrackerAiStatus.label}${stracker?.model == null ? '' : ' · ${stracker!.model}'}'
        : ownPreferred == null
            ? null
            : '${ownPreferred.displayName} · ${ownPreferred.modelId}';
    final bool showWarning = stracker != null && !strackerReady;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  using == null ? 'Ask about your studies' : 'Using $using',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                ),
              ),
              TextButton.icon(
                onPressed: onAddOwn,
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                ),
                icon: const Icon(Icons.add, size: 15),
                label: const Text('Add your own model'),
              ),
            ],
          ),
          if (showWarning) ...<Widget>[
            const SizedBox(height: 4),
            InfoBanner(
              own.isEmpty
                  ? StrackerAiStatus.unavailableMessage
                  : 'Stracker AI is temporarily unavailable, so your own model is answering.',
              tone: PillTone.warn,
              icon: Icons.warning_amber_rounded,
            ),
          ],
        ],
      ),
    );
  }
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat({required this.promptSelected});

  final ValueChanged<String> promptSelected;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Icon(Icons.auto_awesome, size: 34, color: colors.palette.accent),
        const SizedBox(height: 10),
        Text(
          'Ask about your own notebook',
          textAlign: TextAlign.center,
          style: _scaled(Theme.of(context).textTheme.headlineSmall, 0.9),
        ),
        const SizedBox(height: 6),
        Text(
          'Stracker AI reads your syllabus, tests, revisions and mistakes, so its answers are about '
          'your own preparation. Stracker AI (Default) is ready to use, or add your own model.',
          textAlign: TextAlign.center,
          style: _scaled(Theme.of(context).textTheme.bodySmall, 0.8)?.copyWith(color: colors.muted),
        ),
        const SizedBox(height: 16),
        for (final String prompt in const <String>[
          'Which chapters should I revise this week?',
          'Where am I losing the most marks in mocks?',
          'Compare my Physics and Maths averages over the last 10 tests.',
          'Make a 90-minute plan for tomorrow from my backlog.',
        ])
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              onPressed: () => promptSelected(prompt),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(prompt, style: _scaled(Theme.of(context).textTheme.bodySmall, 0.8)),
              ),
            ),
          ),
      ],
    );
  }
}

/// Provider configuration. The key is posted once, encrypted server-side, and never
/// returned; the list only shows a masked hint.
class _ProvidersBody extends StatefulWidget {
  const _ProvidersBody({required this.client});

  final AiClient client;

  @override
  State<_ProvidersBody> createState() => _ProvidersBodyState();
}

class _ProvidersBodyState extends State<_ProvidersBody> {
  List<AiProvider> _rows = <AiProvider>[];
  StrackerAiStatus? _stracker;
  String _preference = 'stracker';
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final AiProviderList list = await widget.client.providerList();
      if (!mounted) return;
      setState(() {
        _rows = list.providers;
        _stracker = list.stracker;
        _preference = list.preference;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      // Refresh the list in the background; the action itself already finished.
      unawaited(_load());
    } catch (error) {
      if (mounted) showToast(context, error.toString(), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return BusyOverlay(
      busy: _busy,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (_stracker != null) ...<Widget>[
            _StrackerCard(
              stracker: _stracker!,
              preferred: _preference != 'own',
              onPrefer: () => _run(widget.client.preferStracker),
              onAddOwn: () => _addProvider(context),
            ),
            const SizedBox(height: 10),
          ],
          InfoBanner(
            'Your own keys are encrypted and never leave our servers. This app only sends the key '
            'you type here, once, over HTTPS with your own session token.',
            icon: Icons.lock_outline,
          ),
          const SizedBox(height: 10),
          if (_error != null) ...<Widget>[ErrorNotice(_error!, onRetry: _load), const SizedBox(height: 10)],
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: WanderingEyes(height: 28)),
            )
          else if (_rows.isEmpty)
            const EmptyState(
              title: 'No models of your own yet',
              message: 'Optional: add your own Gemini, OpenAI-compatible, Anthropic-compatible or Qwen key. '
                  'The website’s AI settings offer the same options.',
              icon: Icons.hub_outlined,
            )
          else
            for (final AiProvider provider in _rows)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: colors.palette.paperSoft,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: colors.palette.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            provider.displayName,
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                        ),
                        if (provider.isDefault && _preference == 'own')
                          const Pill('preferred', tone: PillTone.accent, dense: true),
                        const SizedBox(width: 4),
                        Pill(
                          provider.connectionStatus,
                          tone: provider.connectionStatus == 'connected' ? PillTone.good : PillTone.warn,
                          dense: true,
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '${provider.modelId} · ${provider.maskedKey}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 4,
                      children: <Widget>[
                        TextButton(
                          onPressed: () => _run(() async {
                            await widget.client.testConnection(provider.id);
                            if (mounted) showToast(context, 'Connection works.');
                          }),
                          child: const Text('Test'),
                        ),
                        TextButton(
                          onPressed: provider.enabled
                              ? () => _run(() => widget.client.providerAction(provider.id, 'disable'))
                              : () => _run(() => widget.client.providerAction(provider.id, 'enable')),
                          child: Text(provider.enabled ? 'Disable' : 'Enable'),
                        ),
                        TextButton(
                          onPressed: () => _run(() => widget.client.providerAction(provider.id, 'default')),
                          child: const Text('Prefer'),
                        ),
                        TextButton(
                          onPressed: () async {
                            final bool confirmed = await confirmAction(
                              context,
                              title: 'Remove ${provider.displayName}?',
                              message: 'The saved key has been removed.',
                            );
                            if (!confirmed) return;
                            // Optimistic: drop the row now, restore it if the server refuses.
                            final List<AiProvider> before = _rows;
                            setState(() => _rows = <AiProvider>[
                                  for (final AiProvider row in _rows)
                                    if (row.id != provider.id) row,
                                ]);
                            try {
                              await widget.client.deleteProvider(provider.id);
                            } catch (error) {
                              if (!mounted) return;
                              setState(() => _rows = before);
                              showToast(context, error.toString(), error: true);
                            }
                          },
                          child: Text(
                            'Remove',
                            style: TextStyle(color: colors.palette.red),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => _addProvider(context),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Add your own model'),
          ),
        ],
      ),
    );
  }

  Future<void> _addProvider(BuildContext context) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: context.stracker.palette.paper,
      builder: (BuildContext sheetContext) => _AddProviderSheet(
        client: widget.client,
        onSaved: () {
          Navigator.of(sheetContext).pop();
          _load();
        },
      ),
    );
  }
}

/// Stracker AI (Default): brand, model name and availability only. It can be preferred but
/// never edited or removed.
class _StrackerCard extends StatelessWidget {
  const _StrackerCard({
    required this.stracker,
    required this.preferred,
    required this.onPrefer,
    required this.onAddOwn,
  });

  final StrackerAiStatus stracker;
  final bool preferred;
  final VoidCallback onPrefer;
  final VoidCallback onAddOwn;

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.palette.paperSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: stracker.ready ? colors.palette.green : colors.palette.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.auto_awesome, size: 17, color: colors.palette.accent),
              const SizedBox(width: 6),
              Expanded(
                child: Text(StrackerAiStatus.label, style: Theme.of(context).textTheme.titleSmall),
              ),
              if (preferred) const Pill('preferred', tone: PillTone.accent, dense: true),
              const SizedBox(width: 4),
              Pill(
                stracker.ready ? 'ready' : 'unavailable',
                tone: stracker.ready ? PillTone.good : PillTone.warn,
                dense: true,
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            <String>[
              if (stracker.model != null) stracker.model!,
              'Included with Stracker',
              if (stracker.ready && stracker.dailyLimit > 0)
                '${(stracker.dailyLimit - stracker.usedToday).clamp(0, stracker.dailyLimit)} of ${stracker.dailyLimit} left today',
            ].join(' · '),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
          ),
          if (!stracker.ready) ...<Widget>[
            const SizedBox(height: 8),
            const InfoBanner(
              StrackerAiStatus.unavailableMessage,
              tone: PillTone.warn,
              icon: Icons.warning_amber_rounded,
            ),
            const SizedBox(height: 4),
            TextButton.icon(
              onPressed: onAddOwn,
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Add your own model'),
            ),
          ] else if (!preferred)
            TextButton(onPressed: onPrefer, child: const Text('Prefer')),
        ],
      ),
    );
  }
}

class _AddProviderSheet extends StatefulWidget {
  const _AddProviderSheet({required this.client, required this.onSaved});

  final AiClient client;
  final VoidCallback onSaved;

  @override
  State<_AddProviderSheet> createState() => _AddProviderSheetState();
}

class _AddProviderSheetState extends State<_AddProviderSheet> {
  final TextEditingController _provider = TextEditingController(text: 'google');
  final TextEditingController _model = TextEditingController();
  final TextEditingController _key = TextEditingController();
  final TextEditingController _baseUrl = TextEditingController();
  String _protocol = 'google';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _provider.dispose();
    _model.dispose();
    _key.dispose();
    _baseUrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final StrackerColors colors = context.stracker;
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text('Add an AI provider', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _protocol,
              decoration: const InputDecoration(labelText: 'Protocol'),
              items: const <DropdownMenuItem<String>>[
                DropdownMenuItem<String>(value: 'google', child: Text('Google Gemini')),
                DropdownMenuItem<String>(
                  value: 'openai-compatible',
                  child: Text('OpenAI-compatible'),
                ),
                DropdownMenuItem<String>(
                  value: 'anthropic-compatible',
                  child: Text('Anthropic-compatible'),
                ),
              ],
              onChanged: (String? value) {
                if (value == null) return;
                setState(() {
                  _protocol = value;
                  _provider.text =
                      value == 'google' ? 'google' : (value == 'anthropic-compatible' ? 'anthropic' : 'openai');
                });
              },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _provider,
              decoration: const InputDecoration(
                labelText: 'Provider id',
                helperText: 'google, openai, anthropic, qwen or custom',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _model,
              decoration: const InputDecoration(labelText: 'Model id'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _key,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Your private key',
                helperText: 'Kept on your account, encrypted. Used only for your own questions.',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _baseUrl,
              decoration: const InputDecoration(
                labelText: 'Custom address (optional)',
                helperText: 'Only needed if your provider gave you a different address.',
              ),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 8),
              ErrorNotice(_error!),
            ],
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _busy
                  ? null
                  : () async {
                      if (_model.text.trim().isEmpty || _key.text.trim().isEmpty) {
                        setState(() => _error = 'A model name and your private key are both required.');
                        return;
                      }
                      setState(() {
                        _busy = true;
                        _error = null;
                      });
                      try {
                        final AiProvider saved = await widget.client.saveProvider(
                          providerId: _provider.text.trim(),
                          modelId: _model.text.trim(),
                          apiKey: _key.text.trim(),
                          baseUrl: _baseUrl.text.trim().isEmpty ? null : _baseUrl.text.trim(),
                          protocol: _protocol,
                        );
                        try {
                          await widget.client.testConnection(saved.id);
                        } catch (error) {
                          if (mounted) {
                            setState(() => _error = 'Saved, but the connection test failed: $error');
                            widget.onSaved();
                          }
                          return;
                        }
                        widget.onSaved();
                      } catch (error) {
                        if (mounted) setState(() => _error = error.toString());
                      } finally {
                        if (mounted) setState(() => _busy = false);
                      }
                    },
              child: Text(_busy ? 'Saving…' : 'Save and test connection'),
            ),
            const SizedBox(height: 6),
            Text(
              'The app never reads the key back. Rotate it at the provider if you ever suspect it leaked.',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: colors.muted),
            ),
          ],
        ),
      ),
    );
  }
}
