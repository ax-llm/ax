#include "mcp.hpp"

#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <mutex>

using namespace axllm;

int main() {
  const char* raw_endpoint = std::getenv("AX_MCP_ENDPOINT");
  if (!raw_endpoint) throw std::runtime_error("AX_MCP_ENDPOINT is required");
  auto transport = std::make_shared<AxMCPStreamableHTTPTransport>(
      raw_endpoint,
      object({{"ssrfProtection", object({{"requireHttps", false}, {"allowLocalhost", true}, {"allowPrivateNetworks", true}})},
              {"reconnectDelayMs", 50}}));
  auto client = std::make_shared<AxMCPClient>(transport, object({{"namespace", "inventory"}}));

  std::mutex mutex;
  std::condition_variable changed;
  int resources = 0, tasks = 0, progress = 0;
  auto mark = [&](int& value) {
    std::lock_guard<std::mutex> lock(mutex);
    ++value;
    changed.notify_all();
  };
  client->add_notification_listener([&](Value message) {
    if (display(Core::get(message, "method", "")) == "notifications/progress") mark(progress);
  });
  client->init();
  auto task_result = client->call_tool("start_reindex", object({{"scope", "all"}}));
  auto task_id = display(Core::get(Core::get(task_result, "task", Value::object()), "taskId", ""));

  AxEventTarget resource_target;
  resource_target.id = "resource-target";
  resource_target.retrySafety = "idempotent";
  resource_target.invoke = [&](Value input, const AxEventInvocationContext&) { mark(resources); return input; };
  AxEventTarget task_target;
  task_target.id = "task-target";
  task_target.retrySafety = "idempotent";
  task_target.waitFor = array({object({{"kind", "mcp.task"}, {"value", "taskKey"}, {"metadata", object({{"taskId", task_id}})}})});
  task_target.mapInput = [](const AxEventEnvelope& event, const AxEventContinuation* continuation) {
    return object({{"taskId", continuation ? Core::get(continuation->metadata, "taskId", "") : Core::get(event.data, "taskId", "")}});
  };
  task_target.invoke = [&](Value input, const AxEventInvocationContext&) { mark(tasks); return input; };

  std::vector<AxEventRoute> routes = {
      {"resource-wake", "wake", object({{"types", array({"mcp.resource.updated"})}}), "resource-target", true},
      {"task-start", "wake", object({{"types", array({"app.task.started"})}}), "task-target"},
      {"task-progress", "observe", object({{"types", array({"mcp.progress"})}})},
      {"task-resume", "resume", object({{"types", array({"mcp.task.status"})}}), "task-target"},
  };
  AxEventRuntime runtime(routes);
  runtime.register_target(std::move(resource_target)).register_target(std::move(task_target));
  runtime.add_source(std::make_shared<AxMCPEventSource>(client, "inventory", "tenant:smoke", "authenticated", std::vector<std::string>{"demo://inventory"}));
  runtime.start();
  AxEventEnvelope started;
  started.id = "task-start";
  started.source = "app://smoke";
  started.type = "app.task.started";
  started.data = object({{"taskId", task_id}, {"taskKey", "inventory:" + task_id}});
  runtime.publish(started, "tenant:smoke", "authenticated");
  std::cout << "AX_MCP_SMOKE_READY" << std::endl;

  std::unique_lock<std::mutex> lock(mutex);
  if (!changed.wait_for(lock, std::chrono::seconds(20), [&] { return resources >= 1 && tasks >= 2 && progress >= 1; })) {
    throw std::runtime_error("MCP event smoke timed out");
  }
  auto result = "AX_MCP_SMOKE_OK resource=" + std::to_string(resources) + " task=" + std::to_string(tasks) + " progress=" + std::to_string(progress);
  lock.unlock();
  runtime.close();
  client->close();
  std::cout << result << std::endl;
}
