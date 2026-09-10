// Minimal process-isolated client of the official LiteRT-LM 0.16 C API.
// stdin is a JSON message, stdout is a JSON response. No shell or user file paths.
#include "engine.h"
#include "conversation.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#ifndef _WIN32
#include <fcntl.h>
#include <unistd.h>
#endif

int main(int argc, char **argv) {
  litert_lm_set_min_log_level(kLiteRtLmLogSeverityError);
  if (argc == 2 && strcmp(argv[1], "--probe") == 0) {
    LiteRtLmThinkingConfig *thinking = litert_lm_thinking_config_create();
    if (!thinking) return 2;
    litert_lm_thinking_config_set_enable_thinking(thinking, false);
    litert_lm_thinking_config_delete(thinking);
    puts("keating-litert-0.16.0");
    return 0;
  }
  if (argc != 4) { fputs("Invalid native argument count.\n", stderr); return 2; }
#ifndef _WIN32
  // Some process hosts (including Bun) inherit nonblocking pipe descriptors.
  int flags = fcntl(STDIN_FILENO, F_GETFL);
  if (flags >= 0) fcntl(STDIN_FILENO, F_SETFL, flags & ~O_NONBLOCK);
#endif
  char message[262145];
  size_t length = fread(message, 1, sizeof(message) - 1, stdin);
  if (ferror(stdin) || !feof(stdin) || length == 0) { fprintf(stderr, "Invalid native stdin payload (bytes=%zu, error=%d, eof=%d, errno=%d).\n", length, ferror(stdin), feof(stdin), errno); return 2; }
  message[length] = '\0';
  char *history = strchr(message, '\n');
  if (!history) { fputs("Missing history frame.\n", stderr); return 2; }
  *history++ = '\0';
  char *turn = strchr(history, '\n');
  if (!turn) { fputs("Missing user turn frame.\n", stderr); return 2; }
  *turn++ = '\0';
  LiteRtLmEngineSettings *settings = litert_lm_engine_settings_create(argv[1], "cpu", NULL, NULL);
  if (!settings) return 3;
  litert_lm_engine_settings_set_max_num_tokens(settings, 8192);
  LiteRtLmEngine *engine = litert_lm_engine_create(settings);
  litert_lm_engine_settings_delete(settings);
  if (!engine) { fputs("LiteRT could not initialize MiniCPM. Check available memory.\n", stderr); return 3; }
  LiteRtLmSessionConfig *session = litert_lm_session_config_create();
  litert_lm_session_config_set_max_output_tokens(session, atoi(argv[2]));
  float temperature = (float)atof(argv[3]);
  // CPU executor implements TopP only in 0.16. Its top-k=1 prefilter
  // implements deterministic selection without the unsupported Greedy enum.
  LiteRtLmSamplerParams *sampler = litert_lm_sampler_params_create(kLiteRtLmSamplerTypeTopP);
  litert_lm_sampler_params_set_temperature(sampler, temperature == 0 ? 1.0f : temperature);
  litert_lm_sampler_params_set_top_k(sampler, temperature == 0 ? 1 : 40);
  litert_lm_sampler_params_set_top_p(sampler, 0.95f);
  litert_lm_session_config_set_sampler_params(session, sampler);
  LiteRtLmConversationConfig *config = litert_lm_conversation_config_create();
  litert_lm_conversation_config_set_session_config(config, session);
  if (strcmp(message, "null") != 0) litert_lm_conversation_config_set_system_message(config, message);
  litert_lm_conversation_config_set_messages(config, history);
  LiteRtLmThinkingConfig *thinking = litert_lm_thinking_config_create();
  litert_lm_thinking_config_set_enable_thinking(thinking, false);
  litert_lm_thinking_config_set_thinking_token_budget(thinking, 0);
  litert_lm_conversation_config_set_thinking_config(config, thinking);
  LiteRtLmConversation *conversation = litert_lm_conversation_create(engine, config);
  LiteRtLmJsonResponse *response = conversation ? litert_lm_conversation_send_message(conversation, turn, NULL, NULL) : NULL;
  const char *json = response ? litert_lm_json_response_get_string(response) : NULL;
  int result = json ? 0 : 4;
  if (json) puts(json);
  else fputs("LiteRT could not generate a response. Try a shorter conversation.\n", stderr);
  if (response) litert_lm_json_response_delete(response);
  if (conversation) litert_lm_conversation_delete(conversation);
  litert_lm_thinking_config_delete(thinking);
  litert_lm_conversation_config_delete(config);
  litert_lm_sampler_params_delete(sampler);
  litert_lm_session_config_delete(session);
  litert_lm_engine_delete(engine);
  return result;
}
