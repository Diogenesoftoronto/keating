package com.diogenesoftoronto.keating.litert

import android.net.Uri
import android.os.Process
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

class KeatingLiteRTModule : Module() {
  private val worker = Executors.newSingleThreadExecutor()
  private val runner = LiteRTRunner()
  @Volatile private var activeScoring: String? = null

  private fun directory(): File {
    val context = appContext.reactContext ?: error("Keating is not ready.")
    return File(context.noBackupFilesDir, "offline-tutor").also { check(it.isDirectory || it.mkdirs()) }
  }
  private fun localFile(uri: String): File {
    require(Uri.parse(uri).scheme == "file") { "The offline model must be a local file." }
    val file = File(Uri.parse(uri).path ?: error("Invalid model path")).canonicalFile
    require(file.parentFile == directory().canonicalFile) { "The model must be in Keating offline storage." }
    return file
  }

  override fun definition() = ModuleDefinition {
    Name("KeatingLiteRT")
    Constants("runtimeVersion" to "0.16.0", "supported" to Process.is64Bit(), "labelScorerVersion" to "litert-0.16.0-cpu-candidate-nll-v1")
    Events("onDelta")
    AsyncFunction("getDirectoryAsync") { Uri.fromFile(directory()).toString() }
    AsyncFunction("createFileAsync") { uri: String -> localFile(uri).createNewFile(); Unit }
    AsyncFunction("sha256Async") { uri: String, promise: Promise ->
      worker.execute {
        try {
          val digest = MessageDigest.getInstance("SHA-256")
          localFile(uri).inputStream().buffered().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
          }
          promise.resolve(digest.digest().joinToString("") { "%02x".format(it) })
        } catch (error: Exception) { promise.reject("E_MODEL_HASH", "Could not verify the offline model: ${error.message}", error) }
      }
    }
    AsyncFunction("generateAsync") { requestId: String, uri: String, system: String, json: String, temperature: Double, promise: Promise ->
      if (!runner.reserve(requestId)) promise.reject("E_BUSY", "Stop the current offline response first.", null)
      else worker.execute {
        try {
          val file = localFile(uri)
          require(file.isFile && file.name.endsWith(".litertlm")) { "Download the offline tutor in Settings first." }
          val output = runner.generate(file.path, system, json, temperature) { text ->
            sendEvent("onDelta", mapOf("requestId" to requestId, "text" to text))
          }
          runner.finish()
          promise.resolve(output)
        } catch (error: Throwable) {
          runner.finish()
          promise.reject("E_OFFLINE_INFERENCE", "Offline tutor could not finish. Try a shorter message or a new lesson; close other apps if memory is low. ${error.message}", error)
        }
      }
    }
    AsyncFunction("scoreLabelsAsync") { requestId: String, uri: String, message: String, count: Int, promise: Promise ->
      if (!runner.reserve(requestId)) promise.reject("E_BUSY", "Offline inference is busy.", null)
      else {
        activeScoring = requestId
        worker.execute {
        try {
          require(Process.is64Bit() && count in 2..64 && requestId.length in 1..128 && !message.contains('\u0000') && message.toByteArray(Charsets.UTF_8).size <= 150000)
          val file = localFile(uri)
          require(file.isFile && file.name.endsWith(".litertlm"))
          // Do not keep a tutor engine resident while the scorer owns its CPU engine.
          runner.close()
          val scores = KeatingLabelScorer.score(requestId, file.path.toByteArray(Charsets.UTF_8), message.toByteArray(Charsets.UTF_8), count)
            ?: error("Local judgement unavailable or cancelled")
          promise.resolve(scores.map { it.toDouble() })
        } catch (error: Throwable) { promise.reject("E_OFFLINE_SCORING", "Local judgement could not finish.", error) }
        finally { activeScoring = null; runner.finish() }
        }
      }
    }
    Function("cancelGeneration") { requestId: String ->
      runner.cancel(requestId)
      if (Process.is64Bit()) KeatingLabelScorer.cancel(requestId)
    }
    AsyncFunction("unloadAsync") { promise: Promise ->
      worker.execute {
        try { runner.close(); promise.resolve(null) }
        catch (error: Exception) { promise.reject("E_UNLOAD", "Could not release the offline model.", error) }
      }
    }
    OnDestroy {
      runner.cancelActive()
      activeScoring?.let { KeatingLabelScorer.cancel(it) }
      worker.execute { runCatching { runner.close() } }
      worker.shutdown()
    }
  }
}
