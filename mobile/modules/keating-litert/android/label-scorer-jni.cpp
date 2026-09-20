#include <jni.h>
#include "../cpp/label-scorer.h"
#include <string>
#include <vector>

static void *scorer = keating_label_scorer_create();
// Receive real UTF-8 bytes; JNI modified UTF-8 would corrupt supplementary text.
extern "C" JNIEXPORT jfloatArray JNICALL Java_com_diogenesoftoronto_keating_litert_KeatingLabelScorer_score(JNIEnv *env, jobject, jstring request, jbyteArray path, jbyteArray message, jint count) {
  if (!path || !message || !request || count < 2 || count > 64 || env->GetArrayLength(message) > 150000) return nullptr;
  const char *id = env->GetStringUTFChars(request, nullptr);
  if (!id) return nullptr;
  auto bytes = [env](jbyteArray value) { std::string result(env->GetArrayLength(value), '\0'); env->GetByteArrayRegion(value, 0, result.size(), reinterpret_cast<jbyte *>(result.data())); return result; };
  const auto model = bytes(path), prompt = bytes(message);
  std::vector<float> scores(count);
  int status = 1;
  if (model.find('\0') == std::string::npos && prompt.find('\0') == std::string::npos) status = keating_label_scorer_score(scorer, id, model.c_str(), prompt.c_str(), count, scores.data());
  env->ReleaseStringUTFChars(request, id);
  if (status != 0) return nullptr;
  auto result = env->NewFloatArray(count);
  if (result) env->SetFloatArrayRegion(result, 0, count, scores.data());
  return result;
}
extern "C" JNIEXPORT void JNICALL Java_com_diogenesoftoronto_keating_litert_KeatingLabelScorer_cancel(JNIEnv *env, jobject, jstring request) {
  if (!request) return;
  const char *id = env->GetStringUTFChars(request, nullptr);
  if (id) { keating_label_scorer_cancel(scorer, id); env->ReleaseStringUTFChars(request, id); }
}
