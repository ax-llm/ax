import dev.axllm.ax.*;
import java.util.*;

public final class SignatureSchemaExample {
  public static void main(String[] args) {
    AxSignature signature = Ax.s("question:string -> answer:string");
    Map<String, Object> schema = signature.toJsonSchema("outputs", Map.of());

    System.out.println(schema);
  }
}
