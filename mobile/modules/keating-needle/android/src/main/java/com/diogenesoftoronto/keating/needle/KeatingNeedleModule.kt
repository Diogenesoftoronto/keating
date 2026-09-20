package com.diogenesoftoronto.keating.needle

import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal object NeedleNative {
  val linked: Boolean = try { System.loadLibrary("keating_needle"); true } catch (_: UnsatisfiedLinkError) { false }
  @JvmStatic external fun supported(): Boolean
  @JvmStatic external fun revision(): String
  @JvmStatic external fun identity(): String?
  @JvmStatic external fun filename(): String
  @JvmStatic external fun modelSha(): String
  @JvmStatic external fun modelSize(): Int
  @JvmStatic external fun embed(model: ByteArray, texts: Array<ByteArray>): Array<FloatArray>
}

class KeatingNeedleModule : Module() {
  companion object {
    // Engine ownership is process-global, including multiple Expo module instances.
    private val worker = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
  }
  @Volatile private var closed = false
  private fun supported() = NeedleNative.linked && NeedleNative.supported()
  private fun requireSupported() { check(supported()) { "Needle needs an ARM64 native Keating build." } }
  private fun directory(): File {
    requireSupported()
    val context = appContext.reactContext ?: error("Keating is not ready.")
    return File(context.noBackupFilesDir, "needle-retrieval").also { check(it.isDirectory || it.mkdirs()) }.canonicalFile
  }
  private fun modelFile(uri: String, partialAllowed: Boolean): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file" && parsed.authority.isNullOrEmpty() && parsed.query == null && parsed.fragment == null) { "Needle needs its private local model file." }
    val requested = File(parsed.path ?: error("Invalid model URI"))
    val file = requested.canonicalFile
    require(file == requested.absoluteFile && file.parentFile == directory().canonicalFile && (file.name == NeedleNative.filename() || (partialAllowed && file.name == NeedleNative.filename() + ".part"))) { "Needle model path is outside its private storage." }
    return file
  }
  private fun verifiedBytes(file: File): ByteArray? {
    if (!file.isFile || file.length() != NeedleNative.modelSize().toLong()) return null
    // Hash the exact bytes passed to native; no hash-then-reopen race.
    val bytes = file.inputStream().use { input ->
      val result = ByteArray(NeedleNative.modelSize())
      var offset = 0
      while (offset < result.size) { val count = input.read(result, offset, result.size - offset); if (count <= 0) return null; offset += count }
      if (input.read() != -1) return null
      result
    }
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    return if (digest == NeedleNative.modelSha()) bytes else null
  }
  override fun definition() = ModuleDefinition {
    Name("KeatingNeedle")
    Constants("supported" to supported(), "runtimeRevision" to if (NeedleNative.linked) NeedleNative.revision() else "",
      "modelIdentity" to if (supported()) NeedleNative.identity() else null)
    AsyncFunction("getModelDirectoryAsync") { Uri.fromFile(directory()).toString() }
    AsyncFunction("createModelFileAsync") {
      val file = File(directory(), NeedleNative.filename() + ".part")
      require(file.canonicalFile == file.absoluteFile && file.canonicalFile.parentFile == directory().canonicalFile) { "Invalid Needle download path." }
      file.createNewFile()
      Uri.fromFile(file).toString()
    }
    AsyncFunction("verifyModelFileAsync") { uri: String, promise: Promise ->
      if (closed || !busy.compareAndSet(false, true)) promise.reject("E_NEEDLE_BUSY", "Needle is busy or unavailable.", null)
      else worker.execute {
        try {
          val verified = verifiedBytes(modelFile(uri, true)) != null
          if (closed) promise.reject("E_NEEDLE_STALE", "The native module was closed.", null) else promise.resolve(verified)
        } catch (error: Exception) { promise.reject("E_NEEDLE_VERIFY", "Could not verify the private Needle model.", error) }
        finally { busy.set(false) }
      }
    }
    AsyncFunction("embedAsync") { uri: String, texts: List<String>, promise: Promise ->
      if (closed || !busy.compareAndSet(false, true)) promise.reject("E_NEEDLE_BUSY", "Needle is busy or unavailable.", null)
      else worker.execute {
        try {
          requireSupported()
          require(texts.size in 1..16) { "Needle accepts 1 to 16 texts." }
          val encoded = texts.map { text ->
            require(text.length <= 4096 && text.isNotBlank() && !text.contains('\u0000')) { "Needle needs nonempty text without NUL." }
            val buffer = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).encode(CharBuffer.wrap(text))
            require(buffer.remaining() <= 4096) { "Needle text is too long." }
            ByteArray(buffer.remaining()).also { buffer.get(it) }
          }
          require(encoded.sumOf { it.size } <= 16384) { "Needle batch is too large." }
          val bytes = verifiedBytes(modelFile(uri, false)) ?: error("Download and verify the Needle model first.")
          val vectors = NeedleNative.embed(bytes, encoded.toTypedArray()).map { row -> row.map { it.toDouble() } }
          if (closed) promise.reject("E_NEEDLE_STALE", "The native module was closed.", null)
          else promise.resolve(mapOf("model" to NeedleNative.identity(), "dimensions" to vectors.first().size, "vectors" to vectors))
        } catch (error: Exception) { promise.reject("E_NEEDLE_EMBED", "Local retrieval could not finish: ${error.message}", error) }
        finally { busy.set(false) }
      }
    }
    OnDestroy { closed = true }
    // No native unload/cancel API exists. Pending callers discard stale results;
    // the process-global engine and its verified backing bytes live until exit.
  }
}
