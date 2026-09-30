package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class PromptTemplate {
  private final AxSignature signature;
  private final List<Tool> tools;
  private final String structuredOutputFunctionName;
  private final String customTemplate;
  // TS includeOptionalInputFieldsInSystemPrompt: the system prompt lists every
  // input field, provided or not. Off by default.
  private final boolean includeOptionalInputFieldsInSystemPrompt;
  private String instruction;

  public PromptTemplate(AxSignature signature, List<Tool> tools) {
    this(signature, tools, null, null);
  }

  public PromptTemplate(AxSignature signature, List<Tool> tools, String structuredOutputFunctionName, String customTemplate) {
    this(signature, tools, structuredOutputFunctionName, customTemplate, false);
  }

  public PromptTemplate(AxSignature signature, List<Tool> tools, String structuredOutputFunctionName, String customTemplate, boolean includeOptionalInputFieldsInSystemPrompt) {
    this.signature = signature;
    this.tools = tools == null ? List.of() : List.copyOf(tools);
    this.structuredOutputFunctionName = structuredOutputFunctionName;
    this.customTemplate = customTemplate;
    this.includeOptionalInputFieldsInSystemPrompt = includeOptionalInputFieldsInSystemPrompt;
  }

  public void setInstruction(String instruction) { this.instruction = instruction; }

  public List<Map<String, Object>> render(Map<String, Object> values) {
    return render(values, null);
  }

  /**
   * Renders with per-render options, as AxGen renders for the selected structured-output rung. They
   * win over the template's own: {@code structured_output} decides whether the prompt asks for
   * structured output (the exact JSON shape and the JSON formatting rule) instead of the
   * signature's complex fields, {@code structured_output_function_name} names the output function,
   * and {@code extra_functions} ({name, description} maps) are listed after the template's
   * functions. Without options the render is as before.
   */
  public List<Map<String, Object>> render(Map<String, Object> values, Map<String, Object> renderOptions) {
    Map<String, Object> options = new LinkedHashMap<>(renderOptions == null ? Map.of() : renderOptions);
    if (instruction != null) options.put("instruction", instruction);
    if (structuredOutputFunctionName != null && options.get("structured_output_function_name") == null) options.put("structured_output_function_name", structuredOutputFunctionName);
    if (customTemplate != null) options.put("custom_template", customTemplate);
    if (includeOptionalInputFieldsInSystemPrompt) options.putIfAbsent("include_optional_input_fields_in_system_prompt", true);
    List<Object> functions = new ArrayList<>(tools);
    functions.addAll(Core.asList(options.remove("extra_functions")));
    return Core.asMapList(Core.render_prompt(signature, values == null ? Map.of() : values, functions, options));
  }
}
