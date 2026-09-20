#pragma once
#include "needle.h"
#include "needle_assets.h"
#include <cmath>
#include <cstdint>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

namespace keating_needle {
// The published engine is process-global and has no unload/cancel operation.
// Keep the verified backing bytes alive and serialize all calls for its lifetime.
inline std::mutex engine_mutex;
inline std::vector<unsigned char> weights;
inline bool loaded = false;
inline bool poisoned = false;
inline std::vector<std::vector<float>> embed(const unsigned char* verified_bytes, size_t size,
                                            const std::vector<std::string>& texts) {
  std::lock_guard<std::mutex> lock(engine_mutex);
  if (poisoned) throw std::runtime_error("Needle initialization failed; restart the app before retrying.");
  if (size != KEATING_NEEDLE_MODEL_BYTES) throw std::runtime_error("Invalid Needle model size.");
  if (texts.empty() || texts.size() > 16) throw std::runtime_error("Needle accepts 1 to 16 texts.");
  size_t total = 0;
  for (const auto& text : texts) {
    total += text.size();
    if (text.empty() || text.size() > 4096 || text.find('\0') != std::string::npos)
      throw std::runtime_error("Invalid Needle input text.");
  }
  if (total > 16384) throw std::runtime_error("Needle input batch is too large.");
  if (!loaded) {
    weights.assign(verified_bytes, verified_bytes + size);
    poisoned = true;
    if (needle_load(weights.data(), weights.size()) < 0 || needle_init("", "[]", nullptr) < 0)
      throw std::runtime_error("Needle could not initialize the verified model.");
    loaded = true; poisoned = false;
  }
  const int dimension = needle_embed("", nullptr, 0);
  if (dimension < 1 || dimension > 4096) throw std::runtime_error("Needle returned an invalid embedding dimension.");
  std::vector<std::vector<float>> result;
  for (const auto& text : texts) {
    std::vector<float> vector(static_cast<size_t>(dimension));
    const int count = needle_embed(text.c_str(), vector.data(), dimension);
    if (count != dimension) throw std::runtime_error("Needle returned an incomplete embedding.");
    for (const float value : vector) if (!std::isfinite(value)) throw std::runtime_error("Needle returned a nonfinite embedding.");
    result.push_back(std::move(vector));
  }
  return result;
}
}
