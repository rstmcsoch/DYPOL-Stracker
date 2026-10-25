package come.stracker.dypollabs

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Single-activity host. Navigation, back handling and deep links are driven from Dart.
 * The only native piece is a tiny system file picker (Storage Access Framework) for
 * restoring a JSON backup, so no file-picker library ships in the APK. No storage
 * permission is needed: the user grants access to the one file they choose.
 */
class MainActivity : FlutterActivity() {
    private var pendingPick: MethodChannel.Result? = null
    private var pickMaxBytes: Long = MAX_BYTES

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            if (call.method != "pickText") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            if (pendingPick != null) {
                result.error("busy", "A file picker is already open.", null)
                return@setMethodCallHandler
            }
            pickMaxBytes = (call.argument<Number>("maxBytes")?.toLong() ?: MAX_BYTES).coerceAtMost(MAX_BYTES)
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/octet-stream"))
            }
            pendingPick = result
            try {
                startActivityForResult(intent, PICK_REQUEST)
            } catch (error: Exception) {
                pendingPick = null
                result.error("unavailable", "No file picker is available on this device.", null)
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != PICK_REQUEST) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val result = pendingPick ?: return
        pendingPick = null
        val uri: Uri? = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            result.success(null)
            return
        }
        Thread {
            try {
                val name = displayName(uri)
                val bytes = contentResolver.openInputStream(uri)?.use { input ->
                    val buffer = java.io.ByteArrayOutputStream()
                    val chunk = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val read = input.read(chunk)
                        if (read < 0) break
                        total += read
                        if (total > pickMaxBytes) throw IllegalStateException("too_large")
                        buffer.write(chunk, 0, read)
                    }
                    buffer.toByteArray()
                } ?: throw IllegalStateException("unreadable")
                val text = String(bytes, Charsets.UTF_8)
                runOnUiThread { result.success(mapOf("name" to name, "text" to text)) }
            } catch (error: IllegalStateException) {
                val code = error.message ?: "unreadable"
                runOnUiThread { result.error(code, "Could not read that file.", null) }
            } catch (error: Exception) {
                runOnUiThread { result.error("unreadable", "Could not read that file.", null) }
            }
        }.start()
    }

    private fun displayName(uri: Uri): String {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) return cursor.getString(index) ?: "backup.json"
            }
        }
        return uri.lastPathSegment ?: "backup.json"
    }

    companion object {
        private const val CHANNEL = "stracker/files"
        private const val PICK_REQUEST = 4107
        private const val MAX_BYTES = 60L * 1024 * 1024
    }
}
