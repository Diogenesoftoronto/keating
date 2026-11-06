package com.diogenesoftoronto.keating.devicekey

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.math.BigInteger
import java.security.*
import java.security.interfaces.ECPublicKey
import java.security.spec.*
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.util.UUID

/** Ephemeral native handles: neither the account key nor its indexing key is exported to JS. */
class KeatingSyncCryptoModule : Module() {
  private val exchanges = mutableMapOf<String, KeyPair>()
  private val keys = mutableMapOf<String, Pair<ByteArray, ByteArray>>()
  private val lock = Any()
  override fun definition() = ModuleDefinition {
    Name("KeatingSyncCrypto")
    AsyncFunction("beginAsync") { synchronized(lock) {
      val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
      val handle = UUID.randomUUID().toString()
      exchanges[handle] = pair
      val publicKey = pair.public as ECPublicKey
      mapOf("handle" to handle, "x" to encode(coordinate(publicKey.w.affineX)), "y" to encode(coordinate(publicKey.w.affineY)))
    } }
    AsyncFunction("unlockAsync") { handle: String, did: String, json: String -> synchronized(lock) {
      val pair = exchanges.remove(handle) ?: error("Sync exchange expired")
      val envelope = org.json.JSONObject(json)
      require(envelope.getInt("version") == 1)
      val keyId = envelope.getString("key_id")
      require(keyId.matches(Regex("[a-f0-9]{32}")))
      val jwk = envelope.getJSONObject("server_public_jwk")
      require(jwk.getString("kty") == "EC" && jwk.getString("crv") == "P-256" && !jwk.has("d"))
      val point = ECPoint(BigInteger(1, decode(jwk.getString("x"), 32)), BigInteger(1, decode(jwk.getString("y"), 32)))
      val peer = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, (pair.public as ECPublicKey).params))
      val shared = KeyAgreement.getInstance("ECDH").run { init(pair.private); doPhase(peer, true); generateSecret() }
      val info = "notorganic-account-sync-wrap-v1:$did:keating:$keyId".toByteArray(Charsets.UTF_8)
      val wrapping = hkdf(shared, decode(envelope.getString("salt"), 32), info)
      shared.fill(0)
      val raw = try { crypt(Cipher.DECRYPT_MODE, wrapping, decode(envelope.getString("iv"), 12), info, decode(envelope.getString("ciphertext"), 48)) } finally { wrapping.fill(0) }
      try {
        require(raw.size == 32 && MessageDigest.getInstance("SHA-256").digest(raw).joinToString("") { "%02x".format(it) }.take(32) == keyId)
        keys[handle] = raw.copyOf() to hkdf(raw, ByteArray(32), "keating-chat-content-index-v1".toByteArray(Charsets.UTF_8))
      } finally { raw.fill(0) }
      keyId
    } }
    AsyncFunction("encryptAsync") { handle: String, iv: String, aad: String, plaintext: String -> synchronized(lock) {
      encode(crypt(Cipher.ENCRYPT_MODE, requireKey(handle).first, decode(iv, 12), decodeBounded(aad, 2048), decodeBounded(plaintext, 32768)))
    } }
    AsyncFunction("decryptAsync") { handle: String, iv: String, aad: String, ciphertext: String -> synchronized(lock) {
      encode(crypt(Cipher.DECRYPT_MODE, requireKey(handle).first, decode(iv, 12), decodeBounded(aad, 2048), decodeBounded(ciphertext, 32784)))
    } }
    AsyncFunction("hmacAsync") { handle: String, bytes: String -> synchronized(lock) {
      encode(hmac(requireKey(handle).second, decodeBounded(bytes, 32768)))
    } }
    AsyncFunction("releaseAsync") { handle: String -> synchronized(lock) {
      exchanges.remove(handle)
      keys.remove(handle)?.let { it.first.fill(0); it.second.fill(0) }
      Unit
    } }
  }
  private fun requireKey(handle: String) = keys[handle] ?: error("Account sync is locked")
  private fun hmac(key: ByteArray, bytes: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); doFinal(bytes) }
  private fun hkdf(input: ByteArray, salt: ByteArray, info: ByteArray): ByteArray {
    val extracted = hmac(salt, input)
    return try { hmac(extracted, info + byteArrayOf(1)) } finally { extracted.fill(0) }
  }
  private fun crypt(mode: Int, key: ByteArray, iv: ByteArray, aad: ByteArray, input: ByteArray): ByteArray = Cipher.getInstance("AES/GCM/NoPadding").run {
    init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv)); updateAAD(aad); doFinal(input)
  }
  private fun coordinate(value: BigInteger): ByteArray {
    val bytes = value.toByteArray().takeLast(32).toByteArray()
    return ByteArray(32).also { bytes.copyInto(it, 32 - bytes.size) }
  }
  private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  private fun decodeBounded(value: String, maximum: Int): ByteArray {
    require(value.length <= (maximum * 4 + 2) / 3 && value.matches(Regex("[A-Za-z0-9_-]*")))
    return Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING).also { require(it.size <= maximum) }
  }
  private fun decode(value: String, size: Int): ByteArray = decodeBounded(value, size).also { require(it.size == size) }
}
