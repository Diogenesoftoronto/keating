// Closed candidate likelihoods from the official LiteRT-LM scoring API.
// stdin: decimal candidate count, newline, then a JSON user message.
// stdout: negative log likelihoods for "0", "1", ... in that order.
#include "label-scorer.h"
#include "engine.h"
#include "conversation.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <fcntl.h>
#include <unistd.h>
#endif

int keating_score_labels(const char *model_path) {
#ifndef _WIN32
  int flags = fcntl(STDIN_FILENO, F_GETFL);
  if (flags >= 0) fcntl(STDIN_FILENO, F_SETFL, flags & ~O_NONBLOCK);
#endif
  char wire[150001];
  size_t length = fread(wire, 1, sizeof(wire) - 1, stdin);
  if (ferror(stdin) || !feof(stdin) || !length || memchr(wire, '\0', length)) return 2;
  wire[length] = '\0';
  char *end;
  long count = strtol(wire, &end, 10);
  if (end == wire || *end != '\n' || count < 2 || count > 64 || !end[1]) return 2;
  const char *message = end + 1;
  int result = 3;
  float scores[64];
  LiteRtLmEngineSettings *settings = litert_lm_engine_settings_create(model_path, "cpu", NULL, NULL);
  if (!settings) return result;
  litert_lm_engine_settings_set_max_num_tokens(settings, 8192);
  LiteRtLmEngine *engine = litert_lm_engine_create(settings);
  litert_lm_engine_settings_delete(settings);
  if (!engine) return result;
  LiteRtLmSessionConfig *config = litert_lm_session_config_create();
  LiteRtLmConversationConfig *conversation_config = litert_lm_conversation_config_create();
  LiteRtLmThinkingConfig *thinking = litert_lm_thinking_config_create();
  LiteRtLmConversation *conversation = NULL;
  LiteRtLmInputData *input = NULL;
  char *prompt = NULL;
  if (!config || !conversation_config || !thinking) goto cleanup;
  litert_lm_thinking_config_set_enable_thinking(thinking, false);
  litert_lm_thinking_config_set_thinking_token_budget(thinking, 0);
  litert_lm_conversation_config_set_messages(conversation_config, "[]");
  litert_lm_conversation_config_set_thinking_config(conversation_config, thinking);
  conversation = litert_lm_conversation_create(engine, conversation_config);
  if (!conversation) goto cleanup;
  // A fresh conversation renders the full first turn including its generation
  // prefix. Rendering an empty preface separately is unsupported by MiniCPM's
  // template and would duplicate the prefix for full-history templates.
  const char *turn = litert_lm_conversation_render_message_to_string(conversation, message);
  if (!turn || strlen(turn) > 160000) goto cleanup;
  prompt = malloc(strlen(turn) + 1);
  if (!prompt) goto cleanup;
  strcpy(prompt, turn);
  // The conversation renderer applies the model's own chat template once.
  litert_lm_session_config_set_apply_prompt_template(config, false);
  input = litert_lm_input_data_create(kLiteRtLmInputDataTypeText, prompt, strlen(prompt));
  if (!input) goto cleanup;
  const LiteRtLmInputData *inputs[] = {input};
  for (int i = 0; i < count; i++) {
    // Scoring consumes target tokens. Fresh sessions keep candidates independent
    // and avoid relying on executor-specific checkpoint/rewind support.
    LiteRtLmSession *session = litert_lm_engine_create_session(engine, config);
    if (!session) goto cleanup;
    if (litert_lm_session_run_prefill(session, inputs, 1) != 0) {
      litert_lm_session_delete(session);
      goto cleanup;
    }
    char candidate[4];
    snprintf(candidate, sizeof(candidate), "%d", i);
    const char *targets[] = {candidate};
    LiteRtLmResponses *response = litert_lm_session_run_text_scoring(session, targets, 1, true);
    int valid = response && litert_lm_responses_has_score_at(response, 0);
    // v0.16 CPU scoring accumulates log(P(token)), despite the public engine.h
    // comment calling it negative log probability. Expose positive NLL on IPC.
    scores[i] = valid ? -litert_lm_responses_get_score_at(response, 0) : -1;
    if (response) litert_lm_responses_delete(response);
    litert_lm_session_delete(session);
    if (!valid || !isfinite(scores[i]) || scores[i] < 0) {
      fprintf(stderr, "Invalid native score at %d (present=%d, value=%.9g).\n", i, valid, scores[i]);
      goto cleanup;
    }
  }
  putchar('[');
  for (int i = 0; i < count; i++) printf("%s%.9g", i ? "," : "", scores[i]);
  puts("]");
  result = 0;
cleanup:
  if (input) litert_lm_input_data_delete(input);
  free(prompt);
  if (conversation) litert_lm_conversation_delete(conversation);
  if (thinking) litert_lm_thinking_config_delete(thinking);
  if (conversation_config) litert_lm_conversation_config_delete(conversation_config);
  if (config) litert_lm_session_config_delete(config);
  litert_lm_engine_delete(engine);
  return result;
}
