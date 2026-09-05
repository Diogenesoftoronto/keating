package com.diogenesoftoronto.keating.devicekey

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

class KeatingDeviceKeyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KeatingDeviceKey")

    AsyncFunction("getOrCreatePublicJwkAsync") { alias: String ->
      requireAlias(alias)
      publicJwk(getOrCreatePublicKey(alias))
    }

    AsyncFunction("signAsync") { alias: String, payload: String ->
      requireAlias(alias)
      getOrCreatePublicKey(alias)
      val keyStore = keyStore()
      val privateKey = keyStore.getKey(alias, null)
      val signer = Signature.getInstance("SHA256withECDSA")
      signer.initSign(privateKey as java.security.PrivateKey)
      signer.update(payload.toByteArray(Charsets.UTF_8))
      base64Url(derToJose(signer.sign()))
    }

    AsyncFunction("deleteKeyAsync") { alias: String ->
      requireAlias(alias)
      val keyStore = keyStore()
      if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
    }
  }

  private fun requireAlias(alias: String) {
    require(alias.matches(Regex("[A-Za-z0-9._-]{1,120}"))) { "Invalid device-key alias" }
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun getOrCreatePublicKey(alias: String): ECPublicKey {
    val keyStore = keyStore()
    if (!keyStore.containsAlias(alias)) {
      val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
      generator.initialize(
        KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          .setDigests(KeyProperties.DIGEST_SHA256)
          .setUserAuthenticationRequired(false)
          .build()
      )
      generator.generateKeyPair()
    }
    return keyStore.getCertificate(alias).publicKey as ECPublicKey
  }

  private fun publicJwk(key: ECPublicKey): Map<String, String> = mapOf(
    "kty" to "EC",
    "crv" to "P-256",
    "x" to base64Url(fixedWidth(key.w.affineX)),
    "y" to base64Url(fixedWidth(key.w.affineY)),
  )

  private fun fixedWidth(value: BigInteger): ByteArray {
    val encoded = value.toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else it }
    return ByteArray(32).also { encoded.copyInto(it, 32 - encoded.size) }
  }

  private fun base64Url(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

  private fun derToJose(der: ByteArray): ByteArray {
    var offset = 0
    require(der[offset++].toInt() and 0xff == 0x30) { "Invalid ECDSA signature" }
    val sequence = readLength(der, offset)
    offset = sequence.second
    require(offset + sequence.first == der.size) { "Invalid ECDSA signature length" }
    require(der[offset++].toInt() and 0xff == 0x02) { "Invalid ECDSA R value" }
    val rLength = readLength(der, offset)
    offset = rLength.second
    val r = der.copyOfRange(offset, offset + rLength.first)
    offset += rLength.first
    require(der[offset++].toInt() and 0xff == 0x02) { "Invalid ECDSA S value" }
    val sLength = readLength(der, offset)
    offset = sLength.second
    val s = der.copyOfRange(offset, offset + sLength.first)
    return ByteArray(64).also {
      copyInteger(r, it, 0)
      copyInteger(s, it, 32)
    }
  }

  private fun readLength(bytes: ByteArray, start: Int): Pair<Int, Int> {
    val first = bytes[start].toInt() and 0xff
    if (first < 0x80) return first to start + 1
    val count = first and 0x7f
    require(count in 1..2) { "Invalid DER length" }
    var value = 0
    for (index in 0 until count) value = (value shl 8) or (bytes[start + 1 + index].toInt() and 0xff)
    return value to start + 1 + count
  }

  private fun copyInteger(source: ByteArray, target: ByteArray, targetOffset: Int) {
    val unsigned = source.dropWhile { it == 0.toByte() }.toByteArray()
    require(unsigned.size <= 32) { "ECDSA integer is too large" }
    unsigned.copyInto(target, targetOffset + 32 - unsigned.size)
  }
}
