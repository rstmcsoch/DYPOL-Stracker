import 'package:flutter/services.dart';

/// System file picker (Android Storage Access Framework) through a tiny channel in
/// MainActivity, so no picker library is bundled. Returns null when the user cancels.
class PickedTextFile {
  const PickedTextFile(this.name, this.text);
  final String name;
  final String text;
}

const MethodChannel _channel = MethodChannel('stracker/files');

/// The website's import limit: a Stracker JSON file under 60 MB.
const int backupMaxBytes = 60 * 1024 * 1024;

class FilePickError implements Exception {
  const FilePickError(this.message);
  final String message;
  @override
  String toString() => message;
}

Future<PickedTextFile?> pickTextFile({int maxBytes = backupMaxBytes}) async {
  try {
    final Map<Object?, Object?>? raw =
        await _channel.invokeMapMethod<Object?, Object?>('pickText', <String, Object>{'maxBytes': maxBytes});
    if (raw == null) return null;
    return PickedTextFile('${raw['name'] ?? 'backup.json'}', '${raw['text'] ?? ''}');
  } on PlatformException catch (error) {
    throw FilePickError(switch (error.code) {
      'too_large' => 'Choose a Stracker JSON file under 60 MB.',
      'unavailable' => 'No file picker is available on this device. Paste the backup instead.',
      'busy' => 'A file picker is already open.',
      _ => 'Could not read that backup.',
    });
  } on MissingPluginException {
    throw const FilePickError('File picking is not available here. Paste the backup instead.');
  }
}
