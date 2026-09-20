#pragma once
#ifdef __cplusplus
extern "C" {
#endif
void *keating_label_scorer_create(void);
void keating_label_scorer_delete(void *handle);
void keating_label_scorer_cancel(void *handle, const char *request_id);
// Returns 0 only when every independent candidate has a finite positive NLL.
int keating_label_scorer_score(void *handle, const char *request_id,
  const char *model_path, const char *message_json, int count, float *scores);
#ifdef __cplusplus
}
#endif
