package com.diogenesoftoronto.keating.litert;

import com.google.ai.edge.litertlm.*;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Java isolates the official SDK's Kotlin 2.3 metadata from Expo's Kotlin 2.1
 * compiler. These are ordinary, statically checked JVM calls, not reflection or
 * skipped metadata checks. Its Gradle implementation dependency keeps newer
 * Kotlin metadata off Expo's compile classpath. Cancel runs concurrently.
 */
public final class LiteRTRunner {
  private Engine engine;
  private String enginePath;
  private Conversation conversation;
  private String activeId;
  private String lastCancelledId;
  private boolean cancelled;

  public synchronized boolean reserve(String id) {
    if (activeId != null) return false;
    activeId = id;
    cancelled = id.equals(lastCancelledId);
    return true;
  }
  public synchronized void finish() { activeId = null; conversation = null; }
  public synchronized void cancel(String id) {
    // Cancellation may arrive before Expo dispatches the async function body.
    lastCancelledId = id;
    if (id.equals(activeId)) {
      cancelled = true;
      if (conversation != null) conversation.cancelProcess();
    }
  }
  public synchronized void cancelActive() {
    cancelled = true;
    if (conversation != null) conversation.cancelProcess();
  }
  public void close() {
    if (engine != null) engine.close();
    engine = null;
    enginePath = null;
  }
  private void initialize(String path) {
    if (engine != null && path.equals(enginePath)) return;
    close();
    Engine gpu = new Engine(new EngineConfig(path, new Backend.GPU(), null, null, 4096, null, ":nocache"));
    try { gpu.initialize(); engine = gpu; }
    catch (Exception failure) {
      try { gpu.close(); } catch (Exception ignored) {}
      Engine cpu = new Engine(new EngineConfig(path, new Backend.CPU(null, null), null, null, 4096, null, ":nocache"));
      try { cpu.initialize(); engine = cpu; }
      catch (Exception error) { try { cpu.close(); } catch (Exception ignored) {} throw error; }
    }
    enginePath = path;
  }
  public String generate(String path, String system, String json, double temperature, Consumer<String> emit) throws Exception {
    synchronized (this) { if (cancelled) throw new CancellationException("Response stopped."); }
    initialize(path);
    JSONArray input = new JSONArray(json);
    if (input.length() == 0) throw new IllegalArgumentException("Send a text message first.");
    List<Message> messages = new ArrayList<>();
    for (int i = 0; i < input.length(); i++) {
      JSONObject item = input.getJSONObject(i);
      String role = item.getString("role");
      String content = item.getString("content");
      if (role.equals("user")) messages.add(Message.Companion.user(content));
      else if (role.equals("assistant")) messages.add(Message.Companion.model(content));
      else throw new IllegalArgumentException("Unsupported message role");
    }
    Map<String, Object> context = Collections.singletonMap("enable_thinking", false);
    ThinkingConfig thinking = new ThinkingConfig(false, -1);
    ConversationConfig config = new ConversationConfig(
      Contents.Companion.of(system), messages.subList(0, messages.size() - 1), Collections.emptyList(),
      new SamplerConfig(40, 0.95, temperature, 0), false, null, context, null, false, 1024, thinking, false);
    Conversation chat = engine.createConversation(config);
    try {
      CountDownLatch done = new CountDownLatch(1);
      StringBuilder output = new StringBuilder();
      AtomicReference<Throwable> failure = new AtomicReference<>();
      synchronized (this) {
        conversation = chat;
        if (cancelled) throw new CancellationException("Response stopped.");
        chat.sendMessageAsync(messages.get(messages.size() - 1), new MessageCallback() {
          @Override public void onMessage(Message message) {
            // Contents only; private channels are not exposed.
            String text = message.toString();
            output.append(text);
            if (!text.isEmpty()) emit.accept(text);
          }
          @Override public void onDone() { done.countDown(); }
          @Override public void onError(Throwable error) { failure.set(error); done.countDown(); }
        }, context, null, null, null, 1024, thinking);
      }
      try {
        done.await();
        synchronized (this) { if (cancelled) throw new CancellationException("Response stopped."); }
        if (failure.get() != null) throw new Exception(failure.get());
        return output.toString();
      } finally { synchronized (this) { conversation = null; } }
    } finally {
      // Clear under the cancellation lock before releasing the native handle,
      // including cancellation between engine initialization and message send.
      synchronized (this) { conversation = null; }
      chat.close();
    }
  }
}
