package dev.axllm.ax;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class AxMCPStdioTransport implements AxMCPTransport {
  private final Process process;
  private final BufferedReader reader;
  private final BufferedWriter writer;
  private java.util.function.Consumer<Map<String, Object>> handler;
  private String protocolVersion;

  public AxMCPStdioTransport(String command, List<String> args) {
    try {
      List<String> cmd = new ArrayList<>();
      cmd.add(command);
      if (args != null) cmd.addAll(args);
      process = new ProcessBuilder(cmd).start();
      reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
      writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream()));
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public synchronized Map<String, Object> send(Map<String, Object> message) {
    try {
      writer.write(AxMCPClient.stdioEncode(message));
      writer.flush();
      while (true) {
        String line = reader.readLine();
        if (line == null) throw new AxMCPError("MCP stdio process closed");
        Map<String, Object> parsed = AxMCPClient.stdioDecode(line);
        if (String.valueOf(parsed.get("id")).equals(String.valueOf(message.get("id")))) return parsed;
        if (handler != null) handler.accept(parsed);
      }
    } catch (AxMCPError error) {
      throw error;
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public synchronized void sendNotification(Map<String, Object> message) {
    try {
      writer.write(AxMCPClient.stdioEncode(message));
      writer.flush();
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public void setMessageHandler(java.util.function.Consumer<Map<String, Object>> handler) { this.handler = handler; }
  public void setProtocolVersion(String protocolVersion) { this.protocolVersion = protocolVersion; }
  public void close() { process.destroy(); }
}
