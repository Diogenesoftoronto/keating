import CryptoKit
import ExpoModulesCore
import Foundation

/** Account keys never cross the native bridge. Handles die with the signed-in sync session. */
public final class KeatingSyncCryptoModule: Module {
  private var exchanges: [String: P256.KeyAgreement.PrivateKey] = [:]
  private var keys: [String: (SymmetricKey, SymmetricKey)] = [:]
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("KeatingSyncCrypto")
    AsyncFunction("beginAsync") { () -> [String: String] in
      self.lock.lock(); defer { self.lock.unlock() }
      let handle = UUID().uuidString
      let key = P256.KeyAgreement.PrivateKey()
      self.exchanges[handle] = key
      let publicBytes = key.publicKey.x963Representation
      return ["handle": handle, "x": self.encode(Data(publicBytes[1..<33])), "y": self.encode(Data(publicBytes[33..<65]))]
    }
    AsyncFunction("unlockAsync") { (handle: String, did: String, json: String) -> String in
      self.lock.lock(); defer { self.lock.unlock() }
      guard let key = self.exchanges.removeValue(forKey: handle),
        let envelope = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
        envelope["version"] as? Int == 1,
        let keyId = envelope["key_id"] as? String, keyId.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
        let jwk = envelope["server_public_jwk"] as? [String: Any], jwk["kty"] as? String == "EC", jwk["crv"] as? String == "P-256", jwk["d"] == nil,
        let x = jwk["x"] as? String, let y = jwk["y"] as? String,
        let salt = envelope["salt"] as? String, let iv = envelope["iv"] as? String,
        let ciphertext = envelope["ciphertext"] as? String
      else { throw self.failure() }
      let peer = try P256.KeyAgreement.PublicKey(x963Representation: Data([4]) + self.decode(x, 32) + self.decode(y, 32))
      let shared = try key.sharedSecretFromKeyAgreement(with: peer)
      let info = Data("notorganic-account-sync-wrap-v1:\(did):keating:\(keyId)".utf8)
      let wrapping = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: try self.decode(salt, 32), sharedInfo: info, outputByteCount: 32)
      let sealed = try self.decode(ciphertext, 48)
      let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: self.decode(iv, 12)), ciphertext: sealed.dropLast(16), tag: sealed.suffix(16))
      var raw = try AES.GCM.open(box, using: wrapping, authenticating: info)
      defer { raw.resetBytes(in: 0..<raw.count) }
      guard raw.count == 32, SHA256.hash(data: raw).map({ String(format: "%02x", $0) }).joined().hasPrefix(keyId) else { throw self.failure() }
      let accountKey = SymmetricKey(data: raw)
      let indexing = HKDF<SHA256>.deriveKey(inputKeyMaterial: accountKey, salt: Data(repeating: 0, count: 32), info: Data("keating-chat-content-index-v1".utf8), outputByteCount: 32)
      self.keys[handle] = (accountKey, indexing)
      return keyId
    }
    AsyncFunction("encryptAsync") { (handle: String, iv: String, aad: String, plaintext: String) -> String in
      self.lock.lock(); defer { self.lock.unlock() }
      guard let key = self.keys[handle] else { throw self.failure() }
      let box = try AES.GCM.seal(self.decodeBounded(plaintext, 32768), using: key.0, nonce: AES.GCM.Nonce(data: self.decode(iv, 12)), authenticating: self.decodeBounded(aad, 2048))
      return self.encode(box.ciphertext + box.tag)
    }
    AsyncFunction("decryptAsync") { (handle: String, iv: String, aad: String, ciphertext: String) -> String in
      self.lock.lock(); defer { self.lock.unlock() }
      guard let key = self.keys[handle] else { throw self.failure() }
      let sealed = try self.decodeBounded(ciphertext, 32784)
      guard sealed.count >= 16 else { throw self.failure() }
      let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: self.decode(iv, 12)), ciphertext: sealed.dropLast(16), tag: sealed.suffix(16))
      return self.encode(try AES.GCM.open(box, using: key.0, authenticating: self.decodeBounded(aad, 2048)))
    }
    AsyncFunction("hmacAsync") { (handle: String, bytes: String) -> String in
      self.lock.lock(); defer { self.lock.unlock() }
      guard let key = self.keys[handle] else { throw self.failure() }
      return self.encode(Data(HMAC<SHA256>.authenticationCode(for: try self.decodeBounded(bytes, 32768), using: key.1)))
    }
    AsyncFunction("releaseAsync") { (handle: String) in
      self.lock.lock(); defer { self.lock.unlock() }
      self.exchanges.removeValue(forKey: handle); self.keys.removeValue(forKey: handle)
    }
  }
  private func failure() -> Exception { Exception(name: "ERR_SYNC_CRYPTO", description: "Account sync key or encrypted record is invalid") }
  private func encode(_ bytes: Data) -> String { bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
  private func decodeBounded(_ value: String, _ maximum: Int) throws -> Data {
    guard value.count <= ((maximum * 4 + 2) / 3), value.range(of: "^[A-Za-z0-9_-]*$", options: .regularExpression) != nil else { throw failure() }
    let padded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - value.count % 4) % 4)
    guard let bytes = Data(base64Encoded: padded), bytes.count <= maximum else { throw failure() }
    return bytes
  }
  private func decode(_ value: String, _ size: Int) throws -> Data {
    let bytes = try decodeBounded(value, size)
    guard bytes.count == size else { throw failure() }
    return bytes
  }
}
