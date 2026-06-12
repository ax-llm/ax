#pragma once

#include "axllm/axllm.hpp"

extern "C" {
#include <quickjs.h>
}

namespace axllm::runtime::quickjs {

using HostCallable = std::function<Value(Value)>;

class QuickJsCodeSession : public AxCodeSession {
 public:
  QuickJsCodeSession(Value globals, Value options, Value runtime_policy, std::map<std::string, HostCallable> host_callables);
  ~QuickJsCodeSession() override;

  Value execute(Value code, Value options = Value::object()) override;
  Value inspect(Value options = Value::object()) override;
  Value snapshot_globals(Value options = Value::object()) override;
  Value patch_globals(Value snapshot, Value options = Value::object()) override;
  Value close() override;
  std::string call_host_json(const std::string& name, const std::string& params_json);

 private:
  JSRuntime* runtime_;
  JSContext* context_;
  bool closed_ = false;
  Value reserved_;
  Value runtime_policy_;
  std::map<std::string, HostCallable> host_callables_;

  Value eval_json(const std::string& source);
  void set_global(const std::string& name, const Value& value);
};

class QuickJsCodeRuntime : public AxCodeRuntime {
 public:
  explicit QuickJsCodeRuntime(Value runtime_policy = Value::object());
  QuickJsCodeRuntime& register_callable(std::string name, HostCallable handler);
  std::string usage_instructions() const override;
  AxCodeSession* create_session(Value globals, Value options = Value::object()) override;
  Value runtime_policy() const;

 private:
  Value runtime_policy_;
  std::map<std::string, HostCallable> host_callables_;
};

}  // namespace axllm::runtime::quickjs
