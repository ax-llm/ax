from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from .schema import to_json_schema, validate_fields


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any]], Any]
    returns: list[Any] = field(default_factory=list)
    namespace: str | None = None
    args: list[Any] = field(default_factory=list)
    execution: str = "blocking"
    context_handler: Callable[[dict[str, Any], dict[str, Any]], Any] | None = None

    def call(self, args: dict[str, Any], context: dict[str, Any] | None = None):
        validate_fields(self.args, args, f"tool.{self.name}.args")
        if self.context_handler:
            import threading
            context = context if context is not None else {"signal": threading.Event()}
            result = self.context_handler(args, context)
        else:
            result = self.handler(args)
        if self.returns and isinstance(result, dict):
            validate_fields(self.returns, result, f"tool.{self.name}.return")
        return result


class FunctionBuilder:
    def __init__(self, name: str):
        self.name = name
        self.desc = None
        self.ns = None
        self.args = []
        self.return_fields = []
        self.fn = None
        self.context_fn = None
        self._execution = "blocking"

    def execution(self, mode: str):
        if mode not in ("blocking", "background"):
            raise ValueError("Tool execution must be blocking or background")
        self._execution = mode
        return self

    def description(self, text: str):
        self.desc = text
        return self

    def namespace(self, text: str):
        self.ns = text
        return self

    def arg(self, name: str, field_info):
        self.args.append(field_info.to_field(name))
        return self

    def returns_field(self, name: str, field_info):
        self.return_fields.append(field_info.to_field(name))
        return self

    def handler(self, fn: Callable[[dict[str, Any]], Any]):
        self.fn = fn
        return self

    def context_handler(self, fn: Callable[[dict[str, Any], dict[str, Any]], Any]):
        self.context_fn = fn
        return self

    def build(self):
        if not self.name.strip():
            raise ValueError("fn() requires a non-empty function name")
        if not self.desc:
            raise ValueError(f"Function {self.name!r} must define a description")
        if self.fn is None and self.context_fn is None:
            raise ValueError(f"Function {self.name!r} must define a handler")
        return Tool(
            self.name,
            self.desc,
            to_json_schema(self.args),
            self.fn,
            returns=self.return_fields,
            namespace=self.ns,
            args=self.args,
            execution=self._execution,
            context_handler=self.context_fn,
        )


def fn(name: str) -> FunctionBuilder:
    return FunctionBuilder(name)
