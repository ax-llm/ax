import dev.axllm.ax.*;

public class FlowMermaidExample {
  public static void main(String[] args) {
    String source = String.join("\n",
        "flowchart TD",
        "  %%ax classify: requestText:string -> route:class \"support, sales\"",
        "  %%ax reply: requestText:string -> replyText:string(max 300)",
        "  classify{route} -->|support| reply");
    AxFlow program = Ax.flow(source);
    String rendered = program.toString();
    if (!rendered.contains("%%ax reply: requestText:string -> replyText:string(max 300)")) throw new AssertionError(rendered);
    if (!rendered.contains("classify -->|support| reply")) throw new AssertionError(rendered);
    if (!Ax.flow(rendered).toString().equals(rendered)) throw new AssertionError("round-trip changed");
    System.out.println("java-flow-mermaid-ok");
  }
}
