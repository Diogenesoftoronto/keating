// Same CPU likelihood semantics as desktop/native/label-scorer.c, LiteRT 0.16.0.
#include "label-scorer.h"
#if __has_include(<CLiteRTLM/engine.h>)
#include <CLiteRTLM/engine.h>
#include <CLiteRTLM/conversation.h>
#else
#include "engine.h"
#include "conversation.h"
#endif
#include <cmath>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>

struct Scorer {
  std::mutex mutex;
  std::string active, cancelled;
  LiteRtLmSession *session = nullptr;
  bool stopped(const std::string &id) { std::lock_guard<std::mutex> guard(mutex); return cancelled == id; }
};
void *keating_label_scorer_create() { return new Scorer(); }
void keating_label_scorer_delete(void *handle) { delete static_cast<Scorer *>(handle); }
void keating_label_scorer_cancel(void *handle, const char *id) {
  if (!handle || !id) return;
  auto &state = *static_cast<Scorer *>(handle);
  std::lock_guard<std::mutex> guard(state.mutex);
  state.cancelled = id;
  if (state.active == id && state.session) litert_lm_session_cancel_process(state.session);
}
int keating_label_scorer_score(void *handle, const char *id, const char *path, const char *message, int count, float *scores) {
  if (!handle || !id || !*id || std::strlen(id) > 128 || !path || !message || !scores || count < 2 || count > 64 || std::strlen(message) > 150000) return 1;
  auto &state = *static_cast<Scorer *>(handle);
  {
    std::lock_guard<std::mutex> guard(state.mutex);
    if (!state.active.empty() || state.cancelled == id) return 2;
    state.active = id;
  }
  struct Active { Scorer &state; ~Active() { std::lock_guard<std::mutex> guard(state.mutex); state.session = nullptr; state.active.clear(); } } active{state};
  auto settings = std::unique_ptr<LiteRtLmEngineSettings, decltype(&litert_lm_engine_settings_delete)>(litert_lm_engine_settings_create(path, "cpu", nullptr, nullptr), litert_lm_engine_settings_delete);
  if (!settings) return 1;
  litert_lm_engine_settings_set_max_num_tokens(settings.get(), 8192);
  litert_lm_engine_settings_set_cache_dir(settings.get(), ":nocache");
  auto engine = std::unique_ptr<LiteRtLmEngine, decltype(&litert_lm_engine_delete)>(litert_lm_engine_create(settings.get()), litert_lm_engine_delete);
  if (!engine || state.stopped(id)) return 2;
  auto config = std::unique_ptr<LiteRtLmSessionConfig, decltype(&litert_lm_session_config_delete)>(litert_lm_session_config_create(), litert_lm_session_config_delete);
  auto chatConfig = std::unique_ptr<LiteRtLmConversationConfig, decltype(&litert_lm_conversation_config_delete)>(litert_lm_conversation_config_create(), litert_lm_conversation_config_delete);
  auto thinking = std::unique_ptr<LiteRtLmThinkingConfig, decltype(&litert_lm_thinking_config_delete)>(litert_lm_thinking_config_create(), litert_lm_thinking_config_delete);
  if (!config || !chatConfig || !thinking) return 1;
  litert_lm_thinking_config_set_enable_thinking(thinking.get(), false);
  litert_lm_thinking_config_set_thinking_token_budget(thinking.get(), 0);
  litert_lm_conversation_config_set_messages(chatConfig.get(), "[]");
  litert_lm_conversation_config_set_thinking_config(chatConfig.get(), thinking.get());
  auto chat = std::unique_ptr<LiteRtLmConversation, decltype(&litert_lm_conversation_delete)>(litert_lm_conversation_create(engine.get(), chatConfig.get()), litert_lm_conversation_delete);
  if (!chat) return 1;
  const char *rendered = litert_lm_conversation_render_message_to_string(chat.get(), message);
  if (!rendered || std::strlen(rendered) > 160000) return 1;
  std::string prompt(rendered);
  litert_lm_session_config_set_apply_prompt_template(config.get(), false);
  auto input = std::unique_ptr<LiteRtLmInputData, decltype(&litert_lm_input_data_delete)>(litert_lm_input_data_create(kLiteRtLmInputDataTypeText, prompt.data(), prompt.size()), litert_lm_input_data_delete);
  if (!input) return 1;
  const LiteRtLmInputData *inputs[] = {input.get()};
  for (int i = 0; i < count; ++i) {
    if (state.stopped(id)) return 2;
    auto session = std::unique_ptr<LiteRtLmSession, decltype(&litert_lm_session_delete)>(litert_lm_engine_create_session(engine.get(), config.get()), litert_lm_session_delete);
    if (!session) return 1;
    struct Current { Scorer &state; ~Current() { std::lock_guard<std::mutex> guard(state.mutex); state.session = nullptr; } } current{state};
    { std::lock_guard<std::mutex> guard(state.mutex); state.session = session.get(); }
    if (state.stopped(id) || litert_lm_session_run_prefill(session.get(), inputs, 1) != 0 || state.stopped(id)) return 2;
    const auto label = std::to_string(i); const char *targets[] = {label.c_str()};
    auto response = std::unique_ptr<LiteRtLmResponses, decltype(&litert_lm_responses_delete)>(litert_lm_session_run_text_scoring(session.get(), targets, 1, true), litert_lm_responses_delete);
    if (state.stopped(id)) return 2;
    if (!response || !litert_lm_responses_has_score_at(response.get(), 0)) return 1;
    // Pinned 0.16 CPU reports sum log(P(token)); convert to nonnegative NLL.
    scores[i] = -litert_lm_responses_get_score_at(response.get(), 0);
    if (!std::isfinite(scores[i]) || scores[i] < 0) return 1;
  }
  return state.stopped(id) ? 2 : 0;
}
