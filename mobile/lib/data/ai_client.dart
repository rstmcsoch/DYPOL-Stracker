import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config.dart';
import '../core/errors.dart';

/// A provider configuration as the API exposes it. `apiKey` is only ever sent *to* the
/// server; the server never returns it, only `maskedKey`.
class AiProvider {
  const AiProvider({
    required this.id,
    required this.providerId,
    required this.displayName,
    required this.modelId,
    required this.maskedKey,
    required this.enabled,
    required this.isDefault,
    required this.connectionStatus,
    this.protocol,
    this.baseUrl,
    this.lastCheckedAt,
  });

  final String id;
  final String providerId;
  final String displayName;
  final String modelId;
  final String maskedKey;
  final bool enabled;
  final bool isDefault;
  final String connectionStatus;
  final String? protocol;
  final String? baseUrl;
  final String? lastCheckedAt;

  factory AiProvider.fromJson(Map<String, dynamic> raw) => AiProvider(
        id: _text(raw['id']),
        providerId: _text(raw['provider_id']),
        displayName: _text(raw['display_name']).isEmpty
            ? _text(raw['provider_id'])
            : _text(raw['display_name']),
        modelId: _text(raw['model_id']),
        maskedKey: _text(raw['masked_key']),
        enabled: raw['enabled'] == true,
        isDefault: raw['is_default'] == true,
        connectionStatus: _text(raw['connection_status'], 'not_tested'),
        protocol: raw['protocol'] == null ? null : _text(raw['protocol']),
        baseUrl: raw['base_url'] == null ? null : _text(raw['base_url']),
        lastCheckedAt: raw['last_checked_at'] == null ? null : _text(raw['last_checked_at']),
      );

  bool get isReady => enabled && connectionStatus == 'connected';
}

class AiConversation {
  const AiConversation({
    required this.id,
    required this.title,
    required this.updatedAt,
  });

  final String id;
  final String title;
  final String updatedAt;

  factory AiConversation.fromJson(Map<String, dynamic> raw) => AiConversation(
        id: _text(raw['id']),
        title: _text(raw['title'], 'New conversation'),
        updatedAt: _text(raw['updated_at']),
      );
}

class AiMessage {
  const AiMessage({
    required this.id,
    required this.role,
    required this.content,
    this.providerId,
    this.modelId,
    this.status,
  });

  final String id;
  final String role;
  final String content;
  final String? providerId;
  final String? modelId;
  final String? status;

  bool get isUser => role == 'user';

  factory AiMessage.fromJson(Map<String, dynamic> raw) => AiMessage(
        id: _text(raw['id']),
        role: _text(raw['role'], 'assistant'),
        content: _text(raw['content']),
        providerId: raw['provider_id'] == null ? null : _text(raw['provider_id']),
        modelId: raw['model_id'] == null ? null : _text(raw['model_id']),
        status: raw['status'] == null ? null : _text(raw['status']),
      );
}

class AiConversationDetail {
  const AiConversationDetail({
    required this.conversation,
    required this.messages,
  });

  final AiConversation conversation;
  final List<AiMessage> messages;
}

class AiHealth {
  const AiHealth({required this.configured, this.reason, this.missing = const <String>[]});

  final bool configured;
  final String? reason;
  final List<String> missing;

  factory AiHealth.fromJson(Map<String, dynamic> raw) => AiHealth(
        configured: raw['configured'] == true,
        reason: raw['reason'] == null ? null : _text(raw['reason']),
        missing: <String>[
          for (final dynamic value in (raw['missing'] as List<dynamic>? ?? <dynamic>[]))
            _text(value),
        ],
      );
}

/// One server-sent event from `/api/ai/chat`.
class AiStreamEvent {
  const AiStreamEvent(this.name, this.data);

  final String name;
  final Map<String, dynamic> data;

  String get text => _text(data['text']);
  Map<String, dynamic>? get action =>
      data['action'] is Map ? Map<String, dynamic>.from(data['action'] as Map) : null;
}

String _text(Object? value, [String fallback = '']) =>
    value == null ? fallback : value.toString();

/// Thin client over the existing Vercel AI functions. It never sees a provider key and
/// never talks to a provider directly: only `/api/ai/*` on the deployed site, with the
/// user's own Supabase access token.
class AiClient {
  AiClient({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _client;
  final String _baseUrl;

  /// How long the server may take to open the chat event stream before we give up.
  static const Duration connectTimeout = Duration(seconds: 60);

  /// Upper bound for one assistant turn, used by the chat page for its own spinner.
  static const Duration chatTimeout = Duration(minutes: 3);

  String? get _token => Supabase.instance.client.auth.currentSession?.accessToken;

  Map<String, String> _headers({bool json = true}) {
    final String? token = _token;
    if (token == null) {
      throw const AppFailure('Your session has expired. Sign in again to use the assistant.');
    }
    return <String, String>{
      'Authorization': 'Bearer $token',
      if (json) 'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$_baseUrl$path').replace(queryParameters: query);

  Future<Map<String, dynamic>> _decode(http.Response response) async {
    Map<String, dynamic> body = <String, dynamic>{};
    if (response.body.trim().isNotEmpty) {
      try {
        final Object? parsed = jsonDecode(response.body);
        if (parsed is Map) body = Map<String, dynamic>.from(parsed);
      } on FormatException {
        throw const AppFailure(
          'The AI service returned an unexpected response. The web deployment may not have the '
          '/api/ai functions available.',
        );
      }
    }
    if (response.statusCode >= 400) {
      final String message = _text(body['message']);
      throw AppFailure(
        message.isEmpty
            ? 'The AI service refused that request (HTTP ${response.statusCode}).'
            : message,
        code: body['error'] == null ? null : _text(body['error']),
      );
    }
    return body;
  }

  Future<AiHealth> health() async {
    final http.Response response = await _client.get(_uri('/api/ai/health'));
    return AiHealth.fromJson(await _decode(response));
  }

  Future<List<AiProvider>> providers() async {
    final http.Response response =
        await _client.get(_uri('/api/ai/providers'), headers: _headers());
    final Map<String, dynamic> body = await _decode(response);
    return <AiProvider>[
      for (final dynamic row in (body['providers'] as List<dynamic>? ?? <dynamic>[]))
        if (row is Map) AiProvider.fromJson(Map<String, dynamic>.from(row)),
    ];
  }

  Future<AiProvider> saveProvider({
    String? id,
    required String providerId,
    required String modelId,
    String? displayName,
    String? apiKey,
    String? baseUrl,
    String? protocol,
    String? organizationId,
    String? region,
    Map<String, dynamic>? capabilities,
  }) async {
    final http.Response response = await _client.post(
      _uri('/api/ai/providers'),
      headers: _headers(),
      body: jsonEncode(<String, dynamic>{
        if (id != null) 'id': id,
        'providerId': providerId,
        if (displayName != null) 'displayName': displayName,
        'modelId': modelId,
        if (apiKey != null && apiKey.isNotEmpty) 'apiKey': apiKey,
        'baseUrl': baseUrl,
        if (protocol != null) 'protocol': protocol,
        'organizationId': organizationId,
        if (region != null) 'region': region,
        if (capabilities != null) 'capabilities': capabilities,
      }),
    );
    final Map<String, dynamic> body = await _decode(response);
    final Object? provider = body['provider'];
    if (provider is! Map) throw const AppFailure('The provider was saved but not returned.');
    return AiProvider.fromJson(Map<String, dynamic>.from(provider));
  }

  Future<AiProvider> providerAction(String id, String action) async {
    final http.Response response = await _client.patch(
      _uri('/api/ai/providers'),
      headers: _headers(),
      body: jsonEncode(<String, dynamic>{'id': id, 'action': action}),
    );
    final Map<String, dynamic> body = await _decode(response);
    final Object? provider = body['provider'];
    if (provider is! Map) throw const AppFailure('The provider action was accepted.');
    return AiProvider.fromJson(Map<String, dynamic>.from(provider));
  }

  Future<void> deleteProvider(String id) async {
    final http.Response response = await _client.delete(
      _uri('/api/ai/providers'),
      headers: _headers(),
      body: jsonEncode(<String, dynamic>{'id': id}),
    );
    await _decode(response);
  }

  /// Tests the saved credential server-side. The key never travels from the device.
  Future<bool> testConnection(String configId) async {
    final http.Response response = await _client.post(
      _uri('/api/ai/test-connection'),
      headers: _headers(),
      body: jsonEncode(<String, dynamic>{'configId': configId}),
    );
    await _decode(response);
    return true;
  }

  Future<List<AiConversation>> conversations() async {
    final http.Response response =
        await _client.get(_uri('/api/ai/conversations'), headers: _headers());
    final Map<String, dynamic> body = await _decode(response);
    return <AiConversation>[
      for (final dynamic row in (body['conversations'] as List<dynamic>? ?? <dynamic>[]))
        if (row is Map) AiConversation.fromJson(Map<String, dynamic>.from(row)),
    ];
  }

  Future<AiConversationDetail> conversation(String id) async {
    final http.Response response = await _client.get(
      _uri('/api/ai/conversations', <String, String>{'id': id}),
      headers: _headers(),
    );
    final Map<String, dynamic> body = await _decode(response);
    final Object? conversation = body['conversation'];
    return AiConversationDetail(
      conversation: AiConversation.fromJson(
        conversation is Map ? Map<String, dynamic>.from(conversation) : <String, dynamic>{},
      ),
      messages: <AiMessage>[
        for (final dynamic row in (body['messages'] as List<dynamic>? ?? <dynamic>[]))
          if (row is Map) AiMessage.fromJson(Map<String, dynamic>.from(row)),
      ],
    );
  }

  Future<void> deleteConversation(String id) async {
    final http.Response response = await _client.delete(
      _uri('/api/ai/conversations'),
      headers: _headers(),
      body: jsonEncode(<String, dynamic>{'id': id}),
    );
    await _decode(response);
  }

  /// Stops the server-side task. The chat stream may already be closed; this is the only
  /// way to cancel a task that is still running.
  Future<bool> stop(String requestId) async {
    final http.Response response = await _client.post(
      _uri('/api/ai/tasks'),
      headers: _headers(),
      body: jsonEncode(<String, dynamic>{'requestId': requestId}),
    );
    final Map<String, dynamic> body = await _decode(response);
    return body['stopped'] == true;
  }

  /// Streams `/api/ai/chat`. Events: `task`, `status`, `delta`, `reset`, `fallback`,
  /// `confirmation`, `done`, `cancelled`, `error`. The stream is closed when the server
  /// ends the response.
  Stream<AiStreamEvent> chat({
    required String requestId,
    required String messageId,
    required String message,
    String? conversationId,
    String? pageContext,
  }) async* {
    final http.Request request = http.Request('POST', _uri('/api/ai/chat'))
      ..headers.addAll(<String, String>{
        ..._headers(),
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      })
      ..body = jsonEncode(<String, dynamic>{
        'conversationId': conversationId,
        'requestId': requestId,
        'messageId': messageId,
        'message': message,
        'pageContext': pageContext,
      });

    final http.StreamedResponse response =
        await _client.send(request).timeout(connectTimeout);
    if (response.statusCode >= 400) {
      final String raw = await response.stream.bytesToString();
      Map<String, dynamic> body = <String, dynamic>{};
      try {
        final Object? parsed = jsonDecode(raw);
        if (parsed is Map) body = Map<String, dynamic>.from(parsed);
      } on FormatException {
        // Fall through to the status-based message.
      }
      throw AppFailure(
        _text(body['message']).isEmpty
            ? 'The assistant could not start that request (HTTP ${response.statusCode}).'
            : _text(body['message']),
        code: body['error'] == null ? null : _text(body['error']),
      );
    }

    String eventName = 'message';
    final StringBuffer dataBuffer = StringBuffer();
    String? pendingLine;
    await for (final String chunk in response.stream.transform(utf8.decoder)) {
      final List<String> lines = ((pendingLine ?? '') + chunk).split('\n');
      // The last fragment may be half a line; keep it for the next chunk.
      pendingLine = lines.removeLast();
      for (final String line in lines) {
        final String clean = line.endsWith('\r') ? line.substring(0, line.length - 1) : line;
        if (clean.isEmpty) {
          if (dataBuffer.isNotEmpty) {
            final Map<String, dynamic> data = _parseEventData(dataBuffer.toString());
            yield AiStreamEvent(eventName, data);
          }
          eventName = 'message';
          dataBuffer.clear();
          continue;
        }
        if (clean.startsWith(':')) continue; // keepalive
        if (clean.startsWith('event:')) {
          eventName = clean.substring(6).trim();
        } else if (clean.startsWith('data:')) {
          if (dataBuffer.isNotEmpty) dataBuffer.write('\n');
          dataBuffer.write(clean.substring(5).trim());
        }
      }
    }
    final String tail = pendingLine ?? '';
    if (tail.trim().isNotEmpty) {
      final String clean = tail.trim();
      if (clean.startsWith('data:')) dataBuffer.write(clean.substring(5).trim());
    }
    if (dataBuffer.isNotEmpty) {
      yield AiStreamEvent(eventName, _parseEventData(dataBuffer.toString()));
    }
  }

  Map<String, dynamic> _parseEventData(String raw) {
    if (raw.isEmpty) return <String, dynamic>{};
    try {
      final Object? parsed = jsonDecode(raw);
      return parsed is Map ? Map<String, dynamic>.from(parsed) : <String, dynamic>{};
    } on FormatException {
      return <String, dynamic>{'text': raw};
    }
  }

  void close() => _client.close();
}
