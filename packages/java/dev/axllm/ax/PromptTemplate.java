package dev.axllm.ax;

import java.util.List;
import java.util.Map;

public final class PromptTemplate {
  private final AxSignature signature;
  private final List<Tool> tools;
  private final String structuredOutputFunctionName;
  private final String customTemplate;
  private String instruction;

  public PromptTemplate(AxSignature signature, List<Tool> tools) {
    this(signature, tools, null, null);
  }

  public PromptTemplate(AxSignature signature, List<Tool> tools, String structuredOutputFunctionName, String customTemplate) {
    this.signature = signature;
    this.tools = tools == null ? List.of() : List.copyOf(tools);
    this.structuredOutputFunctionName = structuredOutputFunctionName;
    this.customTemplate = customTemplate;
  }

  public void setInstruction(String instruction) { this.instruction = instruction; }

  public List<Map<String, Object>> render(Map<String, Object> values) {
    java.util.Map<String, Object> options = new java.util.LinkedHashMap<>();
    if (instruction != null) options.put("instruction", instruction);
    if (structuredOutputFunctionName != null) options.put("structured_output_function_name", structuredOutputFunctionName);
    if (customTemplate != null) options.put("custom_template", customTemplate);
    return Core.asMapList(Core.render_prompt(signature, values == null ? java.util.Map.of() : values, tools, options));
  }
}
