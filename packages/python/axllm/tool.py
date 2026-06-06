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

    def call(self, args: dict[str, Any]):
        validate_fields(self.args, args, f"tool.{self.name}.args")
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

    def build(self):
        if not self.name.strip():
            raise ValueError("fn() requires a non-empty function name")
        if not self.desc:
            raise ValueError(f"Function {self.name!r} must define a description")
        if self.fn is None:
            raise ValueError(f"Function {self.name!r} must define a handler")
        return Tool(
            self.name,
            self.desc,
            to_json_schema(self.args),
            self.fn,
            returns=self.return_fields,
            namespace=self.ns,
            args=self.args,
        )


def fn(name: str) -> FunctionBuilder:
    return FunctionBuilder(name)
