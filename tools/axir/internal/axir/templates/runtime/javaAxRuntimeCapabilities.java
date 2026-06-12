package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public final class AxRuntimeCapabilities {
  public boolean inspect = true;
  public boolean snapshot = true;
  public boolean patch = true;
  public boolean abort = false;
  public String language = "JavaScript";
  public String usageInstructions = "";

  public AxRuntimeCapabilities inspect(boolean value) { this.inspect = value; return this; }
  public AxRuntimeCapabilities snapshot(boolean value) { this.snapshot = value; return this; }
  public AxRuntimeCapabilities patch(boolean value) { this.patch = value; return this; }
  public AxRuntimeCapabilities abort(boolean value) { this.abort = value; return this; }
  public AxRuntimeCapabilities language(String value) { this.language = value == null || value.isBlank() ? "JavaScript" : value; return this; }
  public AxRuntimeCapabilities usageInstructions(String value) { this.usageInstructions = value == null ? "" : value; return this; }

  public Map<String, Object> toMap() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("inspect", inspect);
    out.put("snapshot", snapshot);
    out.put("patch", patch);
    out.put("abort", abort);
    out.put("language", language);
    out.put("usage_instructions", usageInstructions);
    return out;
  }
}
