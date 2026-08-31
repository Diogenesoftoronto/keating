import CryptoKit
import ExpoModulesCore
import Security

public final class KeatingDeviceKeyModule: Module {
  private let service = "com.diogenesoftoronto.keating.device-key"

  public func definition() -> ModuleDefinition {
    Name("KeatingDeviceKey")

    AsyncFunction("getOrCreatePublicJwkAsync") { (alias: String) -> [String: String] in
      try self.validate(alias)
      return try self.publicJwk(for: self.key(for: alias))
    }

    AsyncFunction("signAsync") { (alias: String, payload: String) -> String in
      try self.validate(alias)
      let bytes = Data(payload.utf8)
      let signature: Data
      switch try self.key(for: alias) {
      case .secureEnclave(let key): signature = try key.signature(for: bytes).rawRepresentation
      case .software(let key): signature = try key.signature(for: bytes).rawRepresentation
      }
      return signature.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    AsyncFunction("deleteKeyAsync") { (alias: String) in
      try self.validate(alias)
      let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: self.service, kSecAttrAccount as String: alias]
      SecItemDelete(query as CFDictionary)
    }
  }

  private enum SigningKey {
    case secureEnclave(SecureEnclave.P256.Signing.PrivateKey)
    case software(P256.Signing.PrivateKey)
  }

  private func validate(_ alias: String) throws {
    guard alias.range(of: "^[A-Za-z0-9._-]{1,120}$", options: .regularExpression) != nil else {
      throw Exception(name: "ERR_INVALID_KEY_ALIAS", description: "Invalid device-key alias")
    }
  }

  private func key(for alias: String) throws -> SigningKey {
    if let stored = try load(alias) {
      guard let kind = stored.first else { throw Exception(name: "ERR_INVALID_KEY", description: "Stored device key is invalid") }
      let material = stored.dropFirst()
      if kind == 1 { return .secureEnclave(try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: material)) }
      if kind == 2 { return .software(try P256.Signing.PrivateKey(rawRepresentation: material)) }
      throw Exception(name: "ERR_INVALID_KEY", description: "Stored device key has an unknown format")
    }
    if SecureEnclave.isAvailable {
      let key = try SecureEnclave.P256.Signing.PrivateKey()
      try save(Data([1]) + key.dataRepresentation, alias: alias)
      return .secureEnclave(key)
    }
    let key = P256.Signing.PrivateKey()
    try save(Data([2]) + key.rawRepresentation, alias: alias)
    return .software(key)
  }

  private func publicJwk(for key: SigningKey) throws -> [String: String] {
    let representation: Data
    switch key {
    case .secureEnclave(let value): representation = value.publicKey.x963Representation
    case .software(let value): representation = value.publicKey.x963Representation
    }
    guard representation.count == 65 && representation.first == 4 else {
      throw Exception(name: "ERR_INVALID_KEY", description: "P-256 public key is invalid")
    }
    let x = representation[1..<33].base64Url
    let y = representation[33..<65].base64Url
    return ["kty": "EC", "crv": "P-256", "x": x, "y": y]
  }

  private func load(_ alias: String) throws -> Data? {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: alias, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw Exception(name: "ERR_KEYCHAIN", description: "Could not read the device key") }
    return data
  }

  private func save(_ data: Data, alias: String) throws {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: alias, kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw Exception(name: "ERR_KEYCHAIN", description: "Could not store the device key") }
  }
}

private extension Data.SubSequence {
  var base64Url: String {
    Data(self).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}
