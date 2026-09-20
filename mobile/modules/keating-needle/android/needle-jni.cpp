#include <jni.h>
#include "needle_assets.h"
#if defined(__aarch64__)
#include "../cpp/NeedleEngine.hpp"
#endif
#define JNI_METHOD(name) Java_com_diogenesoftoronto_keating_needle_NeedleNative_##name
extern "C" JNIEXPORT jboolean JNICALL JNI_METHOD(supported)(JNIEnv*, jclass) {
#if defined(__aarch64__)
  return JNI_TRUE;
#else
  return JNI_FALSE;
#endif
}
extern "C" JNIEXPORT jstring JNICALL JNI_METHOD(revision)(JNIEnv* env, jclass) { return env->NewStringUTF(KEATING_NEEDLE_REVISION); }
extern "C" JNIEXPORT jstring JNICALL JNI_METHOD(identity)(JNIEnv* env, jclass) {
#if defined(__aarch64__)
  return env->NewStringUTF(KEATING_NEEDLE_ID_ANDROID_ARM64);
#else
  return nullptr;
#endif
}
extern "C" JNIEXPORT jstring JNICALL JNI_METHOD(filename)(JNIEnv* env, jclass) { return env->NewStringUTF(KEATING_NEEDLE_FILENAME); }
extern "C" JNIEXPORT jstring JNICALL JNI_METHOD(modelSha)(JNIEnv* env, jclass) { return env->NewStringUTF(KEATING_NEEDLE_MODEL_SHA); }
extern "C" JNIEXPORT jint JNICALL JNI_METHOD(modelSize)(JNIEnv*, jclass) { return KEATING_NEEDLE_MODEL_BYTES; }
extern "C" JNIEXPORT jobjectArray JNICALL JNI_METHOD(embed)(JNIEnv* env, jclass, jbyteArray model, jobjectArray inputs) {
#if defined(__aarch64__)
  jbyte* bytes = nullptr;
  try {
    if (!model || !inputs || env->GetArrayLength(model) != KEATING_NEEDLE_MODEL_BYTES) throw std::runtime_error("Invalid Needle model.");
    const auto count = env->GetArrayLength(inputs);
    if (count < 1 || count > 16) throw std::runtime_error("Invalid Needle batch size.");
    std::vector<std::string> texts;
    for (jsize index = 0; index < count; ++index) {
      const auto input = static_cast<jbyteArray>(env->GetObjectArrayElement(inputs, index));
      if (!input) throw std::runtime_error("Invalid Needle text.");
      const auto size = env->GetArrayLength(input);
      if (size < 1 || size > 4096) { env->DeleteLocalRef(input); throw std::runtime_error("Invalid Needle text size."); }
      std::string text(static_cast<size_t>(size), '\0');
      env->GetByteArrayRegion(input, 0, size, reinterpret_cast<jbyte*>(text.data()));
      env->DeleteLocalRef(input);
      if (env->ExceptionCheck()) return nullptr;
      texts.push_back(std::move(text));
    }
    bytes = env->GetByteArrayElements(model, nullptr);
    if (!bytes) return nullptr;
    const auto vectors = keating_needle::embed(reinterpret_cast<const unsigned char*>(bytes), KEATING_NEEDLE_MODEL_BYTES, texts);
    env->ReleaseByteArrayElements(model, bytes, JNI_ABORT); bytes = nullptr;
    const auto floatArrayClass = env->FindClass("[F");
    if (!floatArrayClass) return nullptr;
    const auto result = env->NewObjectArray(count, floatArrayClass, nullptr);
    env->DeleteLocalRef(floatArrayClass);
    if (!result) return nullptr;
    for (jsize index = 0; index < count; ++index) {
      const auto& vector = vectors[index];
      const auto row = env->NewFloatArray(static_cast<jsize>(vector.size()));
      if (!row) return nullptr;
      env->SetFloatArrayRegion(row, 0, static_cast<jsize>(vector.size()), vector.data());
      env->SetObjectArrayElement(result, index, row); env->DeleteLocalRef(row);
      if (env->ExceptionCheck()) return nullptr;
    }
    return result;
  } catch (const std::exception& error) {
    if (bytes) env->ReleaseByteArrayElements(model, bytes, JNI_ABORT);
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.what()); return nullptr;
  }
#else
  env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Needle needs an ARM64 Android build."); return nullptr;
#endif
}
