import CryptoKit
import ExpoModulesCore
import Foundation

public final class KeatingNeedleModule: Module {
  // Shared across module instances because the C engine owns process-global state.
  private static let worker = DispatchQueue(label: "keating.needle", qos: .utility)
  private static let admission = NSLock()
  private static var busy = false
  private let lifecycle = NSLock()
  private var closed = false
  private func current() -> Bool { lifecycle.lock(); defer { lifecycle.unlock() }; return !closed }
  private static func reserve() -> Bool { admission.lock(); defer { admission.unlock() }; if busy { return false }; busy = true; return true }
  private static func release() { admission.lock(); busy = false; admission.unlock() }
  private func directory() throws -> URL {
    guard NeedleBridge.supported() else { throw Exception(name: "E_NEEDLE_UNAVAILABLE", description: "Needle needs an ARM64 native build.") }
    var directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("needle-retrieval", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues(); values.isExcludedFromBackup = true; try directory.setResourceValues(values)
    return directory.resolvingSymlinksInPath()
  }
  private func modelFile(_ uri: String, partialAllowed: Bool) throws -> URL {
    guard let url = URL(string: uri), let components = URLComponents(url: url, resolvingAgainstBaseURL: false), url.isFileURL,
      (components.host ?? "").isEmpty, components.query == nil, components.fragment == nil else {
      throw Exception(name: "E_NEEDLE_PATH", description: "Needle needs its private local model file.")
    }
    let root = try directory().resolvingSymlinksInPath()
    let resolved = url.resolvingSymlinksInPath()
    guard resolved.deletingLastPathComponent().path == root.path,
      resolved.path == url.standardizedFileURL.path,
      resolved.lastPathComponent == NeedleBridge.filename() || (partialAllowed && resolved.lastPathComponent == NeedleBridge.filename() + ".part") else {
      throw Exception(name: "E_NEEDLE_PATH", description: "Needle model path is outside its private storage.")
    }
    return resolved
  }
  private func verifiedBytes(_ file: URL) throws -> Data? {
    let size = NeedleBridge.modelSize()
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
      attributes[.type] as? FileAttributeType == .typeRegular,
      (attributes[.size] as? NSNumber)?.intValue == size else { return nil }
    let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
    guard let data = try handle.read(upToCount: size + 1), data.count == size else { return nil }
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    return digest == NeedleBridge.modelSha() ? data : nil
  }
  public func definition() -> ModuleDefinition {
    Name("KeatingNeedle")
    Constants(["supported": NeedleBridge.supported(), "runtimeRevision": NeedleBridge.runtimeRevision(),
      "modelIdentity": NeedleBridge.modelIdentity().map { $0 as Any } ?? NSNull()])
    AsyncFunction("getModelDirectoryAsync") { () -> String in try self.directory().absoluteString }
    AsyncFunction("createModelFileAsync") { () -> String in
      let file = try self.directory().appendingPathComponent(NeedleBridge.filename() + ".part")
      guard file.resolvingSymlinksInPath().path == file.standardizedFileURL.path else { throw Exception(name: "E_NEEDLE_PATH", description: "Invalid Needle download path.") }
      if !FileManager.default.fileExists(atPath: file.path) {
        guard FileManager.default.createFile(atPath: file.path, contents: nil) else { throw Exception(name: "E_NEEDLE_FILE", description: "Could not create the model download.") }
      }
      return file.absoluteString
    }
    AsyncFunction("verifyModelFileAsync") { (uri: String, promise: Promise) in
      guard self.current(), Self.reserve() else { promise.reject("E_NEEDLE_BUSY", "Needle is busy or unavailable."); return }
      Self.worker.async {
        defer { Self.release() }
        do {
          let verified = try self.verifiedBytes(self.modelFile(uri, partialAllowed: true)) != nil
          if self.current() { promise.resolve(verified) } else { promise.reject("E_NEEDLE_STALE", "The native module was closed.") }
        } catch { promise.reject(error) }
      }
    }
    AsyncFunction("embedAsync") { (uri: String, texts: [String], promise: Promise) in
      guard self.current(), Self.reserve() else { promise.reject("E_NEEDLE_BUSY", "Needle is busy or unavailable."); return }
      Self.worker.async {
        defer { Self.release() }
        do {
          guard (1...16).contains(texts.count), texts.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !$0.contains("\0") && $0.utf8.count <= 4096 }), texts.reduce(0, { $0 + $1.utf8.count }) <= 16384 else {
            throw Exception(name: "E_NEEDLE_INPUT", description: "Needle input exceeds the text batch limits.")
          }
          guard let bytes = try self.verifiedBytes(self.modelFile(uri, partialAllowed: false)) else { throw Exception(name: "E_NEEDLE_MODEL", description: "Download and verify the Needle model first.") }
          let result = try NeedleBridge.embed(model: bytes, texts: texts)
          if self.current() { promise.resolve(result) } else { promise.reject("E_NEEDLE_STALE", "The native module was closed.") }
        } catch { promise.reject(error) }
      }
    }
    OnDestroy { self.lifecycle.lock(); self.closed = true; self.lifecycle.unlock() }
    // No unload/cancellation API exists; callers discard stale results. The
    // engine and verified backing bytes remain alive until the process exits.
  }
}
