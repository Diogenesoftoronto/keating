import CLiteRTLM
import CryptoKit
import ExpoModulesCore
import Foundation

private final class LiteRTStream {
  let done = DispatchSemaphore(value: 0)
  var text = ""
  var error: Error?
  let emit: (String) -> Void
  init(emit: @escaping (String) -> Void) { self.emit = emit }
}

// The official C conversation API emits JSON messages. Never expose the thought channel.
private func keatingStreamCallback(_ data: UnsafeMutableRawPointer?, _ chunk: OpaquePointer?) {
  guard let data else { return }
  let stream = Unmanaged<LiteRTStream>.fromOpaque(data).takeUnretainedValue()
  if let error = litert_lm_stream_chunk_get_error(chunk) {
    stream.error = NSError(domain: "LiteRT", code: 1, userInfo: [NSLocalizedDescriptionKey: String(cString: error)])
    stream.done.signal()
    return
  }
  if let raw = litert_lm_stream_chunk_get_text(chunk), let bytes = String(cString: raw).data(using: .utf8) {
    do {
      if let message = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] {
        let text: String
        if let content = message["content"] as? String { text = content }
        else {
          text = (message["content"] as? [[String: Any]] ?? []).compactMap { item in
            item["type"] as? String == "text" ? item["text"] as? String : nil
          }.joined()
        }
        stream.text += text
        if !text.isEmpty { stream.emit(text) }
      }
    } catch { stream.error = error }
  }
  if litert_lm_stream_chunk_is_final(chunk) { stream.done.signal() }
}

public final class KeatingLiteRTModule: Module {
  private let worker = DispatchQueue(label: "keating.litert", qos: .userInitiated)
  private let lock = NSLock()
  private var engine: OpaquePointer?
  private var enginePath: String?
  private var conversation: OpaquePointer?
  private var activeId: String?
  private var lastCancelledId: String?
  private var cancelled = false

  private func directory() throws -> URL {
    var root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("offline-tutor", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try root.setResourceValues(values)
    return root
  }
  private func localFile(_ uri: String) throws -> URL {
    guard let file = URL(string: uri), file.isFileURL,
      file.resolvingSymlinksInPath().deletingLastPathComponent().path == (try directory()).resolvingSymlinksInPath().path
    else { throw Exception(name: "E_MODEL_PATH", description: "The model must be in Keating offline storage.") }
    return file
  }
  private func closeEngine() {
    if let engine { litert_lm_engine_delete(engine) }
    engine = nil
    enginePath = nil
  }
  private func initialize(_ path: String) throws {
    if engine != nil && enginePath == path { return }
    closeEngine()
    for backend in ["GPU", "CPU"] {
      guard let settings = litert_lm_engine_settings_create(path, backend, nil, nil) else { continue }
      litert_lm_engine_settings_set_max_num_tokens(settings, 4096)
      litert_lm_engine_settings_set_cache_dir(settings, ":nocache")
      engine = litert_lm_engine_create(settings)
      litert_lm_engine_settings_delete(settings)
      if engine != nil { enginePath = path; return }
    }
    throw Exception(name: "E_MODEL_LOAD", description: "Could not load the offline tutor. Close other apps to free memory and retry.")
  }
  private func json(_ object: Any) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
  }
  private func generate(_ requestId: String, _ uri: String, _ system: String, _ history: String, _ temperature: Double) throws -> String {
    lock.lock(); let alreadyStopped = cancelled; lock.unlock()
    if alreadyStopped { throw CancellationError() }
    let file = try localFile(uri)
    guard file.pathExtension == "litertlm", FileManager.default.fileExists(atPath: file.path) else {
      throw Exception(name: "E_MISSING_MODEL", description: "Download the offline tutor in Settings first.")
    }
    try initialize(file.path)
    guard let messages = try JSONSerialization.jsonObject(with: Data(history.utf8)) as? [[String: String]],
      let last = messages.last, last["role"] == "user",
      messages.allSatisfy({ ["user", "assistant"].contains($0["role"] ?? "") && $0["content"] != nil }) else {
      throw Exception(name: "E_MESSAGES", description: "Send a text message first.")
    }
    guard let config = litert_lm_conversation_config_create() else {
      throw Exception(name: "E_CONFIG", description: "Could not create the offline conversation.")
    }
    defer { litert_lm_conversation_config_delete(config) }
    guard let session = litert_lm_session_config_create() else {
      throw Exception(name: "E_CONFIG", description: "Could not create the offline session.")
    }
    defer { litert_lm_session_config_delete(session) }
    guard let sampler = litert_lm_sampler_params_create(kLiteRtLmSamplerTypeTopP) else {
      throw Exception(name: "E_CONFIG", description: "Could not create the offline sampler.")
    }
    defer { litert_lm_sampler_params_delete(sampler) }
    guard let thinking = litert_lm_thinking_config_create() else {
      throw Exception(name: "E_CONFIG", description: "Could not configure the offline tutor.")
    }
    defer { litert_lm_thinking_config_delete(thinking) }
    litert_lm_sampler_params_set_top_k(sampler, 40)
    litert_lm_sampler_params_set_top_p(sampler, 0.95)
    litert_lm_sampler_params_set_temperature(sampler, Float(temperature))
    litert_lm_session_config_set_sampler_params(session, sampler)
    litert_lm_session_config_set_max_output_tokens(session, 1024)
    litert_lm_conversation_config_set_session_config(config, session)
    litert_lm_conversation_config_set_system_message(config, try json([["type": "text", "text": system]]))
    litert_lm_conversation_config_set_messages(config, try json(Array(messages.dropLast())))
    litert_lm_conversation_config_set_extra_context(config, "{\"enable_thinking\":false}")
    litert_lm_thinking_config_set_enable_thinking(thinking, false)
    litert_lm_conversation_config_set_thinking_config(config, thinking)
    guard let chat = litert_lm_conversation_create(engine, config) else {
      throw Exception(name: "E_CONTEXT", description: "The offline lesson may be too long. Start a new lesson or shorten your message.")
    }
    defer {
      lock.lock(); conversation = nil; lock.unlock()
      litert_lm_conversation_delete(chat)
    }
    let stream = LiteRTStream { [weak self] text in self?.sendEvent("onDelta", ["requestId": requestId, "text": text]) }
    let message = try json(last)
    lock.lock()
    conversation = chat
    if cancelled { lock.unlock(); throw CancellationError() }
    let status = litert_lm_conversation_send_message_stream(chat, message, "{\"enable_thinking\":false}", nil,
      keatingStreamCallback, Unmanaged.passUnretained(stream).toOpaque())
    lock.unlock()
    guard status == 0 else { throw Exception(name: "E_GENERATION", description: "The offline lesson may be too long. Start a new lesson or shorten your message.") }
    // Keep callback context and engine alive until the native terminal callback, including cancellation.
    return try withExtendedLifetime(stream) {
      stream.done.wait()
      lock.lock(); let stopped = cancelled; lock.unlock()
      if stopped { throw CancellationError() }
      if let error = stream.error { throw error }
      return stream.text
    }
  }

  public func definition() -> ModuleDefinition {
    Name("KeatingLiteRT")
    Constants(["runtimeVersion": "0.16.0", "supported": true])
    Events("onDelta")
    AsyncFunction("getDirectoryAsync") { () -> String in try self.directory().absoluteString }
    AsyncFunction("createFileAsync") { (uri: String) in
      let file = try self.localFile(uri)
      if !FileManager.default.fileExists(atPath: file.path) {
        guard FileManager.default.createFile(atPath: file.path, contents: nil) else {
          throw Exception(name: "E_FILE", description: "Could not create the offline model file. Check available storage.")
        }
      }
    }
    AsyncFunction("sha256Async") { (uri: String, promise: Promise) in
      self.worker.async {
        do {
          let handle = try FileHandle(forReadingFrom: self.localFile(uri))
          defer { try? handle.close() }
          var digest = SHA256()
          while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { digest.update(data: data) }
          promise.resolve(digest.finalize().map { String(format: "%02x", $0) }.joined())
        } catch { promise.reject(error) }
      }
    }
    AsyncFunction("generateAsync") { (requestId: String, uri: String, system: String, history: String, temperature: Double, promise: Promise) in
      self.lock.lock()
      let busy = self.activeId != nil
      if !busy { self.activeId = requestId; self.cancelled = self.lastCancelledId == requestId }
      self.lock.unlock()
      if busy { promise.reject("E_BUSY", "Stop the current offline response first."); return }
      self.worker.async {
        do {
          let output = try self.generate(requestId, uri, system, history, temperature)
          self.lock.lock(); self.activeId = nil; self.lock.unlock()
          promise.resolve(output)
        } catch {
          self.lock.lock(); self.activeId = nil; self.lock.unlock()
          promise.reject(error)
        }
      }
    }
    Function("cancelGeneration") { (requestId: String) in
      self.lock.lock()
      defer { self.lock.unlock() }
      self.lastCancelledId = requestId
      if self.activeId == requestId {
        self.cancelled = true
        if let conversation = self.conversation { litert_lm_conversation_cancel_process(conversation) }
      }
    }
    AsyncFunction("unloadAsync") { (promise: Promise) in
      self.worker.async { self.closeEngine(); promise.resolve(nil) }
    }
    OnDestroy {
      self.lock.lock()
      self.cancelled = true
      if let conversation = self.conversation { litert_lm_conversation_cancel_process(conversation) }
      self.lock.unlock()
      self.worker.async { self.closeEngine() }
    }
  }
}
