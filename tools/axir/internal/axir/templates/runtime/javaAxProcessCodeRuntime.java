package dev.axllm.ax;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public final class AxProcessCodeRuntime implements AxCodeRuntime, AutoCloseable {
  private final Process process;
  private final BufferedWriter writer;
  private final BufferedReader reader;
  private final BufferedReader errorReader;
  private int nextId = 0;

  public AxProcessCodeRuntime(List<String> command) {
    this(command, null, Map.of());
  }

  public AxProcessCodeRuntime(List<String> command, File cwd, Map<String, String> env) {
    try {
      ProcessBuilder builder = new ProcessBuilder(command);
      if (cwd != null) builder.directory(cwd);
      if (env != null) builder.environment().putAll(env);
      this.process = builder.start();
      this.writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
      this.reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
      this.errorReader = new BufferedReader(new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8));
    } catch (Exception ex) {
      throw new RuntimeException("failed to start runtime protocol process: " + ex.getMessage(), ex);
    }
  }

  public String getUsageInstructions() {
    try {
      Map<String, Object> response = request("capabilities", null, Map.of(), true);
      Map<String, Object> result = Json.asObject(response.get("result"));
      return String.valueOf(result.getOrDefault("usage_instructions", ""));
    } catch (RuntimeException ex) {
      return "";
    }
  }

  public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("globals", globals == null ? Map.of() : globals);
    payload.put("options", options == null ? Map.of() : options);
    Map<String, Object> response = request("create_session", null, payload, true);
    Object sessionId = response.get("session_id");
    if (sessionId == null && response.get("result") instanceof Map<?, ?> result) sessionId = result.get("session_id");
    if (sessionId == null) throw new RuntimeException("runtime protocol did not return a session_id");
    return new AxProcessCodeSession(this, String.valueOf(sessionId));
  }

  synchronized Map<String, Object> request(String op, String sessionId, Map<String, Object> payload, boolean throwOnError) {
    try {
      Map<String, Object> message = new LinkedHashMap<>();
      message.put("id", String.valueOf(++nextId));
      message.put("op", op);
      message.put("payload", payload == null ? Map.of() : payload);
      if (sessionId != null) message.put("session_id", sessionId);
      writer.write(Json.stringify(message));
      writer.newLine();
      writer.flush();
      String line = reader.readLine();
      if (line == null) throw new RuntimeException(closedWithoutResponseMessage());
      Object parsed;
      try {
        parsed = Json.parse(line);
      } catch (RuntimeException ex) {
        throw new RuntimeException("runtime protocol invalid JSON response: " + ex.getMessage(), ex);
      }
      Map<String, Object> response;
      try {
        response = Json.asObject(parsed);
      } catch (RuntimeException ex) {
        throw new RuntimeException("runtime protocol response must be an object", ex);
      }
      if (!String.valueOf(message.get("id")).equals(String.valueOf(response.get("id")))) {
        throw new RuntimeException("runtime protocol response id mismatch");
      }
      if (sessionId != null && response.get("session_id") != null && !sessionId.equals(String.valueOf(response.get("session_id")))) {
        throw new RuntimeException("runtime protocol session_id mismatch");
      }
      if (Boolean.FALSE.equals(response.get("ok")) && throwOnError) {
        Map<String, Object> error = Json.asObject(response.get("error"));
        throw new RuntimeException(String.valueOf(error.getOrDefault("message", "runtime protocol error")));
      }
      return response;
    } catch (RuntimeException ex) {
      throw ex;
    } catch (Exception ex) {
      throw new RuntimeException("runtime protocol request failed: " + ex.getMessage(), ex);
    }
  }

  private String closedWithoutResponseMessage() {
    String message = "runtime protocol process closed without a response";
    if (process.isAlive()) {
      try {
        process.waitFor(100, TimeUnit.MILLISECONDS);
      } catch (InterruptedException ex) {
        Thread.currentThread().interrupt();
      }
    }
    if (!process.isAlive()) {
      message += " (exit code " + process.exitValue() + ")";
      StringBuilder stderr = new StringBuilder();
      try {
        String line;
        while ((line = errorReader.readLine()) != null) {
          if (stderr.length() > 0) stderr.append("\\n");
          stderr.append(line);
        }
      } catch (Exception ignored) {
      }
      if (stderr.length() > 0) message += ": " + stderr;
    }
    return message;
  }

  public void close() {
    try {
      request("shutdown", null, Map.of(), false);
    } catch (RuntimeException ignored) {
    } finally {
      process.destroy();
    }
  }
}
