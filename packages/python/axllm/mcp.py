from __future__ import annotations
import os

import base64
import hashlib
import ipaddress
import json
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from .signature import AxSignature
from .tool import Tool


_CORE_COVERAGE_SEEN: set[str] = set()


def _core_coverage_mark(name):
    path = os.environ.get("AXIR_COVERAGE_FILE")
    if not path or name in _CORE_COVERAGE_SEEN:
        return
    _CORE_COVERAGE_SEEN.add(name)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(name + "\n")


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    if isinstance(target, (list, tuple)) and isinstance(key, int):
        return target[key] if 0 <= key < len(target) else default
    return getattr(target, key, default)


def _core_is_none(value):
    return value is None
def _core_is_not_none(value):
    return value is not None
def _core_type_is(value, expected):
    return {
        "object": isinstance(value, dict),
        "array": isinstance(value, (list, tuple)),
        "list": isinstance(value, (list, tuple)),
        "string": isinstance(value, str),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "bool": isinstance(value, bool),
        "boolean": isinstance(value, bool),
    }.get(expected, False)


def _core_and(left, right): return bool(left and right)
def _core_or(left, right): return bool(left or right)
def _core_not(value): return not bool(value)
def _core_eq(left, right): return left == right
def _core_lt(left, right): return left < right
def _core_lte(left, right): return left <= right
def _core_gt(left, right): return left > right
def _core_gte(left, right): return left >= right
def _core_add(left, right): return left + right
def _core_mul(left, right): return left * right
def _core_len(value): return len(value or [])
def _core_contains(container, item): return False if container is None else item in container
def _core_truthy(value): return bool(value)
def _core_none(): return None
def _core_json_stringify(value): return json.dumps(value, separators=(",", ":"), sort_keys=True)
def _core_json_parse(value): return json.loads(value)
def _core_math_abs(value): return abs(value)


def _core_map_merge(left, right):
    merged = dict(left or {})
    merged.update(right or {})
    return merged


def _core_map_contains(values, key): return isinstance(values, dict) and key in values
def _core_map_delete(target, key):
    if isinstance(target, dict): target.pop(key, None)
    return target
def _core_map_keys(values): return list(values.keys()) if isinstance(values, dict) else []
def _core_string_lower(value): return str(value).lower()
def _core_string_starts_with(value, prefix): return str(value).startswith(str(prefix))
def _core_string_ends_with(value, suffix): return str(value).endswith(str(suffix))
def _core_regex_match(pattern, value): return isinstance(value, str) and re.search(pattern, value) is not None
def _core_validation_error(message): return AxMCPError(str(message))


def _core_string_format(template, *args):
    rendered = str(template)
    for value in args:
        rendered = rendered.replace("{}", str(value), 1)
    return rendered


# BEGIN AXIR CORE EMITTED FUNCTIONS
def ucp_negotiate_profile(profile: Any, supportedVersions: list[Any], requestedServices: list[Any]) -> Any:
    _core_coverage_mark("ucp_negotiate_profile")
    version = _core_get(profile, "version", None)
    services = _core_get(profile, "services", None)
    capabilities = _core_get(profile, "capabilities", None)
    out = {}
    out["version"] = version
    out["services"] = services
    out["capabilities"] = capabilities
    out["supportedVersions"] = supportedVersions
    out["requestedServices"] = requestedServices
    return out


def ucp_normalize_outcome(operation: str, response: Any) -> Any:
    _core_coverage_mark("ucp_normalize_outcome")
    out = {}
    out["operation"] = operation
    out["value"] = response
    warnings = _core_get(response, "warnings", None)
    continuation = _core_get(response, "continuation_url", None)
    partial = _core_get(response, "partial_success", False)
    out["warnings"] = warnings
    out["continuationUrl"] = continuation
    out["partialSuccess"] = partial
    return out


def mcp_execution_context_descriptor(namespaces: list[Any], inheritance: Any) -> Any:
    _core_coverage_mark("mcp_execution_context_descriptor")
    out = {}
    out["namespaces"] = namespaces
    missing = _core_is_none(inheritance)
    if missing:
        out["inheritance"] = "all"
    else:
        out["inheritance"] = inheritance
    out["native"] = True
    out["lossyAdapter"] = False
    return out


def event_runtime_descriptor(routes: list[Any], options: Any) -> Any:
    _core_coverage_mark("event_runtime_descriptor")
    empty = {}
    missing = _core_is_none(options)
    opts = options
    if missing:
        opts = empty
    else:
        pass
    out = {}
    out["routes"] = routes
    out["options"] = opts
    out["durability"] = "volatile"
    out["coordination"] = "single-worker"
    out["implicitWake"] = False
    return out


def mcp_protocol_constants() -> Any:
    _core_coverage_mark("mcp_protocol_constants")
    versions = []
    versions.append("2026-07-28")
    versions.append("2025-11-25")
    versions.append("2025-06-18")
    versions.append("2025-03-26")
    versions.append("2024-11-05")
    out = {}
    out["protocolVersion"] = "2025-11-25"
    out["modernProtocolVersion"] = "2026-07-28"
    out["supportedProtocolVersions"] = versions
    return out


def event_route_commands(event: Any, routes: list[Any], identity_scope: str, trust: str) -> list[Any]:
    _core_coverage_mark("event_route_commands")
    commands = []
    event_type = _core_get(event, "type", "")
    event_source = _core_get(event, "source", "")
    subject = _core_get(event, "subject", identity_scope)
    for route in routes:
        match = _core_get(route, "match", None)
        types_empty = []
        sources_empty = []
        types = _core_get(match, "types", types_empty)
        sources = _core_get(match, "sources", sources_empty)
        type_count = _core_len(types)
        source_count = _core_len(sources)
        type_open = _core_eq(type_count, 0)
        source_open = _core_eq(source_count, 0)
        type_listed = _core_contains(types, event_type)
        source_listed = _core_contains(sources, event_source)
        type_match = _core_or(type_open, type_listed)
        source_match = _core_or(source_open, source_listed)
        matched = _core_and(type_match, source_match)
        requires_auth = _core_get(route, "requireAuthenticated", False)
        authenticated = _core_eq(trust, "authenticated")
        trusted = _core_eq(trust, "trusted")
        verified = _core_or(authenticated, trusted)
        auth_allowed = True
        if requires_auth:
            auth_allowed = verified
        else:
            pass
        allowed = _core_and(matched, auth_allowed)
        if allowed:
            route_id = _core_get(route, "id", "")
            action = _core_get(route, "action", "observe")
            target_id = _core_get(route, "targetId", None)
            command = {}
            command["routeId"] = route_id
            command["action"] = action
            command["targetId"] = target_id
            command["instanceKey"] = subject
            event_id = _core_get(event, "id", "")
            key = _core_string_format("{}:{}", route_id, event_id)
            command["idempotencyKey"] = key
            commands.append(command)
        else:
            pass
    return commands


def mcp_modern_request_headers(method: str, name: str, protocol_version: str) -> Any:
    _core_coverage_mark("mcp_modern_request_headers")
    out = {}
    version_missing = _core_is_none(protocol_version)
    if version_missing:
        out["MCP-Protocol-Version"] = "2026-07-28"
    else:
        out["MCP-Protocol-Version"] = protocol_version
    out["Mcp-Method"] = method
    missing = _core_is_none(name)
    if missing:
        pass
    else:
        out["Mcp-Name"] = name
    return out


def mcp_classify_discovery_result(result: Any) -> Any:
    _core_coverage_mark("mcp_classify_discovery_result")
    out = {}
    none = _core_none()
    out["valid"] = False
    out["serverInfo"] = none
    empty_meta = {}
    out["meta"] = empty_meta
    is_object = _core_type_is(result, "object")
    if is_object:
        result_type = _core_get(result, "resultType", "")
        complete = _core_eq(result_type, "complete")
        versions = _core_get(result, "supportedVersions", None)
        versions_list = _core_type_is(versions, "list")
        versions_valid = versions_list
        if versions_list:
            for version in versions:
                version_string = _core_type_is(version, "string")
                version_invalid = _core_not(version_string)
                if version_invalid:
                    versions_valid = False
                else:
                    pass
        else:
            pass
        capabilities = _core_get(result, "capabilities", None)
        capabilities_valid = _core_type_is(capabilities, "object")
        ttl = _core_get(result, "ttlMs", None)
        ttl_number = _core_type_is(ttl, "number")
        ttl_valid = False
        if ttl_number:
            ttl_text = _core_json_stringify(ttl)
            ttl_integer = _core_regex_match("^[0-9]+$", ttl_text)
            ttl_nonnegative = _core_gte(ttl, 0)
            ttl_valid = _core_and(ttl_integer, ttl_nonnegative)
        else:
            pass
        scope = _core_get(result, "cacheScope", "")
        private_scope = _core_eq(scope, "private")
        public_scope = _core_eq(scope, "public")
        scope_valid = _core_or(private_scope, public_scope)
        shape_a = _core_and(complete, versions_valid)
        shape_b = _core_and(capabilities_valid, ttl_valid)
        shape_c = _core_and(shape_a, shape_b)
        valid = _core_and(shape_c, scope_valid)
        if valid:
            out["valid"] = True
            out["supportedVersions"] = versions
            out["capabilities"] = capabilities
            out["ttlMs"] = ttl
            out["cacheScope"] = scope
            meta_raw = _core_get(result, "_meta", None)
            meta_is_object = _core_type_is(meta_raw, "object")
            if meta_is_object:
                meta_base = {}
                meta = _core_map_merge(meta_base, meta_raw)
                out["meta"] = meta
                server_info_raw = _core_get(meta, "io.modelcontextprotocol/serverInfo", None)
                server_info_object = _core_type_is(server_info_raw, "object")
                if server_info_object:
                    server_name = _core_get(server_info_raw, "name", None)
                    server_version = _core_get(server_info_raw, "version", None)
                    server_name_string = _core_type_is(server_name, "string")
                    server_version_string = _core_type_is(server_version, "string")
                    server_info_valid = _core_and(server_name_string, server_version_string)
                    if server_info_valid:
                        server_info_base = {}
                        server_info = _core_map_merge(server_info_base, server_info_raw)
                        out["serverInfo"] = server_info
                    else:
                        pass
                else:
                    pass
            else:
                pass
        else:
            pass
    else:
        pass
    return out


def event_retry_transition(invocation_started: bool, retry_safety: str, attempt: int, max_attempts: int) -> Any:
    _core_coverage_mark("event_retry_transition")
    out = {}
    idempotent = _core_eq(retry_safety, "idempotent")
    can_retry = _core_lt(attempt, max_attempts)
    pre_invocation = _core_not(invocation_started)
    safe = _core_or(pre_invocation, idempotent)
    retry = _core_and(safe, can_retry)
    out["retry"] = retry
    out["status"] = "failed"
    if invocation_started:
        if idempotent:
            pass
        else:
            out["status"] = "outcome_unknown"
            out["retry"] = False
    else:
        pass
    return out


def event_resolve_path(ingress: Any, path: Any, continuation: Any) -> Any:
    _core_coverage_mark("event_resolve_path")
    none = _core_none()
    root = _core_get(path, "root", "data")
    event = _core_get(ingress, "event", ingress)
    current = none
    is_data = _core_eq(root, "data")
    is_envelope = _core_eq(root, "envelope")
    is_extensions = _core_eq(root, "extensions")
    is_identity = _core_eq(root, "identity")
    is_trust = _core_eq(root, "trust")
    is_continuation = _core_eq(root, "continuation")
    is_constant = _core_eq(root, "constant")
    is_correlation = _core_eq(root, "correlation")
    if is_data:
        current = _core_get(event, "data", none)
    else:
        pass
    if is_envelope:
        current = event
    else:
        pass
    if is_extensions:
        current = _core_get(event, "extensions", none)
    else:
        pass
    if is_identity:
        current = _core_get(ingress, "identity", none)
    else:
        pass
    if is_trust:
        current = _core_get(ingress, "trust", "untrusted")
    else:
        pass
    if is_continuation:
        current = _core_get(continuation, "metadata", none)
    else:
        pass
    if is_constant:
        current = _core_get(path, "value", none)
    else:
        pass
    if is_correlation:
        kind = _core_get(path, "correlationKind", "")
        keys_empty = []
        keys = _core_get(ingress, "correlation", keys_empty)
        for key in keys:
            candidate = _core_get(key, "kind", "")
            matches = _core_eq(candidate, kind)
            if matches:
                current = _core_get(key, "value", none)
            else:
                pass
    else:
        pass
    segments_empty = []
    segments = _core_get(path, "segments", segments_empty)
    for segment in segments:
        object = _core_type_is(current, "object")
        array = _core_type_is(current, "array")
        container = _core_or(object, array)
        if container:
            current = _core_get(current, segment, none)
        else:
            current = none
    return current


def mcp_resolve_known_era(configured: str, hint: str, cached: str, stored: str) -> Any:
    _core_coverage_mark("mcp_resolve_known_era")
    out = {}
    configured_modern = _core_eq(configured, "modern")
    configured_legacy = _core_eq(configured, "legacy")
    configured_known = _core_or(configured_modern, configured_legacy)
    if configured_known:
        out["era"] = configured
        out["probe"] = False
        return out
    else:
        pass
    hint_modern = _core_eq(hint, "modern")
    hint_legacy = _core_eq(hint, "legacy")
    hint_known = _core_or(hint_modern, hint_legacy)
    if hint_known:
        out["era"] = hint
        out["probe"] = False
        return out
    else:
        pass
    cached_modern = _core_eq(cached, "modern")
    cached_legacy = _core_eq(cached, "legacy")
    cached_known = _core_or(cached_modern, cached_legacy)
    if cached_known:
        out["era"] = cached
        out["probe"] = False
        return out
    else:
        pass
    stored_modern = _core_eq(stored, "modern")
    stored_legacy = _core_eq(stored, "legacy")
    stored_known = _core_or(stored_modern, stored_legacy)
    if stored_known:
        out["era"] = stored
        out["probe"] = False
        return out
    else:
        pass
    out["era"] = "modern"
    out["probe"] = True
    return out


def event_map_input(ingress: Any, plan: Any, signature_fields: list[Any], continuation: Any) -> Any:
    _core_coverage_mark("event_map_input")
    none = _core_none()
    out = {}
    result = {}
    error = none
    project_path = _core_get(plan, "project", none)
    projection = none
    has_project = _core_is_not_none(project_path)
    if has_project:
        projection = event_resolve_path(ingress, project_path, continuation)
    else:
        pass
    mappings_empty = []
    mappings = _core_get(plan, "fields", mappings_empty)
    for field in signature_fields:
        name = _core_get(field, "name", "")
        optional = _core_get(field, "optional", False)
        selector = none
        for mapping in mappings:
            destination = _core_get(mapping, "field", "")
            matches = _core_eq(destination, name)
            if matches:
                selector = _core_get(mapping, "path", none)
            else:
                pass
        value = none
        has_selector = _core_is_not_none(selector)
        if has_selector:
            value = event_resolve_path(ingress, selector, continuation)
        else:
            project_object = _core_type_is(projection, "object")
            if project_object:
                value = _core_get(projection, name, none)
            else:
                pass
        missing = _core_is_none(value)
        if missing:
            if optional:
                pass
            else:
                error = _core_string_format("Required signature input {} was not present", name)
        else:
            out[name] = value
    failed = _core_is_not_none(error)
    result["ok"] = True
    result["value"] = out
    if failed:
        result["ok"] = False
        result["error"] = error
    else:
        pass
    return result


def mcp_select_mutual_version(error_data: Any, client_versions: list[Any]) -> str:
    _core_coverage_mark("mcp_select_mutual_version")
    is_object = _core_type_is(error_data, "object")
    if is_object:
        supported = _core_get(error_data, "supported", None)
        supported_list = _core_type_is(supported, "list")
        if supported_list:
            for version in client_versions:
                mutual = _core_contains(supported, version)
                if mutual:
                    return version
                else:
                    pass
        else:
            pass
    else:
        pass
    return ""


def mcp_build_request_meta(existing: Any, protocol_version: str, client_capabilities: Any, client_info: Any, log_level: str, traceparent: str, tracestate: str) -> Any:
    _core_coverage_mark("mcp_build_request_meta")
    empty = {}
    out = empty
    existing_object = _core_type_is(existing, "object")
    if existing_object:
        out = _core_map_merge(empty, existing)
    else:
        pass
    out["io.modelcontextprotocol/protocolVersion"] = protocol_version
    out["io.modelcontextprotocol/clientCapabilities"] = client_capabilities
    out["io.modelcontextprotocol/clientInfo"] = client_info
    log_missing = _core_is_none(log_level)
    has_log = _core_not(log_missing)
    if has_log:
        out["io.modelcontextprotocol/logLevel"] = log_level
    else:
        pass
    has_traceparent = _core_truthy(traceparent)
    if has_traceparent:
        out["traceparent"] = traceparent
    else:
        pass
    has_tracestate = _core_truthy(tracestate)
    if has_tracestate:
        out["tracestate"] = tracestate
    else:
        pass
    return out


def event_normalize_input(input: Any, signature_fields: list[Any]) -> Any:
    _core_coverage_mark("event_normalize_input")
    none = _core_none()
    out = {}
    result = {}
    error = none
    is_object = _core_type_is(input, "object")
    if is_object:
        for field in signature_fields:
            name = _core_get(field, "name", "")
            optional = _core_get(field, "optional", False)
            value = _core_get(input, name, none)
            missing = _core_is_none(value)
            if missing:
                if optional:
                    pass
                else:
                    error = _core_string_format("Required signature input {} was not present", name)
            else:
                encoded = _core_json_stringify(value)
                clone = _core_json_parse(encoded)
                out[name] = clone
    else:
        error = "Mapped event input must be an object"
    failed = _core_is_not_none(error)
    result["ok"] = True
    result["value"] = out
    if failed:
        result["ok"] = False
        result["error"] = error
    else:
        pass
    return result


def mcp_client_capabilities(has_roots: bool, has_sampling: bool, has_elicitation: bool, era: str, tasks_extension: bool) -> Any:
    _core_coverage_mark("mcp_client_capabilities")
    out = {}
    if has_roots:
        roots = {}
        roots["listChanged"] = True
        out["roots"] = roots
    else:
        pass
    if has_sampling:
        sampling = {}
        sampling_context = {}
        sampling_tools = {}
        sampling["context"] = sampling_context
        sampling["tools"] = sampling_tools
        out["sampling"] = sampling
    else:
        pass
    if has_elicitation:
        elicitation = {}
        elicitation_form = {}
        elicitation_url = {}
        elicitation["form"] = elicitation_form
        elicitation["url"] = elicitation_url
        out["elicitation"] = elicitation
    else:
        pass
    modern = _core_eq(era, "modern")
    add_tasks = _core_and(modern, tasks_extension)
    if add_tasks:
        extensions = {}
        tasks = {}
        extensions["io.modelcontextprotocol/tasks"] = tasks
        out["extensions"] = extensions
    else:
        pass
    return out


def event_continuation_match(continuations: list[Any], identity_scope: str, kind: str, value: str, now: float) -> Any:
    _core_coverage_mark("event_continuation_match")
    result = _core_none()
    for continuation in continuations:
        scope = _core_get(continuation, "identityScope", "")
        scope_match = _core_eq(scope, identity_scope)
        expires = _core_get(continuation, "expiresAt", None)
        no_expiry = _core_is_none(expires)
        active = no_expiry
        if no_expiry:
            pass
        else:
            active = _core_lt(now, expires)
        correlations_empty = []
        correlations = _core_get(continuation, "correlation", correlations_empty)
        for correlation in correlations:
            candidate_kind = _core_get(correlation, "kind", "")
            candidate_value = _core_get(correlation, "value", "")
            kind_match = _core_eq(candidate_kind, kind)
            value_match = _core_eq(candidate_value, value)
            key_match = _core_and(kind_match, value_match)
            scope_active = _core_and(scope_match, active)
            match = _core_and(scope_active, key_match)
            if match:
                result = continuation
            else:
                pass
    return result


def mcp_negotiate_extensions(client_ext: Any, server_ext: Any) -> Any:
    _core_coverage_mark("mcp_negotiate_extensions")
    out = {}
    client_object = _core_type_is(client_ext, "object")
    server_object = _core_type_is(server_ext, "object")
    both_objects = _core_and(client_object, server_object)
    if both_objects:
        names = _core_map_keys(client_ext)
        for name in names:
            server_has = _core_map_contains(server_ext, name)
            if server_has:
                client_value = _core_get(client_ext, name, None)
                server_value = _core_get(server_ext, name, None)
                client_value_object = _core_type_is(client_value, "object")
                server_value_object = _core_type_is(server_value, "object")
                values_objects = _core_and(client_value_object, server_value_object)
                if values_objects:
                    merged = _core_map_merge(client_value, server_value)
                    out[name] = merged
                else:
                    out[name] = server_value
            else:
                pass
    else:
        pass
    return out


def event_delivery_due(status: str, available_at: float, now: float) -> bool:
    _core_coverage_mark("event_delivery_due")
    queued = _core_eq(status, "queued")
    ready = _core_lte(available_at, now)
    due = _core_and(queued, ready)
    return due


def mcp_request_name(method: str, params: Any) -> str:
    _core_coverage_mark("mcp_request_name")
    params_object = _core_type_is(params, "object")
    if params_object:
        tools_call = _core_eq(method, "tools/call")
        prompts_get = _core_eq(method, "prompts/get")
        named = _core_or(tools_call, prompts_get)
        if named:
            name = _core_get(params, "name", "")
            name_string = _core_type_is(name, "string")
            if name_string:
                return name
            else:
                pass
        else:
            pass
        resources_read = _core_eq(method, "resources/read")
        if resources_read:
            uri = _core_get(params, "uri", "")
            uri_string = _core_type_is(uri, "string")
            if uri_string:
                return uri
            else:
                pass
        else:
            pass
    else:
        pass
    return ""


def event_strict_delivery_eligible(candidate: Any, deliveries: list[Any]) -> bool:
    _core_coverage_mark("event_strict_delivery_eligible")
    ordering = _core_get(candidate, "ordering", "strict")
    strict = _core_eq(ordering, "strict")
    eligible = True
    if strict:
        candidate_sequence = _core_get(candidate, "sequence", 0)
        candidate_target = _core_get(candidate, "targetId", "")
        candidate_instance = _core_get(candidate, "instanceKey", "")
        terminal = []
        terminal.append("succeeded")
        terminal.append("failed")
        terminal.append("cancelled")
        terminal.append("dead_lettered")
        terminal.append("output_persistence_failed")
        terminal.append("outcome_unknown")
        terminal.append("waiting_event")
        terminal.append("coalesced")
        for delivery in deliveries:
            sequence = _core_get(delivery, "sequence", 0)
            earlier = _core_lt(sequence, candidate_sequence)
            target = _core_get(delivery, "targetId", "")
            instance = _core_get(delivery, "instanceKey", "")
            same_target = _core_eq(target, candidate_target)
            same_instance = _core_eq(instance, candidate_instance)
            same_queue = _core_and(same_target, same_instance)
            status = _core_get(delivery, "status", "queued")
            is_terminal = _core_contains(terminal, status)
            nonterminal = _core_not(is_terminal)
            predecessor = _core_and(earlier, same_queue)
            blocking = _core_and(predecessor, nonterminal)
            if blocking:
                eligible = False
            else:
                pass
    else:
        pass
    return eligible


def mcp_header_value_plan(value: str) -> Any:
    _core_coverage_mark("mcp_header_value_plan")
    out = {}
    edge_space = _core_regex_match("^[\\t ]|[\\t ]$", value)
    sentinel_prefix = _core_string_starts_with(value, "=?base64?")
    sentinel_suffix = _core_string_ends_with(value, "?=")
    sentinel = _core_and(sentinel_prefix, sentinel_suffix)
    unsafe_octet = _core_regex_match("[^\\t -~]", value)
    edge_or_sentinel = _core_or(edge_space, sentinel)
    encode = _core_or(edge_or_sentinel, unsafe_octet)
    if encode:
        out["mode"] = "encode"
    else:
        out["mode"] = "plain"
    return out


def mcp_param_header_bindings(input_schema: Any) -> Any:
    _core_coverage_mark("mcp_param_header_bindings")
    bindings = []
    schema_object = _core_type_is(input_schema, "object")
    not_object = _core_not(schema_object)
    if not_object:
        return bindings
    else:
        pass
    root_annotated = _core_map_contains(input_schema, "x-mcp-header")
    if root_annotated:
        root_error = _core_validation_error("x-mcp-header at inputSchema is not statically reachable through properties")
        raise root_error
    else:
        pass
    seen_names = []
    properties = _core_get(input_schema, "properties", None)
    properties_object = _core_type_is(properties, "object")
    if properties_object:
        property_names = _core_map_keys(properties)
        for property_name in property_names:
            property_schema = _core_get(properties, property_name, None)
            property_object = _core_type_is(property_schema, "object")
            if property_object:
                annotated = _core_map_contains(property_schema, "x-mcp-header")
                if annotated:
                    header_name = _core_get(property_schema, "x-mcp-header", None)
                    header_string = _core_type_is(header_name, "string")
                    header_not_string = _core_not(header_string)
                    if header_not_string:
                        name_type_error = _core_validation_error("x-mcp-header must be a non-empty string")
                        raise name_type_error
                    else:
                        pass
                    header_length = _core_len(header_name)
                    header_nonempty = _core_gt(header_length, 0)
                    header_invalid = _core_not(header_nonempty)
                    if header_invalid:
                        name_error = _core_validation_error("x-mcp-header must be a non-empty string")
                        raise name_error
                    else:
                        pass
                    token_valid = _core_regex_match("^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$", header_name)
                    token_invalid = _core_not(token_valid)
                    if token_invalid:
                        token_error = _core_validation_error("x-mcp-header value is not an RFC 9110 field-name token")
                        raise token_error
                    else:
                        pass
                    normalized_name = _core_string_lower(header_name)
                    normalized_full_name = _core_string_format("mcp-param-{}", normalized_name)
                    duplicate = _core_contains(seen_names, normalized_full_name)
                    if duplicate:
                        duplicate_error = _core_validation_error("x-mcp-header value is not case-insensitively unique")
                        raise duplicate_error
                    else:
                        pass
                    seen_names.append(normalized_full_name)
                    property_type = _core_get(property_schema, "type", None)
                    type_string = _core_eq(property_type, "string")
                    type_integer = _core_eq(property_type, "integer")
                    type_boolean = _core_eq(property_type, "boolean")
                    type_scalar_a = _core_or(type_string, type_integer)
                    type_valid = _core_or(type_scalar_a, type_boolean)
                    type_invalid = _core_not(type_valid)
                    if type_invalid:
                        type_error = _core_validation_error("x-mcp-header requires type string, integer, or boolean")
                        raise type_error
                    else:
                        pass
                    binding = {}
                    full_header_name = _core_string_format("Mcp-Param-{}", header_name)
                    binding["headerName"] = full_header_name
                    path = []
                    path.append(property_name)
                    binding["path"] = path
                    binding["type"] = property_type
                    bindings.append(binding)
                else:
                    pass
                child_base = {}
                child_schema = _core_map_merge(child_base, property_schema)
                _core_map_delete(child_schema, "x-mcp-header")
                child_bindings = mcp_param_header_bindings(child_schema)
                for child_binding in child_bindings:
                    child_header_name = _core_get(child_binding, "headerName", "")
                    child_normalized = _core_string_lower(child_header_name)
                    child_duplicate = _core_contains(seen_names, child_normalized)
                    if child_duplicate:
                        child_duplicate_error = _core_validation_error("x-mcp-header value is not case-insensitively unique")
                        raise child_duplicate_error
                    else:
                        pass
                    seen_names.append(child_normalized)
                    child_path = _core_get(child_binding, "path", None)
                    prefixed_path = []
                    prefixed_path.append(property_name)
                    for child_part in child_path:
                        prefixed_path.append(child_part)
                    prefixed_binding_base = {}
                    prefixed_binding = _core_map_merge(prefixed_binding_base, child_binding)
                    prefixed_binding["path"] = prefixed_path
                    bindings.append(prefixed_binding)
            else:
                pass
    else:
        pass
    schema_keys = _core_map_keys(input_schema)
    for schema_key in schema_keys:
        is_properties = _core_eq(schema_key, "properties")
        is_annotation = _core_eq(schema_key, "x-mcp-header")
        skip_keyword = _core_or(is_properties, is_annotation)
        visit_keyword = _core_not(skip_keyword)
        if visit_keyword:
            keyword_value = _core_get(input_schema, schema_key, None)
            keyword_object = _core_type_is(keyword_value, "object")
            if keyword_object:
                keyword_bindings = mcp_param_header_bindings(keyword_value)
                keyword_binding_count = _core_len(keyword_bindings)
                keyword_annotated = _core_gt(keyword_binding_count, 0)
                if keyword_annotated:
                    keyword_error = _core_validation_error("x-mcp-header is not statically reachable through properties")
                    raise keyword_error
                else:
                    pass
            else:
                pass
            keyword_list = _core_type_is(keyword_value, "list")
            if keyword_list:
                for keyword_item in keyword_value:
                    keyword_item_object = _core_type_is(keyword_item, "object")
                    if keyword_item_object:
                        item_bindings = mcp_param_header_bindings(keyword_item)
                        item_binding_count = _core_len(item_bindings)
                        item_annotated = _core_gt(item_binding_count, 0)
                        if item_annotated:
                            item_error = _core_validation_error("x-mcp-header is not statically reachable through properties")
                            raise item_error
                        else:
                            pass
                    else:
                        pass
            else:
                pass
        else:
            pass
    return bindings


def event_capacity_transition(pending: int, queued_bytes: int, envelope_bytes: int, max_pending: int, max_queued_bytes: int, max_envelope_bytes: int) -> Any:
    _core_coverage_mark("event_capacity_transition")
    out = {}
    next_pending = _core_add(pending, 1)
    next_bytes = _core_add(queued_bytes, envelope_bytes)
    pending_ok = _core_lte(next_pending, max_pending)
    queue_ok = _core_lte(next_bytes, max_queued_bytes)
    envelope_ok = _core_lte(envelope_bytes, max_envelope_bytes)
    queue_capacity = _core_and(pending_ok, queue_ok)
    accepted = _core_and(queue_capacity, envelope_ok)
    out["accepted"] = accepted
    out["nextPending"] = next_pending
    out["nextQueuedBytes"] = next_bytes
    out["reason"] = "capacity"
    if envelope_ok:
        pass
    else:
        out["reason"] = "envelope_too_large"
    return out


def event_debounce_transition(now: float, debounce_ms: float, has_queued_predecessor: bool) -> Any:
    _core_coverage_mark("event_debounce_transition")
    out = {}
    available_at = _core_add(now, debounce_ms)
    out["availableAt"] = available_at
    out["coalescePredecessor"] = has_queued_predecessor
    return out


def event_normalize_mcp(namespace: str, method: str, params: Any) -> Any:
    _core_coverage_mark("event_normalize_mcp")
    out = {}
    source = _core_string_format("mcp://{}", namespace)
    out["source"] = source
    out["type"] = "mcp.notification"
    out["data"] = params
    resource = _core_eq(method, "notifications/resources/updated")
    tools = _core_eq(method, "notifications/tools/list_changed")
    prompts = _core_eq(method, "notifications/prompts/list_changed")
    resources = _core_eq(method, "notifications/resources/list_changed")
    progress = _core_eq(method, "notifications/progress")
    logging = _core_eq(method, "notifications/message")
    task = _core_eq(method, "notifications/tasks/status")
    if resource:
        out["type"] = "mcp.resource.updated"
    else:
        pass
    if tools:
        out["type"] = "mcp.catalog.changed"
    else:
        pass
    if prompts:
        out["type"] = "mcp.catalog.changed"
    else:
        pass
    if resources:
        out["type"] = "mcp.catalog.changed"
    else:
        pass
    if progress:
        out["type"] = "mcp.progress"
    else:
        pass
    if logging:
        out["type"] = "mcp.logging"
    else:
        pass
    if task:
        out["type"] = "mcp.task.status"
        task_value = _core_get(params, "task", params)
        task_id = _core_get(task_value, "taskId", "")
        task_key = _core_string_format("{}:{}", namespace, task_id)
        correlation = {}
        correlation["kind"] = "mcp.task"
        correlation["value"] = task_key
        out["correlation"] = correlation
    else:
        pass
    return out


def mcp_param_header_values(bindings: Any, arguments: Any) -> Any:
    _core_coverage_mark("mcp_param_header_values")
    out = {}
    bindings_list = _core_type_is(bindings, "list")
    not_bindings = _core_not(bindings_list)
    if not_bindings:
        return out
    else:
        pass
    for binding in bindings:
        header_name = _core_get(binding, "headerName", "")
        path = _core_get(binding, "path", None)
        expected_type = _core_get(binding, "type", "")
        current = arguments
        present = True
        for part in path:
            current_object = _core_type_is(current, "object")
            if current_object:
                has_part = _core_map_contains(current, part)
                if has_part:
                    current = _core_get(current, part, None)
                else:
                    present = False
            else:
                present = False
        is_null = _core_is_none(current)
        not_null = _core_not(is_null)
        emit_value = _core_and(present, not_null)
        if emit_value:
            expects_string = _core_eq(expected_type, "string")
            if expects_string:
                is_string = _core_type_is(current, "string")
                invalid_string = _core_not(is_string)
                if invalid_string:
                    string_error = _core_validation_error("MCP parameter header expected string")
                    raise string_error
                else:
                    pass
                out[header_name] = current
            else:
                expects_boolean = _core_eq(expected_type, "boolean")
                if expects_boolean:
                    is_boolean = _core_type_is(current, "boolean")
                    invalid_boolean = _core_not(is_boolean)
                    if invalid_boolean:
                        boolean_error = _core_validation_error("MCP parameter header expected boolean")
                        raise boolean_error
                    else:
                        pass
                    if current:
                        out[header_name] = "true"
                    else:
                        out[header_name] = "false"
                else:
                    is_number = _core_type_is(current, "number")
                    not_number = _core_not(is_number)
                    if not_number:
                        number_error = _core_validation_error("MCP parameter header expected integer")
                        raise number_error
                    else:
                        pass
                    number_text = _core_json_stringify(current)
                    is_integer = _core_regex_match("^-?(0|[1-9][0-9]*)$", number_text)
                    absolute = _core_math_abs(current)
                    safe_high = _core_mul(9007199, 1000000000)
                    safe_max = _core_add(safe_high, 254740991)
                    is_safe = _core_lte(absolute, safe_max)
                    valid_integer = _core_and(is_integer, is_safe)
                    invalid_integer = _core_not(valid_integer)
                    if invalid_integer:
                        integer_error = _core_validation_error("MCP parameter header expected integer")
                        raise integer_error
                    else:
                        pass
                    out[header_name] = number_text
        else:
            pass
    return out


def mcp_fold_cache_info(pages: list[Any], fetched_at: number) -> Any:
    _core_coverage_mark("mcp_fold_cache_info")
    out = {}
    out["fetchedAt"] = fetched_at
    page_count = _core_len(pages)
    has_pages = _core_gt(page_count, 0)
    ttl_valid = has_pages
    first_ttl = True
    min_ttl = 0
    private_scope = False
    public_scope = has_pages
    for page in pages:
        ttl = _core_get(page, "ttlMs", None)
        ttl_number = _core_type_is(ttl, "number")
        ttl_integer = False
        ttl_nonnegative = False
        if ttl_number:
            ttl_text = _core_json_stringify(ttl)
            ttl_integer = _core_regex_match("^[0-9]+$", ttl_text)
            ttl_nonnegative = _core_gte(ttl, 0)
        else:
            pass
        page_ttl_valid = _core_and(ttl_integer, ttl_nonnegative)
        if page_ttl_valid:
            if first_ttl:
                min_ttl = ttl
                first_ttl = False
            else:
                smaller = _core_lt(ttl, min_ttl)
                if smaller:
                    min_ttl = ttl
                else:
                    pass
        else:
            ttl_valid = False
        scope = _core_get(page, "cacheScope", "")
        page_private = _core_eq(scope, "private")
        page_public = _core_eq(scope, "public")
        if page_private:
            private_scope = True
        else:
            pass
        not_public = _core_not(page_public)
        if not_public:
            public_scope = False
        else:
            pass
    if ttl_valid:
        out["ttlMs"] = min_ttl
        expires_at = _core_add(fetched_at, min_ttl)
        out["expiresAt"] = expires_at
    else:
        pass
    if private_scope:
        out["cacheScope"] = "private"
    else:
        if public_scope:
            out["cacheScope"] = "public"
        else:
            pass
    return out


def mcp_cache_freshness(cache_info: Any, now: number) -> bool:
    _core_coverage_mark("mcp_cache_freshness")
    cache_object = _core_type_is(cache_info, "object")
    if cache_object:
        expires_at = _core_get(cache_info, "expiresAt", None)
        expires_number = _core_type_is(expires_at, "number")
        if expires_number:
            fresh = _core_lt(now, expires_at)
            return fresh
        else:
            pass
    else:
        pass
    return False


def mcp_jsonrpc_request(id: str, method: str, params: Any) -> Any:
    _core_coverage_mark("mcp_jsonrpc_request")
    out = {}
    out["jsonrpc"] = "2.0"
    out["id"] = id
    out["method"] = method
    missing = _core_is_none(params)
    if missing:
        pass
    else:
        out["params"] = params
    return out


def mcp_jsonrpc_notification(method: str, params: Any) -> Any:
    _core_coverage_mark("mcp_jsonrpc_notification")
    out = {}
    out["jsonrpc"] = "2.0"
    out["method"] = method
    missing = _core_is_none(params)
    if missing:
        pass
    else:
        out["params"] = params
    return out


def mcp_normalize_error(response: Any) -> Any:
    _core_coverage_mark("mcp_normalize_error")
    err = _core_get(response, "error", None)
    missing = _core_is_none(err)
    if missing:
        ok = {}
        result = _core_get(response, "result", None)
        ok["ok"] = True
        ok["result"] = result
        return ok
    else:
        code = _core_get(err, "code", 0)
        message = _core_get(err, "message", "MCP JSON-RPC error")
        data = _core_get(err, "data", None)
        out = {}
        out["ok"] = False
        out["category"] = "mcp"
        out["code"] = code
        out["message"] = message
        out["data"] = data
        return out
    return response


def mcp_resource_subscription_selection(resources: list[Any], mode: str, explicit_uris: list[Any]) -> list[Any]:
    _core_coverage_mark("mcp_resource_subscription_selection")
    selected = []
    is_explicit = _core_eq(mode, "explicit")
    if is_explicit:
        for uri in explicit_uris:
            empty = _core_eq(uri, "")
            duplicate = _core_contains(selected, uri)
            skip = _core_or(empty, duplicate)
            if skip:
                pass
            else:
                selected.append(uri)
    else:
        is_all = _core_eq(mode, "all")
        is_selector = _core_eq(mode, "selector")
        uses_resources = _core_or(is_all, is_selector)
        if uses_resources:
            for resource in resources:
                uri = _core_get(resource, "uri", "")
                empty = _core_eq(uri, "")
                duplicate = _core_contains(selected, uri)
                skip = _core_or(empty, duplicate)
                if skip:
                    pass
                else:
                    selected.append(uri)
        else:
            pass
    return selected


def mcp_resource_subscription_plan(desired: list[Any], current: list[Any]) -> Any:
    _core_coverage_mark("mcp_resource_subscription_plan")
    selected = []
    for uri in desired:
        duplicate = _core_contains(selected, uri)
        if duplicate:
            pass
        else:
            selected.append(uri)
    additions = []
    for uri in selected:
        owned = _core_contains(current, uri)
        if owned:
            pass
        else:
            additions.append(uri)
    removals = []
    for uri in current:
        wanted = _core_contains(selected, uri)
        if wanted:
            pass
        else:
            removals.append(uri)
    out = {}
    out["selected"] = selected
    out["additions"] = additions
    out["removals"] = removals
    return out


def mcp_resource_subscription_ownership(owners: list[Any], owner: str, operation: str) -> Any:
    _core_coverage_mark("mcp_resource_subscription_ownership")
    out_owners = []
    out = {}
    out["wireAction"] = "none"
    out["changed"] = False
    has_owner = _core_contains(owners, owner)
    is_acquire = _core_eq(operation, "acquire")
    if is_acquire:
        for current in owners:
            out_owners.append(current)
        if has_owner:
            pass
        else:
            before = _core_len(owners)
            was_empty = _core_eq(before, 0)
            if was_empty:
                out["wireAction"] = "subscribe"
            else:
                pass
            out_owners.append(owner)
            out["changed"] = True
    else:
        for current in owners:
            matches = _core_eq(current, owner)
            if matches:
                pass
            else:
                out_owners.append(current)
        if has_owner:
            remaining = _core_len(out_owners)
            now_empty = _core_eq(remaining, 0)
            if now_empty:
                out["wireAction"] = "unsubscribe"
            else:
                pass
            out["changed"] = True
        else:
            pass
    out["owners"] = out_owners
    return out

# END AXIR CORE EMITTED FUNCTIONS


AX_MCP_PROTOCOL_VERSION = "2025-11-25"
AX_MCP_SUPPORTED_PROTOCOL_VERSIONS = [
    "2026-07-28",
    AX_MCP_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
]


class AxMCPError(RuntimeError):
    def __init__(self, message: str, *, code: int | None = None, data: Any = None):
        super().__init__(message)
        self.code = code
        self.data = data


@dataclass
class AxMCPTokenSet:
    accessToken: str
    refreshToken: str | None = None
    expiresAt: int | None = None
    issuer: str | None = None


@dataclass
class AxMCPOAuthOptions:
    clientId: str | None = None
    clientSecret: str | None = None
    redirectUri: str | None = None
    scopes: list[str] | None = None
    onAuthCode: Callable[[str], dict[str, str]] | None = None
    tokenStore: Any = None
    ssrfProtection: dict[str, Any] | None = None


@dataclass
class AxMCPContinuationState:
    namespaces: list[str]
    tasks: list[dict[str, Any]]
    subscriptions: list[dict[str, Any]]
    catalogFingerprint: str


@dataclass(frozen=True)
class AxEventEnvelope:
    id: str
    source: str
    type: str
    data: Any = None
    subject: str | None = None
    specversion: str = "1.0"
    extensions: dict[str, Any] = field(default_factory=dict)
    correlation: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        value = {
            "specversion": self.specversion,
            "id": self.id,
            "source": self.source,
            "type": self.type,
        }
        if self.subject is not None:
            value["subject"] = self.subject
        if self.data is not None:
            value["data"] = self.data
        if self.extensions:
            value["extensions"] = dict(self.extensions)
        if self.correlation:
            value["correlation"] = list(self.correlation)
        return value


@dataclass(frozen=True)
class AxEventPath:
    root: str
    segments: tuple[str | int, ...] = ()
    correlationKind: str | None = None
    value: Any = None

    def __post_init__(self):
        for segment in self.segments:
            if (isinstance(segment, str) and (not segment or segment in {"__proto__", "constructor", "prototype"})) or (isinstance(segment, int) and segment < 0):
                raise AxEventInputError(f"Unsafe event path segment: {segment}")

    def to_dict(self):
        value = {"root": self.root, "segments": list(self.segments)}
        if self.correlationKind is not None: value["correlationKind"] = self.correlationKind
        if self.root == "constant": value["value"] = self.value
        return value


class event_path:
    @staticmethod
    def data(*segments): return AxEventPath("data", tuple(segments))
    @staticmethod
    def envelope(*segments): return AxEventPath("envelope", tuple(segments))
    @staticmethod
    def extension(name): return AxEventPath("extensions", (name,))
    @staticmethod
    def identity(*segments): return AxEventPath("identity", tuple(segments))
    @staticmethod
    def trust(): return AxEventPath("trust")
    @staticmethod
    def correlation(kind): return AxEventPath("correlation", correlationKind=kind)
    @staticmethod
    def continuation(*segments): return AxEventPath("continuation", tuple(segments))
    @staticmethod
    def constant(value): return AxEventPath("constant", value=value)
    @staticmethod
    def subject(): return AxEventPath("envelope", ("subject",))


@dataclass(frozen=True)
class AxEventInputPlan:
    project: AxEventPath | None = None
    fields: tuple[tuple[str, AxEventPath], ...] = ()

    def to_dict(self):
        return {"project": self.project.to_dict() if self.project else None,
                "fields": [{"field": name, "path": path.to_dict()} for name, path in self.fields]}


class AxEventInputBuilder:
    def __init__(self): self._project = None; self._fields = []
    def project(self, path):
        if self._project is not None: raise AxEventInputError("An event input plan may project only one path")
        self._project = path; return self
    def field(self, name, path):
        if not name or name in {"__proto__", "constructor", "prototype"}: raise AxEventInputError(f"Unsafe target field: {name}")
        if any(existing == name for existing, _ in self._fields): raise AxEventInputError(f"Event input field {name} is mapped more than once")
        self._fields.append((name, path)); return self
    def build(self): return AxEventInputPlan(self._project, tuple(self._fields))


def event_input(): return AxEventInputBuilder()


@dataclass(frozen=True)
class AxEventRoute:
    id: str
    action: str
    match: dict[str, Any]
    targetId: str | None = None
    requireAuthenticated: bool = False
    ordering: str = "strict"
    debounceMs: int = 0
    instanceKey: AxEventPath | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "action": self.action,
            "match": self.match,
            "targetId": self.targetId,
            "requireAuthenticated": self.requireAuthenticated,
            "ordering": self.ordering,
            "debounceMs": self.debounceMs,
            "instanceKey": self.instanceKey.to_dict() if self.instanceKey else None,
        }


@dataclass(frozen=True)
class AxEventCommand:
    routeId: str
    action: str
    instanceKey: str
    idempotencyKey: str
    targetId: str | None = None


@dataclass(frozen=True)
class AxEventPublishReceipt:
    eventId: str
    accepted: bool
    duplicate: bool
    durability: str
    deliveryIds: list[str]


@dataclass
class AxEventRun:
    id: str
    deliveryId: str
    routeId: str
    targetId: str | None
    instanceKey: str
    status: str = "queued"
    attempt: int = 0
    output: Any = None
    error: str | None = None
    continuationIds: list[str] = field(default_factory=list)


@dataclass
class AxEventDeadLetter:
    id: str
    deliveryId: str
    reason: str
    runId: str | None = None
    sinkId: str | None = None


@dataclass
class AxEventContinuation:
    id: str
    targetId: str
    instanceKey: str
    identityScope: str
    correlation: list[dict[str, str]]
    metadata: dict[str, Any] = field(default_factory=dict)
    completed: bool = False
    expiresAt: float | None = None


class AxEventCancellationToken:
    def __init__(self): self.cancelled = False; self.reason = None
    def cancel(self, reason="cancelled"): self.cancelled = True; self.reason = reason


@dataclass
class AxEventTarget:
    id: str
    invoke: Callable[[Any, dict[str, Any]], Any]
    mapInput: Callable[[AxEventEnvelope, AxEventContinuation | None], Any] | None = None
    sinks: list[Any] = field(default_factory=list)
    retrySafety: str = "unknown"
    waitFor: list[dict[str, Any]] = field(default_factory=list)
    captureState: Callable[[], Any] | None = None
    restoreState: Callable[[Any], None] | None = None
    signature: AxSignature | None = None
    input: AxEventInputPlan | None = None
    wakeInput: AxEventInputPlan | None = None
    resumeInput: AxEventInputPlan | None = None


class AxEventInputError(ValueError): pass


def _event_plan(value):
    if callable(value): value = value(event_input())
    if isinstance(value, AxEventInputBuilder): value = value.build()
    if not isinstance(value, AxEventInputPlan): raise AxEventInputError("Event input mapping did not produce a plan")
    return value


def _event_validate_signature_value(field, value):
    kind = field.type.name
    values = value if field.type.is_array else [value]
    if field.type.is_array and not isinstance(value, list): raise AxEventInputError(f"Signature input {field.name} failed validation")
    for item in values:
        valid = (kind in {"string", "url", "date", "datetime", "code", "file", "image", "audio", "class"} and isinstance(item, str)) or (kind == "number" and isinstance(item, (int, float)) and not isinstance(item, bool)) or (kind == "boolean" and isinstance(item, bool)) or (kind in {"object", "json", "dateRange", "datetimeRange"} and isinstance(item, (dict, list)))
        if not valid: raise AxEventInputError(f"Signature input {field.name} failed validation")


def _event_map_target_input(target, event, continuation, action, identity_scope, trust):
    plan = (target.resumeInput if action == "resume" else target.wakeInput) or target.input
    if plan is None:
        mapped = target.mapInput(event, continuation) if target.mapInput else event.data
    else:
        if target.signature is None: raise AxEventInputError(f"Target {target.id} requires a signature for declarative input mapping")
        ingress = {"event": event.to_dict(), "identity": {"scope": identity_scope}, "trust": trust, "correlation": event.correlation}
        fields = [{"name": field.name, "optional": field.is_optional} for field in target.signature.get_input_fields()]
        result = event_map_input(ingress, plan.to_dict(), fields, vars(continuation) if continuation else None)
        if not result.get("ok"): raise AxEventInputError(str(result.get("error") or "Event input mapping failed"))
        mapped = result["value"]
    if target.signature is not None:
        signature_fields = target.signature.get_input_fields()
        descriptors = [{"name": field.name, "optional": field.is_optional} for field in signature_fields]
        normalized = event_normalize_input(mapped, descriptors)
        if not normalized.get("ok"):
            raise AxEventInputError(str(normalized.get("error") or "Event input normalization failed"))
        mapped = normalized["value"]
        for field in signature_fields:
            if field.name not in mapped:
                if not field.is_optional: raise AxEventInputError(f"Required signature input {field.name} was not present")
                continue
            _event_validate_signature_value(field, mapped[field.name])
    return mapped


class AxEventTargetBuilder:
    def __init__(self, id): self.value = {"id": id, "sinks": [], "waitFor": []}
    def signature(self, value): self.value["signature"] = value if isinstance(value, AxSignature) else AxSignature(value); return self
    def invoke(self, callback): self.value["invoke"] = callback; return self
    def program(self, program, client, signature=None):
        self.value["signature"] = signature or getattr(program, "signature", None)
        self.value["invoke"] = lambda input, _context: program.forward(client, input)
        return self
    def map_input(self, callback): self.value["mapInput"] = callback; return self
    def input(self, value): self.value["input"] = _event_plan(value); return self
    def wake_input(self, value): self.value["wakeInput"] = _event_plan(value); return self
    def resume_input(self, value): self.value["resumeInput"] = _event_plan(value); return self
    def sink(self, value): self.value["sinks"].append(value); return self
    def retry_safety(self, value): self.value["retrySafety"] = value; return self
    def wait_for(self, kind, path, **options): self.value["waitFor"].append({"kind": kind, "value": path.to_dict(), **options}); return self
    def build(self):
        if "invoke" not in self.value: raise ValueError("Event target requires an invoker or program")
        plans = [self.value.get(name) for name in ("input", "wakeInput", "resumeInput") if self.value.get(name) is not None]
        if plans and self.value.get("mapInput") is not None: raise ValueError("Declarative mappings and mapInput are mutually exclusive")
        if plans and self.value.get("signature") is None: raise ValueError("Declarative event mappings require a signature")
        return AxEventTarget(**self.value)


def event_target(id): return AxEventTargetBuilder(id)


class AxEventRouteBuilder:
    def __init__(self, id): self.id = id; self.match = {}; self.auth = False; self.instance = None; self.action = None; self.target = None
    def types(self, *values): self.match["types"] = list(values); return self
    def sources(self, *values): self.match["sources"] = list(values); return self
    def authenticated(self): self.auth = True; return self
    def instance_key(self, path): self.instance = path; return self
    def wake(self, target): self.action = "wake"; self.target = target.id if isinstance(target, AxEventTarget) else str(target); return self
    def resume(self): self.action = "resume"; return self
    def observe(self): self.action = "observe"; return self
    def invalidate(self): self.action = "invalidate"; return self
    def build(self):
        if self.action is None: raise ValueError("Event route requires one action")
        return AxEventRoute(self.id, self.action, dict(self.match), self.target, self.auth, instanceKey=self.instance)


def event_route(id): return AxEventRouteBuilder(id)


class AxEventSource:
    def start(self, publish: Callable[[dict[str, Any]], Any]) -> Any:
        raise NotImplementedError


class AxEventSink:
    def write(self, output: Any, context: dict[str, Any]) -> None:
        raise NotImplementedError


class AxEventClock:
    def now(self) -> float:
        raise NotImplementedError

    def sleep(self, seconds: float, cancellation: AxEventCancellationToken | None = None) -> bool:
        raise NotImplementedError


class AxSystemEventClock(AxEventClock):
    def now(self) -> float: return time.time() * 1000
    def sleep(self, seconds, cancellation=None):
        if cancellation is not None and cancellation.cancelled: return False
        time.sleep(max(0.0, seconds))
        return cancellation is None or not cancellation.cancelled


class AxManualEventClock(AxEventClock):
    def __init__(self, now=0): self._now = float(now); self._condition = threading.Condition(); self._sleepers = 0
    def now(self):
        with self._condition: return self._now
    def advance(self, milliseconds):
        with self._condition:
            self._now += float(milliseconds); self._condition.notify_all()
    def wait_for_sleepers(self, count=1):
        with self._condition:
            while self._sleepers < count: self._condition.wait()
    def sleep(self, seconds, cancellation=None):
        target = self.now() + max(0.0, seconds) * 1000
        with self._condition:
            self._sleepers += 1; self._condition.notify_all()
            try:
                while self._now < target:
                    if cancellation is not None and cancellation.cancelled: return False
                    self._condition.wait()
            finally:
                self._sleepers -= 1
        return cancellation is None or not cancellation.cancelled


class AxEventStore:
    def enqueue(self, event: dict[str, Any], commands: list[dict[str, Any]]) -> None:
        raise NotImplementedError


class AxInMemoryEventStore(AxEventStore):
    """Volatile single-worker store used by generated packages."""
    def __init__(self, *, maxPending=10_000, maxQueuedBytes=64 * 1024 * 1024,
                 maxEnvelopeBytes=1024 * 1024, publishTimeoutMs=5_000,
                 clock=None):
        self.deliveries: dict[str, dict[str, Any]] = {}
        self.runs: dict[str, AxEventRun] = {}
        self.deadLetters: dict[str, AxEventDeadLetter] = {}
        self.continuations: dict[str, AxEventContinuation] = {}
        self.programState: dict[str, Any] = {}
        self.maxPending = int(maxPending)
        self.maxQueuedBytes = int(maxQueuedBytes)
        self.maxEnvelopeBytes = int(maxEnvelopeBytes)
        self.publishTimeoutMs = int(publishTimeoutMs)
        self.clock = clock or AxSystemEventClock()
        self.queuedBytes = 0
        self._sequence = 0
        self._capacity = threading.Condition()

    def enqueue(self, event, commands, available_at=None):
        raw = event.to_dict() if isinstance(event, AxEventEnvelope) else event
        envelope_size = len(json.dumps(raw, separators=(",", ":"), default=str).encode("utf-8"))
        if envelope_size > self.maxEnvelopeBytes:
            raise AxEventInputError(f"Event envelope exceeds {self.maxEnvelopeBytes} bytes")
        new_commands = [command for command in commands
                        if f"{command.routeId}:{event.id}" not in self.deliveries]
        required = envelope_size * len(new_commands)
        deadline = self.clock.now() + self.publishTimeoutMs
        while new_commands:
            with self._capacity:
                pending = sum(1 for value in self.deliveries.values() if value["status"] == "queued")
                if pending + len(new_commands) <= self.maxPending and self.queuedBytes + required <= self.maxQueuedBytes:
                    break
            remaining = deadline - self.clock.now()
            if remaining <= 0: raise RuntimeError("AxEventBackpressureError: event inbox capacity timed out")
            self.clock.sleep(min(remaining, 50) / 1000)
        with self._capacity:
            for command in new_commands:
                delivery_id = f"{command.routeId}:{event.id}"
                self._sequence += 1
                self.deliveries[delivery_id] = {"event": event, "command": command,
                    "status": "queued", "availableAt": self.clock.now() if available_at is None else available_at,
                    "sequence": self._sequence, "size": envelope_size, "attempt": 0}
                self.queuedBytes += envelope_size

    def release(self, delivery):
        with self._capacity:
            self.queuedBytes = max(0, self.queuedBytes - int(delivery.get("size", 0)))
            delivery["size"] = 0
            self._capacity.notify_all()

    def requeue(self, delivery, available_at):
        raw = delivery["event"].to_dict() if isinstance(delivery["event"], AxEventEnvelope) else delivery["event"]
        size = len(json.dumps(raw, separators=(",", ":"), default=str).encode("utf-8"))
        with self._capacity:
            delivery["size"] = size; delivery["status"] = "queued"; delivery["availableAt"] = available_at
            self.queuedBytes += size; self._capacity.notify_all()


class AxPushEventSource(AxEventSource):
    def __init__(self, id="push"): self.id = id; self._publish = None
    def start(self, publish): self._publish = publish; return self
    def publish(self, event, **options):
        if self._publish is None: raise RuntimeError("AxPushEventSource is not started")
        return self._publish(event, **options)
    def close(self): self._publish = None


class AxEventRuntime:
    """Deterministic inline single-worker runtime; no background thread is hidden."""

    def __init__(self, routes: list[AxEventRoute], options: dict[str, Any] | None = None):
        self.routes = list(routes)
        self.options = dict(options or {})
        configured_targets = self.options.get("targets") or {}
        self.targets = ({target.id: target for target in configured_targets}
                        if isinstance(configured_targets, (list, tuple)) else dict(configured_targets))
        self.sources = list(self.options.get("sources") or [])
        self.clock = self.options.get("clock") or AxSystemEventClock()
        self.store = self.options.get("store") or AxInMemoryEventStore(
            maxPending=self.options.get("maxPending", 10_000),
            maxQueuedBytes=self.options.get("maxQueuedBytes", 64 * 1024 * 1024),
            maxEnvelopeBytes=self.options.get("maxEnvelopeBytes", 1024 * 1024),
            publishTimeoutMs=self.options.get("publishTimeoutMs", 5_000), clock=self.clock)
        self.max_attempts = int(self.options.get("maxAttempts", 3))
        self.retry_backoff_ms = int(self.options.get("retryBackoffMs", 1_000))
        self.started = False
        self.closed = False
        self._active: dict[str, AxEventCancellationToken] = {}
        self.descriptor = event_runtime_descriptor(
            [route.to_dict() for route in self.routes], self.options
        )

    def start(self):
        if self.closed: raise RuntimeError("AxEventRuntime is closed")
        if self.started: return self
        self.started = True
        for source in self.sources:
            source.start(self.publish)
        return self

    def plan(
        self,
        event: AxEventEnvelope | dict[str, Any],
        *,
        identity_scope: str = "anonymous",
        trust: str = "untrusted",
    ) -> list[AxEventCommand]:
        envelope = event.to_dict() if isinstance(event, AxEventEnvelope) else dict(event)
        values = event_route_commands(
            envelope,
            [route.to_dict() for route in self.routes],
            identity_scope,
            trust,
        )
        commands = [AxEventCommand(**value) for value in values]
        ingress = {"event": envelope, "identity": {"scope": identity_scope}, "trust": trust,
                   "correlation": envelope.get("correlation") or []}
        routes = {route.id: route for route in self.routes}
        for command in commands:
            route = routes[command.routeId]
            if route.instanceKey is not None:
                resolved = event_resolve_path(ingress, route.instanceKey.to_dict(), None)
                if resolved is None: raise AxEventInputError(f"Route {route.id} instance key was not present")
                object.__setattr__(command, "instanceKey", str(resolved))
        return commands

    def publish(
        self,
        event: AxEventEnvelope | dict[str, Any],
        *,
        identity_scope: str = "anonymous",
        trust: str = "untrusted",
    ) -> AxEventPublishReceipt:
        if not self.started: raise RuntimeError("AxEventRuntime must be started first")
        envelope = event if isinstance(event, AxEventEnvelope) else AxEventEnvelope(
            str(event.get("id", "")), str(event.get("source", "")), str(event.get("type", "")),
            event.get("data"), event.get("subject"), str(event.get("specversion", "1.0")),
            dict(event.get("extensions") or {}), list(event.get("correlation") or []))
        commands = self.plan(envelope, identity_scope=identity_scope, trust=trust)
        delivery_ids = [f"{command.routeId}:{envelope.id}" for command in commands]
        duplicate = bool(delivery_ids) and all(delivery_id in self.store.deliveries for delivery_id in delivery_ids)
        routes = {route.id: route for route in self.routes}
        now = self.clock.now()
        for command in commands:
            route = routes[command.routeId]
            if route.debounceMs > 0:
                for existing in self.store.deliveries.values():
                    old = existing["command"]
                    if (existing["status"] == "queued" and old.routeId == command.routeId and
                            old.targetId == command.targetId and old.instanceKey == command.instanceKey):
                        existing["status"] = "coalesced"; self.store.release(existing)
        for command in commands:
            self.store.enqueue(envelope, [command], now + routes[command.routeId].debounceMs)
        for delivery_id in delivery_ids:
            self.store.deliveries[delivery_id]["identityScope"] = identity_scope
            self.store.deliveries[delivery_id]["trust"] = trust
        if not duplicate: self.run_due()
        return AxEventPublishReceipt(envelope.id, True, duplicate, "volatile", delivery_ids)

    def next_due_at(self):
        values = [value.get("availableAt", 0) for value in self.store.deliveries.values()
                  if value["status"] == "queued"]
        return min(values) if values else None

    def run_due(self):
        processed = 0
        while True:
            due = [(key, value) for key, value in self.store.deliveries.items()
                   if value["status"] == "queued" and value.get("availableAt", 0) <= self.clock.now()
                   and self._strict_delivery_eligible(value)]
            if not due: return processed
            due.sort(key=lambda item: (item[1].get("availableAt", 0), item[1].get("sequence", 0)))
            _, delivery = due[0]
            delivery["status"] = "running"; self.store.release(delivery)
            self._dispatch(delivery["event"], delivery["command"],
                           delivery.get("identityScope", "anonymous"), delivery.get("trust", "untrusted"))
            processed += 1

    def _strict_delivery_eligible(self, candidate):
        routes = {route.id: route for route in self.routes}
        def descriptor(delivery):
            command = delivery["command"]
            route = routes.get(command.routeId)
            return {"sequence": delivery.get("sequence", 0),
                    "targetId": command.targetId or "", "instanceKey": command.instanceKey,
                    "status": delivery.get("status", "queued"),
                    "ordering": route.ordering if route is not None else "strict"}
        return bool(event_strict_delivery_eligible(
            descriptor(candidate), [descriptor(value) for value in self.store.deliveries.values()]))

    def _dispatch(self, event, command, identity_scope, trust="untrusted"):
        delivery_id = f"{command.routeId}:{event.id}"
        delivery = self.store.deliveries[delivery_id]
        continuation = None
        target_id = command.targetId
        if command.action == "resume":
            continuation = self._find_continuation(event.correlation, identity_scope)
            if continuation is None:
                self._dead_letter(delivery_id, None, "continuation_not_found")
                return
            target_id = continuation.targetId
        if command.action in ("observe", "invalidate"):
            delivery["status"] = "succeeded"
            return
        target = self.targets.get(target_id)
        if target is None:
            self._dead_letter(delivery_id, None, f"unknown_target:{target_id}")
            return
        run_id = delivery.get("runId") or f"run:{delivery_id}:{len(self.store.runs)+1}"
        run = self.store.runs.get(run_id) or AxEventRun(run_id, delivery_id, command.routeId, target.id, command.instanceKey)
        self.store.runs[run_id] = run; delivery["runId"] = run_id
        token = AxEventCancellationToken()
        self._active[run_id] = token
        state_key = f"{target.id}\n{identity_scope}\n{command.instanceKey}"
        if target.restoreState and state_key in self.store.programState:
            target.restoreState(self.store.programState[state_key])
        try:
            try:
                mapped = _event_map_target_input(target, event, continuation, command.action, identity_scope, trust)
            except Exception as error:
                raise AxEventInputError(str(error)) from error
            attempt = int(delivery.get("attempt", 0)) + 1
            delivery["attempt"] = attempt
            run.attempt = attempt; run.status = "running"
            try:
                output = target.invoke(mapped, {"runId": run_id, "deliveryId": delivery_id,
                    "instanceKey": command.instanceKey, "identityScope": identity_scope,
                    "idempotencyKey": command.idempotencyKey, "cancellation": token,
                    "continuation": continuation})
                if token.cancelled:
                    run.status = "cancelled"; delivery["status"] = "cancelled"; return
                if target.captureState: self.store.programState[state_key] = target.captureState()
                run.output = output
                registrations = self._register_declared(target, event, command, identity_scope)
                if registrations:
                    run.continuationIds = registrations; run.status = "waiting_event"; delivery["status"] = "waiting_event"
                else:
                    run.status = "succeeded"; delivery["status"] = "succeeded"
                    # The run, including output, is already in the store before sinks execute.
                    for sink in target.sinks:
                        try: sink.write(output, {"run": run, "idempotencyKey": f"{run_id}:{getattr(sink, 'id', 'sink')}"})
                        except Exception as error:
                            self._dead_letter(delivery_id, run_id, str(error), getattr(sink, "id", "sink"))
                if continuation: continuation.completed = True
                return
            except Exception as error:
                if attempt < self.max_attempts and target.retrySafety == "idempotent":
                    run.status = "queued"; self.store.requeue(delivery, self.clock.now() + self.retry_backoff_ms * (2 ** (attempt - 1))); return
                run.status = "outcome_unknown" if target.retrySafety != "idempotent" else "failed"
                run.error = str(error); delivery["status"] = run.status
                self._dead_letter(delivery_id, run_id, str(error)); return
        except AxEventInputError as error:
            run.status = "failed"; run.error = f"event_input_invalid:{error}"; delivery["status"] = "dead_lettered"
            self._dead_letter(delivery_id, run_id, run.error)
        finally:
            self._active.pop(run_id, None)

    def _register_declared(self, target, event, command, identity_scope):
        ids = []
        for declaration in target.waitFor:
            raw = declaration.get("value")
            if isinstance(raw, dict) and "root" in raw:
                value = event_resolve_path({"event": event.to_dict(), "identity": {"scope": identity_scope}, "correlation": event.correlation}, raw, None)
            else:
                value = raw(event) if callable(raw) else (event.data or {}).get(raw) if isinstance(raw, str) and isinstance(event.data, dict) else raw
            if value is None: raise AxEventInputError("continuation value is missing")
            continuation_id = f"continuation:{target.id}:{len(self.store.continuations)+1}"
            metadata = declaration.get("metadata") or {}
            if callable(metadata): metadata = metadata(event)
            expires = declaration.get("expiresInMs")
            self.store.continuations[continuation_id] = AxEventContinuation(
                continuation_id, target.id, command.instanceKey, identity_scope,
                [{"kind": str(declaration["kind"]), "value": str(value)}], dict(metadata),
                False, self.clock.now() + float(expires) if expires is not None else None)
            ids.append(continuation_id)
        return ids

    def _find_continuation(self, correlation, identity_scope):
        for continuation in self.store.continuations.values():
            if (continuation.completed or continuation.identityScope != identity_scope or
                    (continuation.expiresAt is not None and continuation.expiresAt <= self.clock.now())): continue
            for key in correlation or []:
                if key in continuation.correlation: return continuation
        return None

    def _dead_letter(self, delivery_id, run_id, reason, sink_id=None):
        value = AxEventDeadLetter(f"dead:{len(self.store.deadLetters)+1}", delivery_id, reason, run_id, sink_id)
        self.store.deadLetters[value.id] = value
        if sink_id is None and delivery_id in self.store.deliveries:
            self.store.deliveries[delivery_id]["status"] = "dead_lettered"

    def cancel_run(self, run_id, reason="cancelled"):
        token = self._active.get(run_id)
        if token is None: return False
        token.cancel(reason); return True

    def get_run(self, run_id): return self.store.runs.get(run_id)
    def list_dead_letters(self): return list(self.store.deadLetters.values())
    def redrive(self, dead_letter_id):
        dead = self.store.deadLetters.pop(dead_letter_id)
        delivery = self.store.deliveries[dead.deliveryId]
        if dead.sinkId is not None:
            run = self.store.runs.get(dead.runId)
            target = self.targets.get(run.targetId if run else None)
            sink = next((value for value in (target.sinks if target else [])
                         if getattr(value, "id", "sink") == dead.sinkId), None)
            if run is None or target is None or sink is None:
                self.store.deadLetters[dead.id] = dead
                raise RuntimeError("sink redrive state is unavailable")
            try:
                sink.write(run.output, {"run": run, "idempotencyKey": f"{run.id}:{dead.sinkId}"})
            except Exception:
                self.store.deadLetters[dead.id] = dead
                raise
            return
        delivery["attempt"] = 0
        self.store.requeue(delivery, self.clock.now())
        self.run_due()

    def close(self):
        for source in self.sources:
            close = getattr(source, "close", None)
            if callable(close): close()
        self.started = False; self.closed = True

    @staticmethod
    def normalize_mcp(namespace: str, method: str, params: Any) -> dict[str, Any]:
        return event_normalize_mcp(namespace, method, params)


class AxMCPTransport:
    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def send_notification(self, message: dict[str, Any]) -> None:
        raise NotImplementedError

    def send_with_headers(self, message: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
        return self.send(message)

    def send_response(self, message: dict[str, Any]) -> None:
        self.send_notification(message)

    def set_message_handler(self, handler: Callable[[dict[str, Any]], None]) -> None:
        self._message_handler = handler

    def set_protocol_version(self, protocol_version: str) -> None:
        self.protocol_version = protocol_version

    def set_era(self, era: str) -> None:
        return None

    @property
    def era_hint(self) -> str | None:
        return None

    @property
    def era_cache_key(self) -> str | None:
        return None

    def connect(self) -> None:
        return None

    def set_lifecycle_handler(self, handler: Callable[[str], None]) -> None:
        self._lifecycle_handler = handler

    def start_listening(self) -> None:
        return None

    def close(self) -> None:
        return None


class AxMCPScriptedTransport(AxMCPTransport):
    def __init__(self, responses: list[dict[str, Any]] | None = None):
        self.responses = list(responses or [])
        self.requests: list[dict[str, Any]] = []
        self.notifications: list[dict[str, Any]] = []
        self.sent_responses: list[dict[str, Any]] = []
        self.request_headers: list[dict[str, str]] = []
        self.protocol_version: str | None = None
        self.session_id: str | None = None
        self._message_handler: Callable[[dict[str, Any]], None] | None = None

    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        self.requests.append(json.loads(json.dumps(message)))
        method = message.get("method")
        match_index = None
        for index, response in enumerate(self.responses):
            if response.get("method", method) == method:
                match_index = index
                break
        raw = self.responses.pop(match_index) if match_index is not None else {"result": {}}
        headers = raw.get("headers") or raw.get("responseHeaders") or {}
        if headers.get("MCP-Session-Id"):
            self.session_id = headers["MCP-Session-Id"]
        if "error" in raw:
            return {"jsonrpc": "2.0", "id": message.get("id"), "error": raw["error"]}
        return {
            "jsonrpc": "2.0",
            "id": message.get("id"),
            "result": raw.get("result", {}),
        }

    def send_with_headers(self, message: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
        self.request_headers.append(dict(headers or {}))
        return self.send(message)

    def send_notification(self, message: dict[str, Any]) -> None:
        self.notifications.append(json.loads(json.dumps(message)))

    def send_response(self, message: dict[str, Any]) -> None:
        self.sent_responses.append(json.loads(json.dumps(message)))

    def emit(self, message: dict[str, Any]) -> None:
        if self._message_handler:
            self._message_handler(message)


_AX_MCP_ERA_CACHE: dict[str, str] = {}


class AxMCPClient:
    def __init__(self, transport: AxMCPTransport, options: dict[str, Any] | None = None):
        self.transport = transport
        self.options = options or {}
        self.server_capabilities: dict[str, Any] = {}
        self.server_info: dict[str, Any] | None = None
        self.server_instructions: str | None = None
        self.negotiated_protocol_version: str | None = None
        self.era: str | None = None
        self.discover_result: dict[str, Any] | None = None
        self.negotiated_extensions: dict[str, Any] = {}
        self.tools: list[dict[str, Any]] = []
        self.prompts: list[dict[str, Any]] = []
        self.resources: list[dict[str, Any]] = []
        self.resource_templates: list[dict[str, Any]] = []
        self.catalog_cache: dict[str, dict[str, Any]] = {}
        self._resource_read_cache: dict[str, dict[str, Any]] = {}
        self.catalog_revision = 0
        self._subscription_owners: dict[str, set[str]] = {}
        self._next_id = 1
        self._notification_listeners: list[Callable[[dict[str, Any]], None]] = []
        self._lifecycle_listeners: list[Callable[[str], None]] = []
        self._initialized = False
        self.transport.set_message_handler(self._handle_inbound_message)
        self.transport.set_lifecycle_handler(self.emit_lifecycle)

    def init(self) -> None:
        if self._initialized:
            return
        self.transport.connect()
        configured = str(self.options.get("era", "auto"))
        key = self.transport.era_cache_key
        stored = None
        era_store = self.options.get("eraStore")
        if isinstance(era_store, dict) and key:
            stored = era_store.get(key)
        resolution = mcp_resolve_known_era(configured, self.transport.era_hint, _AX_MCP_ERA_CACHE.get(key or ""), stored)
        resolved = str(resolution.get("era", "modern"))
        if not resolution.get("probe"):
            if resolved == "legacy":
                self._initialize_legacy()
            else:
                self._apply_era("modern")
                self._apply_discovery(self._request_discovery())
                self.refresh()
            self._remember_era(resolved)
            self._initialized = True
            if resolved == "legacy":
                self.transport.start_listening()
            return
        self._apply_era("modern")
        try:
            self._apply_discovery(self._request_discovery())
        except AxMCPError as error:
            if error.code == -32022:
                raise
            self._initialize_legacy()
            self._remember_era("legacy")
            self._initialized = True
            self.transport.start_listening()
            return
        except Exception:
            self._initialize_legacy()
            self._remember_era("legacy")
            self._initialized = True
            self.transport.start_listening()
            return
        self._remember_era("modern")
        self.refresh()
        self._initialized = True

    def _initialize_legacy(self) -> None:
        self._apply_era("legacy")
        protocol_version = self.options.get("protocolVersion", AX_MCP_PROTOCOL_VERSION)
        result = self._request(
            "initialize",
            {
                "protocolVersion": protocol_version,
                "capabilities": self._client_capabilities(),
                "clientInfo": {
                    "name": "AxMCPClient",
                    "title": "Ax MCP Client",
                    "version": "1.0.0",
                    **(self.options.get("clientInfo") or {}),
                },
            },
        )
        supported = self.options.get("supportedProtocolVersions") or AX_MCP_SUPPORTED_PROTOCOL_VERSIONS
        negotiated = result.get("protocolVersion")
        if negotiated not in supported:
            raise AxMCPError(f"Unsupported MCP protocol version {negotiated}")
        self.negotiated_protocol_version = negotiated
        self.transport.set_protocol_version(negotiated)
        self.server_capabilities = result.get("capabilities") or {}
        self.server_info = result.get("serverInfo") or {}
        self.server_instructions = result.get("instructions")
        self._negotiate_extensions()
        self.notify("notifications/initialized")
        self.refresh()

    def _apply_era(self, era: str) -> None:
        self.era = era
        self.transport.set_era(era)
        if era == "modern":
            self.negotiated_protocol_version = "2026-07-28"
            self.transport.set_protocol_version("2026-07-28")
        else:
            self.negotiated_protocol_version = None

    def _remember_era(self, era: str) -> None:
        key = self.transport.era_cache_key
        if not key:
            return
        _AX_MCP_ERA_CACHE[key] = era
        era_store = self.options.get("eraStore")
        if isinstance(era_store, dict):
            era_store[key] = era

    def _request_discovery(self) -> dict[str, Any]:
        return self._request("server/discover", {})

    def _apply_discovery(self, result: dict[str, Any]) -> None:
        classified = mcp_classify_discovery_result(result)
        if not classified.get("valid"):
            raise AxMCPError("Invalid MCP server/discover result")
        self.discover_result = json.loads(json.dumps(result))
        self.server_capabilities = json.loads(json.dumps(classified.get("capabilities") or {}))
        self.server_instructions = result.get("instructions")
        if isinstance(classified.get("serverInfo"), dict):
            self.server_info = dict(classified["serverInfo"])
        self._negotiate_extensions()

    def _negotiate_extensions(self) -> None:
        client_ext = (self._client_capabilities().get("extensions") or {})
        server_ext = (self.server_capabilities.get("extensions") or {})
        self.negotiated_extensions = mcp_negotiate_extensions(client_ext, server_ext)

    def get_era(self) -> str | None:
        return self.era

    def discover(self) -> dict[str, Any]:
        self.init()
        if self.era != "modern":
            raise AxMCPError("server/discover is only available for modern MCP")
        result = self._request_discovery()
        self._apply_discovery(result)
        return json.loads(json.dumps(result))

    def close(self) -> None:
        self._subscription_owners.clear()
        self.catalog_cache.clear()
        self._resource_read_cache.clear()
        self._initialized = False
        self.transport.close()

    def refresh(self, *, force: bool = True) -> None:
        changed = False
        if self._capability("tools") and (force or not self._catalog_cache_fresh("tools")):
            raw_tools = self._collect_catalog("tools/list", "tools")
            self.tools = []
            for tool in raw_tools:
                try:
                    mcp_param_header_bindings(tool.get("inputSchema") or {})
                    self.tools.append(tool)
                except Exception:
                    logger = self.options.get("logger")
                    if callable(logger):
                        logger(f"Warning: excluded MCP tool {tool.get('name', '')}: invalid x-mcp-header annotation")
            changed = True
        if self._capability("prompts") and (force or not self._catalog_cache_fresh("prompts")):
            self.prompts = self._collect_catalog("prompts/list", "prompts")
            changed = True
        if self._capability("resources"):
            if force or not self._catalog_cache_fresh("resources"):
                self.resources = self._collect_catalog("resources/list", "resources")
                changed = True
            if force or not self._catalog_cache_fresh("resourceTemplates"):
                self.resource_templates = self._collect_catalog("resources/templates/list", "resourceTemplates")
                changed = True
        if changed:
            self.catalog_revision += 1

    def _collect_catalog(self, method: str, field: str) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        pages: list[dict[str, Any]] = []
        cursor = None
        seen: set[str] = set()
        max_pages = int(self.options.get("maxPaginationPages", 1000))
        for _page in range(max_pages):
            result = self._request(method, {"cursor": cursor} if cursor else {})
            pages.append(result)
            values.extend(json.loads(json.dumps(result.get(field) or [])))
            cursor = result.get("nextCursor")
            if not cursor:
                cache_name = {"tools/list": "tools", "prompts/list": "prompts", "resources/list": "resources", "resources/templates/list": "resourceTemplates"}.get(method)
                if cache_name:
                    self.catalog_cache[cache_name] = mcp_fold_cache_info(pages, int(time.time() * 1000))
                return values
            if cursor in seen: raise AxMCPError(f"MCP {method} repeated pagination cursor {cursor}")
            seen.add(cursor)
        raise AxMCPError(f"MCP {method} exceeded {max_pages} pagination pages")

    def _catalog_cache_fresh(self, name: str) -> bool:
        return mcp_cache_freshness(self.catalog_cache.get(name), int(time.time() * 1000))

    def inspect_catalog(self, *, refresh: bool = False) -> dict[str, Any]:
        self.init()
        if refresh: self.refresh()
        return json.loads(json.dumps({
            "namespace": self.namespace(), "protocolVersion": self.negotiated_protocol_version,
            "revision": self.catalog_revision, "serverInfo": self.server_info,
            "serverCapabilities": self.server_capabilities, "tools": self.tools,
            "prompts": self.prompts, "resources": self.resources,
            "resourceTemplates": self.resource_templates,
            "subscriptions": sorted(self._subscription_owners),
        }))

    def ping(self) -> dict[str, Any]:
        return self._request("ping", {})

    def list_tools(self, cursor: str | None = None) -> dict[str, Any]:
        params = {"cursor": cursor} if cursor else {}
        return self._request("tools/list", params)

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        args = arguments or {}
        headers: dict[str, str] = {}
        if self.era == "modern":
            tool = next((item for item in self.tools if item.get("name") == name), None)
            if tool:
                bindings = mcp_param_header_bindings(tool.get("inputSchema") or {})
                headers = {str(key): str(value) for key, value in mcp_param_header_values(bindings, args).items()}
        try:
            return self._request("tools/call", {"name": name, "arguments": args}, extra_headers=headers)
        except AxMCPError as error:
            if self.era != "modern" or error.code != -32020:
                raise
            raw_tools = self._collect_catalog("tools/list", "tools")
            self.tools = []
            for tool in raw_tools:
                try:
                    mcp_param_header_bindings(tool.get("inputSchema") or {})
                    self.tools.append(tool)
                except Exception:
                    pass
            tool = next((item for item in self.tools if item.get("name") == name), None)
            bindings = mcp_param_header_bindings((tool or {}).get("inputSchema") or {})
            headers = {str(key): str(value) for key, value in mcp_param_header_values(bindings, args).items()}
            return self._request("tools/call", {"name": name, "arguments": args}, extra_headers=headers)

    def list_prompts(self, cursor: str | None = None) -> dict[str, Any]:
        return self._request("prompts/list", {"cursor": cursor} if cursor else {})

    def get_prompt(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request("prompts/get", {"name": name, "arguments": arguments or {}})

    def list_resources(self, cursor: str | None = None) -> dict[str, Any]:
        return self._request("resources/list", {"cursor": cursor} if cursor else {})

    def read_resource(self, uri: str) -> dict[str, Any]:
        if self.era == "modern" and self.options.get("readCache"):
            cached = self._resource_read_cache.get(uri)
            if cached and mcp_cache_freshness(cached.get("cache"), int(time.time() * 1000)):
                return json.loads(json.dumps(cached["result"]))
            self._resource_read_cache.pop(uri, None)
        result = self._request("resources/read", {"uri": uri})
        if self.era == "modern" and self.options.get("readCache"):
            cache = mcp_fold_cache_info([result], int(time.time() * 1000))
            if mcp_cache_freshness(cache, int(time.time() * 1000)):
                self._resource_read_cache[uri] = {"result": json.loads(json.dumps(result)), "cache": cache}
        return result

    def subscribe_resource(self, uri: str) -> dict[str, Any]:
        return self.acquire_resource_subscription(uri, "manual")

    def unsubscribe_resource(self, uri: str) -> dict[str, Any]:
        return self.release_resource_subscription(uri, "manual")

    def acquire_resource_subscription(self, uri: str, owner: str) -> dict[str, Any]:
        self._assert_resource_subscriptions()
        transition = mcp_resource_subscription_ownership(
            sorted(self._subscription_owners.get(uri, set())), owner, "acquire"
        )
        result = self._request("resources/subscribe", {"uri": uri}) if transition["wireAction"] == "subscribe" else {}
        self._subscription_owners[uri] = set(transition["owners"])
        return result

    def release_resource_subscription(self, uri: str, owner: str) -> dict[str, Any]:
        self._assert_resource_subscriptions()
        transition = mcp_resource_subscription_ownership(
            sorted(self._subscription_owners.get(uri, set())), owner, "release"
        )
        result = self._request("resources/unsubscribe", {"uri": uri}) if transition["wireAction"] == "unsubscribe" else {}
        if transition["owners"]: self._subscription_owners[uri] = set(transition["owners"])
        else: self._subscription_owners.pop(uri, None)
        return result

    def restore_resource_subscriptions(self) -> None:
        for uri in sorted(self._subscription_owners):
            self._request("resources/subscribe", {"uri": uri})

    def _assert_resource_subscriptions(self) -> None:
        resources = self.server_capabilities.get("resources")
        if not isinstance(resources, dict) or not resources.get("subscribe"):
            raise AxMCPError("Resource subscriptions are not supported")

    def get_task(self, task_id: str) -> dict[str, Any]:
        return self._request("tasks/get", {"taskId": task_id})

    def cancel_task(self, task_id: str) -> dict[str, Any]:
        return self._request("tasks/cancel", {"taskId": task_id})

    def list_resource_templates(self, cursor: str | None = None) -> dict[str, Any]:
        return self._request("resources/templates/list", {"cursor": cursor} if cursor else {})

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        if self.era == "modern" and method in {"notifications/initialized", "notifications/roots/list_changed", "notifications/cancelled"}:
            return
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self.transport.send_notification(message)

    def cancel_request(self, request_id: str | int, reason: str | None = None) -> None:
        params: dict[str, Any] = {"requestId": request_id}
        if reason:
            params["reason"] = reason
        self.notify("notifications/cancelled", params)

    def to_function(self) -> list[Tool]:
        out: list[Tool] = []
        for tool in self.tools:
            out.append(self._tool_to_function(tool))
        for prompt in self.prompts:
            out.append(self._prompt_to_function(prompt))
        for resource in self.resources:
            out.append(self._resource_to_function(resource))
        for template in self.resource_templates:
            out.append(self._resource_template_to_function(template))
        return out

    def native_tools(self) -> list[Tool]:
        out: list[Tool] = []
        for tool in self.tools:
            original = tool.get("name", "")
            name = _override_name(original, self.options)
            out.append(Tool(
                name,
                _override_description(tool, self.options),
                tool.get("inputSchema") or {"type": "object", "properties": {}},
                lambda args, original=original: self.call_tool(original, args),
            ))
        return out

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Send any negotiated MCP method without converting it into a function."""
        return self._request(method, params)

    def add_notification_listener(self, listener: Callable[[dict[str, Any]], None]):
        self._notification_listeners.append(listener)
        def remove():
            if listener in self._notification_listeners:
                self._notification_listeners.remove(listener)
        return remove

    def add_lifecycle_listener(self, listener: Callable[[str], None]):
        self._lifecycle_listeners.append(listener)
        def remove():
            if listener in self._lifecycle_listeners:
                self._lifecycle_listeners.remove(listener)
        return remove

    def emit_lifecycle(self, state: str) -> None:
        if state == "reconnected":
            self.restore_resource_subscriptions()
        for listener in list(self._lifecycle_listeners):
            listener(state)

    def namespace(self) -> str:
        return str(self.options.get("namespace") or (self.server_info or {}).get("name") or "mcp")

    def _request(self, method: str, params: dict[str, Any] | None = None, *, extra_headers: dict[str, str] | None = None, allow_version_retry: bool = True) -> dict[str, Any]:
        request_id = str(self._next_id)
        self._next_id += 1
        message: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
        request_params = dict(params or {})
        if self.era == "modern":
            existing = request_params.get("_meta") if isinstance(request_params.get("_meta"), dict) else {}
            request_params["_meta"] = mcp_build_request_meta(
                existing,
                self.negotiated_protocol_version or "2026-07-28",
                self._client_capabilities(),
                {"name": "AxMCPClient", "title": "Ax MCP Client", "version": "1.0.0", **(self.options.get("clientInfo") or {})},
                self.options.get("logLevel"),
                None,
                None,
            )
        if params is not None:
            message["params"] = request_params
        response = self.transport.send_with_headers(message, extra_headers or {})
        if "error" in response:
            error = response["error"] or {}
            protocol_error = AxMCPError(str(error.get("message", "MCP JSON-RPC error")), code=error.get("code"), data=error.get("data"))
            if self.era == "modern" and allow_version_retry and protocol_error.code == -32022:
                version = mcp_select_mutual_version(protocol_error.data or {}, self.options.get("supportedProtocolVersions") or AX_MCP_SUPPORTED_PROTOCOL_VERSIONS)
                if version:
                    self.negotiated_protocol_version = version
                    self.transport.set_protocol_version(version)
                    return self._request(method, params, extra_headers=extra_headers, allow_version_retry=False)
            raise protocol_error
        result = response.get("result") or {}
        if self.era == "modern" and isinstance(result, dict):
            classified = mcp_classify_discovery_result(result)
            meta = result.get("_meta") if isinstance(result.get("_meta"), dict) else {}
            server_info = classified.get("serverInfo")
            if not isinstance(server_info, dict):
                candidate = meta.get("io.modelcontextprotocol/serverInfo")
                if isinstance(candidate, dict) and isinstance(candidate.get("name"), str) and isinstance(candidate.get("version"), str):
                    server_info = candidate
            if isinstance(server_info, dict):
                self.server_info = dict(server_info)
        return result

    def _client_capabilities(self) -> dict[str, Any]:
        capabilities = dict(self.options.get("capabilities") or {})
        derived = mcp_client_capabilities(bool(self.options.get("roots")), bool(self.options.get("sampling")), bool(self.options.get("elicitation")), self.era or "legacy", bool(self.options.get("tasksExtension")))
        for key, value in derived.items():
            capabilities.setdefault(key, value)
        return capabilities

    def _capability(self, name: str) -> bool:
        value = self.server_capabilities.get(name)
        return value is not None and value is not False

    def _handle_inbound_message(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        if method == "roots/list" and "id" in message:
            self.transport.send_response({
                "jsonrpc": "2.0",
                "id": message["id"],
                "result": {"roots": self.options.get("roots") or []},
            })
            return
        if method in {"notifications/tools/list_changed", "notifications/prompts/list_changed", "notifications/resources/list_changed"}:
            self.refresh()
        if method == "notifications/resources/updated":
            uri = (message.get("params") or {}).get("uri")
            if uri:
                self._resource_read_cache.pop(str(uri), None)
        callback = self.options.get("onNotification")
        if callable(callback):
            callback(message)
        for listener in list(self._notification_listeners):
            listener(message)

    def _tool_to_function(self, tool: dict[str, Any]) -> Tool:
        name = _override_name(tool.get("name", ""), self.options)
        description = _override_description(tool, self.options)

        def handler(args: dict[str, Any]) -> Any:
            result = self.call_tool(tool.get("name", name), args)
            if "structuredContent" in result:
                return result["structuredContent"]
            return _content_to_value(result.get("content", []))

        return Tool(name, description, tool.get("inputSchema") or {"type": "object", "properties": {}}, handler)

    def _prompt_to_function(self, prompt: dict[str, Any]) -> Tool:
        name = _override_name("prompt_" + prompt.get("name", ""), self.options)
        description = _override_description(prompt, self.options)
        properties = {arg.get("name", "arg"): {"type": "string", "description": arg.get("description", "")} for arg in prompt.get("arguments", [])}

        def handler(args: dict[str, Any]) -> Any:
            return self.get_prompt(prompt.get("name", ""), args)

        return Tool(name, description, {"type": "object", "properties": properties}, handler)

    def _resource_to_function(self, resource: dict[str, Any]) -> Tool:
        name = _override_name("resource_" + _safe_name(resource.get("name") or resource.get("uri", "resource")), self.options)
        description = _override_description(resource, self.options)
        return Tool(name, description, {"type": "object", "properties": {}}, lambda _args: self.read_resource(resource["uri"]))

    def _resource_template_to_function(self, template: dict[str, Any]) -> Tool:
        name = _override_name("resource_template_" + _safe_name(template.get("name", "template")), self.options)
        description = _override_description(template, self.options)
        return Tool(name, description, {"type": "object", "properties": {"uri": {"type": "string"}}}, lambda args: self.read_resource(args["uri"]))


class AxMCPEventSource(AxEventSource):
    """Composable MCP notification adapter for AxEventRuntime."""
    def __init__(self, client: AxMCPClient, namespace: str | None = None, *,
                 identity_scope: str = "anonymous", trust: str = "untrusted",
                 resource_subscriptions: Any = "none", subscriptions: list[str] | None = None):
        if subscriptions is not None and resource_subscriptions != "none":
            raise ValueError("Specify either resource_subscriptions or subscriptions, not both")
        self.client = client; self.namespace = namespace or client.namespace()
        self.identity_scope = identity_scope; self.trust = trust
        self.resource_subscriptions = subscriptions if subscriptions is not None else resource_subscriptions
        self.subscriptions: list[str] = []; self.owner = f"event-source:{uuid.uuid4()}"
        self.errors: list[Exception] = []; self._publish = None; self._remove = None; self._remove_lifecycle = None

    def start(self, publish):
        self.client.init()
        self._publish = publish
        self._remove = self.client.add_notification_listener(self._on_notification)
        self._remove_lifecycle = self.client.add_lifecycle_listener(
            lambda state: self._reconcile() if state == "reconnected" else None)
        self._reconcile()
        return self

    def _on_notification(self, message):
        if not self._publish or "method" not in message: return
        if message.get("method") == "notifications/resources/list_changed":
            self._reconcile()
        normalized = event_normalize_mcp(self.namespace, str(message["method"]), message.get("params") or {})
        raw_correlation = normalized.get("correlation")
        correlation = [raw_correlation] if isinstance(raw_correlation, dict) else list(raw_correlation or [])
        data = normalized.get("data")
        subject = None
        if isinstance(data, dict):
            subject = data.get("uri") or (data.get("task") or {}).get("taskId")
        self._publish(AxEventEnvelope(
            f"mcp:{self.namespace}:{uuid.uuid4()}", normalized["source"], normalized["type"],
            data, subject, correlation=correlation),
            identity_scope=self.identity_scope, trust=self.trust)

    def reconnect(self):
        self.client.restore_resource_subscriptions()
        self._reconcile()

    def _selected_uris(self, catalog):
        policy = self.resource_subscriptions
        resources = list(catalog.get("resources") or [])
        mode = "none"; explicit = []; candidates = []
        if policy == "all": mode = "all"; candidates = resources
        elif isinstance(policy, (list, tuple)): mode = "explicit"; explicit = [str(uri) for uri in policy]
        elif policy not in (None, "none"):
            selector = policy.get("select") if isinstance(policy, dict) else policy
            if not callable(selector): raise ValueError("Invalid MCP resource subscription policy")
            mode = "selector"; candidates = [resource for resource in resources if selector(resource, catalog)]
        return sorted(mcp_resource_subscription_selection(candidates, mode, explicit))

    def _reconcile(self):
        catalog = self.client.inspect_catalog()
        policy = self.resource_subscriptions
        if policy not in (None, "none"):
            capability = catalog.get("serverCapabilities", {}).get("resources")
            if not isinstance(capability, dict) or not capability.get("subscribe"):
                raise AxMCPError(f"MCP server {catalog['namespace']} does not advertise resource subscriptions")
        try: desired = self._selected_uris(catalog)
        except Exception as error:
            self.errors.append(error); return
        raw = mcp_resource_subscription_plan(desired, self.subscriptions)
        plan = dict(raw or {})
        for uri in plan.get("removals") or []:
            try: self.client.release_resource_subscription(str(uri), self.owner); self.subscriptions.remove(str(uri))
            except Exception as error: self.errors.append(error)
        for uri in plan.get("additions") or []:
            try: self.client.acquire_resource_subscription(str(uri), self.owner); self.subscriptions.append(str(uri)); self.subscriptions.sort()
            except Exception as error: self.errors.append(error)

    def close(self):
        for uri in self.subscriptions:
            try: self.client.release_resource_subscription(uri, self.owner)
            except Exception: pass
        self.subscriptions = []
        if self._remove: self._remove()
        if self._remove_lifecycle: self._remove_lifecycle()
        self._remove = None; self._remove_lifecycle = None; self._publish = None


class AxUCPBinding:
    """Host binding used by generated UCP clients for REST or MCP operations."""

    def call(self, operation: str, payload: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


class AxUCPClient:
    OPERATIONS = (
        "catalog.search", "catalog.lookup", "catalog.product",
        "cart.create", "cart.get", "cart.update", "cart.cancel",
        "checkout.create", "checkout.get", "checkout.update", "checkout.complete", "checkout.cancel",
        "fulfillment.quote", "discounts.apply", "payments.create", "payments.confirm",
        "orders.get", "identity.link", "attribution.record", "handoff.create",
    )

    def __init__(self, profile: dict[str, Any], binding: AxUCPBinding | Callable[..., Any], options: dict[str, Any] | None = None):
        self.profile = dict(profile or {})
        self.binding = binding
        self.options = dict(options or {})
        self.version = str(self.profile.get("version") or self.options.get("version") or "2026-04-08")
        supported = list(self.options.get("supportedVersions") or ["2026-04-08"])
        if self.version not in supported:
            raise ValueError(f"Unsupported UCP version {self.version}")
        self.services = dict(self.profile.get("services") or {})
        self.capabilities = dict(self.profile.get("capabilities") or {})

    def namespace(self) -> str:
        return str(self.options.get("namespace") or self.profile.get("name") or "ucp")

    def call(self, operation: str, payload: dict[str, Any] | None = None, *, idempotency_key: str | None = None) -> dict[str, Any]:
        if operation not in self.OPERATIONS:
            raise ValueError(f"Unsupported UCP operation {operation}")
        call_options = {"version": self.version, "idempotencyKey": idempotency_key or str(uuid.uuid4())}
        if hasattr(self.binding, "call"):
            value = self.binding.call(operation, dict(payload or {}), call_options)
        else:
            value = self.binding(operation, dict(payload or {}), call_options)
        if not isinstance(value, dict):
            raise TypeError("UCP binding must return an object")
        return {
            "operation": operation,
            "value": value,
            "warnings": value.get("warnings"),
            "partialSuccess": bool(value.get("partial_success") or value.get("partialSuccess")),
            "continuationUrl": value.get("continuation_url") or value.get("continuationUrl"),
            "idempotencyKey": call_options["idempotencyKey"],
        }

    def native_tools(self) -> list[Tool]:
        return [
            Tool(
                f"{self.namespace()}_{operation.replace('.', '_')}",
                f"UCP {operation} operation",
                {"type": "object", "properties": {}},
                lambda args, operation=operation: self.call(operation, args),
                namespace=f"ucp.{self.namespace()}",
            )
            for operation in self.OPERATIONS
        ]

    def catalog_search(self, payload=None): return self.call("catalog.search", payload)
    def catalog_lookup(self, payload=None): return self.call("catalog.lookup", payload)
    def catalog_product(self, payload=None): return self.call("catalog.product", payload)
    def cart_create(self, payload=None): return self.call("cart.create", payload)
    def cart_get(self, payload=None): return self.call("cart.get", payload)
    def cart_update(self, payload=None): return self.call("cart.update", payload)
    def cart_cancel(self, payload=None): return self.call("cart.cancel", payload)
    def checkout_create(self, payload=None): return self.call("checkout.create", payload)
    def checkout_get(self, payload=None): return self.call("checkout.get", payload)
    def checkout_update(self, payload=None): return self.call("checkout.update", payload)
    def checkout_complete(self, payload=None): return self.call("checkout.complete", payload)
    def checkout_cancel(self, payload=None): return self.call("checkout.cancel", payload)
    def order_get(self, payload=None): return self.call("orders.get", payload)
    def identity_link(self, payload=None): return self.call("identity.link", payload)


class AxExecutionContext:
    """Live, inheritable MCP/UCP clients shared by every generated Ax program."""

    def __init__(self, mcp=None, ucp=None, options: dict[str, Any] | None = None):
        self.mcp = list(mcp or [])
        self.ucp = list(ucp or [])
        self.options = dict(options or {})
        self._initialized: set[int] = set()
        namespaces = [client.namespace() for client in [*self.mcp, *self.ucp]]
        if len(namespaces) != len(set(namespaces)):
            raise ValueError("MCP/UCP namespace collision")

    def initialize(self):
        for client in self.mcp:
            if id(client) not in self._initialized:
                client.init()
                self._initialized.add(id(client))
        return self

    def native_tools(self) -> list[Tool]:
        self.initialize()
        tools = [tool for client in self.mcp for tool in client.native_tools()]
        tools.extend(tool for client in self.ucp for tool in client.native_tools())
        names = [tool.name for tool in tools]
        if len(names) != len(set(names)):
            raise ValueError("MCP/UCP tool collision")
        return tools

    def runtime_modules(self) -> list[dict[str, Any]]:
        modules = []
        for client in self.mcp:
            modules.append({"name": f"mcp.{client.namespace()}", "functions": client.native_tools(), "client": client})
        for client in self.ucp:
            modules.append({"name": f"ucp.{client.namespace()}", "functions": client.native_tools(), "client": client})
        return modules

    def derive(self, inheritance: Any = "all"):
        if inheritance == "none":
            return AxExecutionContext()
        if isinstance(inheritance, (list, tuple, set)):
            allowed = set(map(str, inheritance))
            return AxExecutionContext(
                [client for client in self.mcp if client.namespace() in allowed],
                [client for client in self.ucp if client.namespace() in allowed],
                self.options,
            )
        return self

    def continuation_state(self) -> dict[str, Any]:
        namespaces = [client.namespace() for client in [*self.mcp, *self.ucp]]
        fingerprint = hashlib.sha256(json.dumps(namespaces, sort_keys=True).encode()).hexdigest()
        return {"namespaces": namespaces, "tasks": [], "subscriptions": [], "catalogFingerprint": fingerprint}


def resolve_execution_context(options: dict[str, Any] | None, parent: AxExecutionContext | None = None) -> AxExecutionContext | None:
    opts = options or {}
    explicit = opts.get("executionContext") or opts.get("mcpExecutionContext")
    if isinstance(explicit, AxExecutionContext):
        return explicit.derive(opts.get("mcpInheritance", "all"))
    mcp = opts.get("mcp")
    ucp = opts.get("ucp")
    if mcp is not None or ucp is not None:
        return AxExecutionContext(mcp if isinstance(mcp, (list, tuple)) else [mcp] if mcp else [], ucp if isinstance(ucp, (list, tuple)) else [ucp] if ucp else [], opts)
    return parent.derive(opts.get("mcpInheritance", "all")) if parent else None


def _ax_mcp_encode_header_value(value: str) -> str:
    if mcp_header_value_plan(value).get("mode") == "plain":
        return value
    encoded = base64.b64encode(value.encode("utf-8")).decode("ascii")
    return f"=?base64?{encoded}?="


class AxMCPStreamableHTTPTransport(AxMCPTransport):
    def __init__(self, endpoint: str, options: dict[str, Any] | None = None):
        self.endpoint = ax_mcp_validate_endpoint(endpoint, (options or {}).get("ssrfProtection"))
        self.options = options or {}
        self.headers = dict(self.options.get("headers") or {})
        if self.options.get("authorization"):
            self.headers["Authorization"] = self.options["authorization"]
        self.protocol_version: str | None = None
        self.session_id: str | None = None
        self.era: str | None = None
        parsed_endpoint = urllib.parse.urlsplit(self.endpoint)
        self._era_cache_key = f"{parsed_endpoint.scheme}://{parsed_endpoint.netloc}"
        self.last_headers: dict[str, str] = {}
        self._message_handler: Callable[[dict[str, Any]], None] | None = None
        self._lifecycle_handler: Callable[[str], None] | None = None
        self._listen_stop = threading.Event()
        self._listen_thread: threading.Thread | None = None
        self._listen_response: Any = None
        self._last_event_id: str | None = None

    def set_headers(self, headers: dict[str, str]) -> None:
        self.headers = dict(headers)

    def set_authorization(self, authorization: str) -> None:
        self.headers["Authorization"] = authorization

    @property
    def era_cache_key(self) -> str:
        return self._era_cache_key

    def set_era(self, era: str) -> None:
        self.era = era
        if era == "modern":
            self.session_id = None
            self.protocol_version = "2026-07-28"
        elif self.protocol_version == "2026-07-28":
            self.protocol_version = None

    def set_lifecycle_handler(self, handler: Callable[[str], None]) -> None:
        self._lifecycle_handler = handler

    def start_listening(self) -> None:
        if self.era == "modern":
            raise AxMCPError("Modern MCP uses subscriptions/listen via openRequestStream, not HTTP GET")
        if self._listen_thread and self._listen_thread.is_alive(): return
        self._listen_stop.clear()
        self._listen_thread = threading.Thread(target=self._listen_loop, name="ax-mcp-sse", daemon=True)
        self._listen_thread.start()

    def _listen_loop(self) -> None:
        connected_once = False
        delay = float(self.options.get("reconnectDelay", 0.1))
        while not self._listen_stop.is_set():
            try:
                headers = self.build_headers({"Accept": "text/event-stream"}, True)
                if self._last_event_id: headers["Last-Event-ID"] = self._last_event_id
                request = urllib.request.Request(self.endpoint, headers=headers, method="GET")
                response = urllib.request.urlopen(request, timeout=float(self.options.get("listenTimeout", 300)))
                self._listen_response = response; self._capture_session(response.headers)
                if connected_once and self._lifecycle_handler: self._lifecycle_handler("reconnected")
                connected_once = True
                data: list[str] = []; event_id: str | None = None
                while not self._listen_stop.is_set():
                    raw = response.readline()
                    if not raw: break
                    line = raw.decode("utf-8").rstrip("\r\n")
                    if line.startswith("id:"): event_id = line[3:].strip()
                    elif line.startswith("data:"): data.append(line[5:].lstrip())
                    elif line == "":
                        if event_id: self._last_event_id = event_id
                        if data:
                            message = json.loads("\n".join(data))
                            if self._message_handler: self._message_handler(message)
                        data = []; event_id = None
                response.close(); self._listen_response = None
                if not self._listen_stop.is_set() and self._lifecycle_handler: self._lifecycle_handler("disconnected")
            except Exception:
                self._listen_response = None
                if not self._listen_stop.is_set() and connected_once and self._lifecycle_handler: self._lifecycle_handler("disconnected")
            if not self._listen_stop.is_set(): self._listen_stop.wait(delay)

    def close(self) -> None:
        self._listen_stop.set()
        if self._listen_response is not None:
            try:
                raw = getattr(getattr(self._listen_response, "fp", None), "raw", None)
                connection = getattr(raw, "_sock", None)
                if connection is not None:
                    connection.shutdown(socket.SHUT_RDWR)
                else:
                    self._listen_response.close()
            except Exception:
                pass
        if self._listen_thread and self._listen_thread is not threading.current_thread():
            self._listen_thread.join(float(self.options.get("closeTimeout", 2)))
        self._listen_thread = None

    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        return self.send_with_headers(message)

    def send_with_headers(self, message: dict[str, Any], extra_headers: dict[str, str] | None = None) -> dict[str, Any]:
        body = json.dumps(message).encode("utf-8")
        headers = self.build_headers(
            {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
            message.get("method") != "initialize",
            str(message.get("method") or ""),
            message.get("params") if isinstance(message.get("params"), dict) else {},
            extra_headers,
        )
        request = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=float(self.options.get("timeout", 30))) as response:
                self._capture_session(response.headers)
                content_type = response.headers.get("Content-Type", "") if hasattr(response.headers, "get") else ""
                text = response.read().decode("utf-8")
                if not text:
                    return {"jsonrpc": "2.0", "id": message.get("id"), "result": {}}
                # A spec-compliant MCP server may answer a JSON-RPC POST with an SSE
                # stream (Content-Type: text/event-stream) carrying the response — and
                # any interleaved notifications/keepalives — in `data:` frames. Parse
                # those rather than JSON-decoding the raw stream; otherwise keep the
                # JSON path. (The optional standalone GET stream for unsolicited
                # server->client messages is out of scope for this request/response
                # transport.)
                if "text/event-stream" in content_type.lower():
                    return self._select_sse_response(_ax_mcp_parse_sse(text), message.get("id"))
                return json.loads(text)
        except urllib.error.HTTPError as error:
            if error.code == 401 and self._apply_oauth():
                return self.send_with_headers(message, extra_headers)
            raise AxMCPError(f"HTTP error {error.code}: {error.reason}")

    def _select_sse_response(self, messages: list[dict[str, Any]], request_id: Any) -> dict[str, Any]:
        # Return the JSON-RPC response whose id matches this request; route any
        # other messages (server notifications/requests interleaved on the POST
        # stream) to the inbound handler, mirroring the stdio transport.
        response: dict[str, Any] | None = None
        for msg in messages:
            if response is None and isinstance(msg, dict) and msg.get("id") == request_id:
                response = msg
                continue
            if self._message_handler:
                self._message_handler(msg)
        if response is not None:
            return response
        return messages[-1] if messages else {"jsonrpc": "2.0", "id": request_id, "result": {}}

    def send_notification(self, message: dict[str, Any]) -> None:
        response = self.send(message)
        if "error" in response:
            error = response["error"]
            raise AxMCPError(str(error.get("message", "MCP notification failed")), code=error.get("code"))

    def build_headers(
        self,
        base: dict[str, str] | None = None,
        include_protocol_version: bool = True,
        method: str | None = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, str]:
        headers = {**self.headers, **(base or {})}
        for key, value in (extra_headers or {}).items():
            headers[key] = _ax_mcp_encode_header_value(str(value)) if self.era == "modern" and key.lower().startswith("mcp-param-") else str(value)
        if self.era != "modern" and self.session_id:
            headers["MCP-Session-Id"] = self.session_id
        if (self.era == "modern" or include_protocol_version) and self.protocol_version:
            headers["MCP-Protocol-Version"] = self.protocol_version
        if self.era == "modern" and method:
            headers["Mcp-Method"] = method
            name = mcp_request_name(method, params or {})
            if name:
                headers["Mcp-Name"] = _ax_mcp_encode_header_value(name)
        self.last_headers = dict(headers)
        return headers

    def terminate_session(self) -> None:
        if self.era == "modern" or not self.session_id:
            return
        self.session_id = None

    def _capture_session(self, headers: Any) -> None:
        if self.era == "modern":
            return
        session_id = headers.get("MCP-Session-Id") if hasattr(headers, "get") else None
        if session_id:
            self.session_id = session_id

    def _apply_oauth(self) -> bool:
        oauth = self.options.get("oauth")
        if oauth is None:
            return False
        if isinstance(oauth, AxMCPOAuthOptions):
            store = oauth.tokenStore
            callback = oauth.onAuthCode
            scopes = oauth.scopes or []
            client_id = oauth.clientId or "ax-mcp-client"
            redirect_uri = oauth.redirectUri or "http://localhost:8787/callback"
        else:
            store = oauth.get("tokenStore")
            callback = oauth.get("onAuthCode")
            scopes = oauth.get("scopes") or []
            client_id = oauth.get("clientId") or "ax-mcp-client"
            redirect_uri = oauth.get("redirectUri") or "http://localhost:8787/callback"
        token = _token_store_get(store, self.endpoint)
        if token and token.get("accessToken"):
            self.headers["Authorization"] = "Bearer " + token["accessToken"]
            return True
        if not callable(callback):
            return False
        verifier = ax_mcp_pkce_verifier()
        challenge = ax_mcp_pkce_challenge(verifier)
        params = urllib.parse.urlencode({
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(scopes),
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        })
        auth = callback(self.endpoint + ("&" if "?" in self.endpoint else "?") + params)
        if not auth or not auth.get("code"):
            return False
        token = {"accessToken": "mcp-auth-code-" + auth["code"], "issuer": self.endpoint}
        _token_store_set(store, self.endpoint, token)
        self.headers["Authorization"] = "Bearer " + token["accessToken"]
        return True


class AxMCPStdioTransport(AxMCPTransport):
    def __init__(self, command: str, args: list[str] | None = None, options: dict[str, Any] | None = None):
        env = None
        if options and options.get("env"):
            env = {**options["env"]}
        self.process = subprocess.Popen([command, *(args or [])], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env)
        self.lock = threading.Lock()
        self.protocol_version: str | None = None
        self._message_handler: Callable[[dict[str, Any]], None] | None = None

    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        if self.process.stdin is None or self.process.stdout is None:
            raise AxMCPError("MCP stdio process is not connected")
        line = ax_mcp_stdio_encode(message)
        with self.lock:
            self.process.stdin.write(line)
            self.process.stdin.flush()
            while True:
                raw = self.process.stdout.readline()
                if raw == "":
                    raise AxMCPError("MCP stdio process closed")
                parsed = ax_mcp_stdio_decode(raw)
                if parsed.get("id") == message.get("id"):
                    return parsed
                if self._message_handler:
                    self._message_handler(parsed)

    def send_notification(self, message: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise AxMCPError("MCP stdio process is not connected")
        self.process.stdin.write(ax_mcp_stdio_encode(message))
        self.process.stdin.flush()

    def close(self) -> None:
        self.process.terminate()


def ax_mcp_stdio_encode(message: dict[str, Any]) -> str:
    return json.dumps(message, separators=(",", ":")) + "\n"


def ax_mcp_stdio_decode(line: str) -> dict[str, Any]:
    return json.loads(line.strip())


def _ax_mcp_parse_sse(text: str) -> list[dict[str, Any]]:
    # Extract JSON-RPC messages from the `data:` frames of an SSE body. Mirrors
    # the AI module's streaming SSE reader but stays self-contained so the MCP
    # module keeps no cross-module dependency (TestPythonModulesSelfContained).
    messages: list[dict[str, Any]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        messages.append(json.loads(data))
    return messages


def ax_mcp_pkce_verifier() -> str:
    return base64.urlsafe_b64encode(uuid.uuid4().bytes + uuid.uuid4().bytes).decode("ascii").rstrip("=")


def ax_mcp_pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def ax_mcp_validate_endpoint(endpoint: str, options: dict[str, Any] | None = None) -> str:
    opts = options or {}
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme not in {"http", "https"}:
        raise AxMCPError("MCP endpoint must use http or https")
    require_https = opts.get("requireHttps", opts.get("require_https", True))
    if require_https and parsed.scheme != "https":
        raise AxMCPError("MCP endpoint must use https")
    host = parsed.hostname
    if not host:
        raise AxMCPError("MCP endpoint must include a host")
    if host in {"localhost", "localhost.localdomain"} and not opts.get("allowLocalhost", opts.get("allow_localhost", False)):
        raise AxMCPError("MCP endpoint host is local")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return endpoint
    allow_private = opts.get("allowPrivateNetworks", opts.get("allow_private_networks", False))
    allow_local = opts.get("allowLocalhost", opts.get("allow_localhost", False))
    if (ip.is_loopback and not allow_local) or (ip.is_private and not allow_private) or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
        raise AxMCPError("MCP endpoint host is not allowed by SSRF protection")
    return endpoint


def _token_store_get(store: Any, key: str) -> dict[str, Any] | None:
    if store is None:
        return None
    if isinstance(store, dict):
        token = store.get(key)
        if token is None and callable(store.get("getToken")):
            token = store["getToken"](key)
        return _token_to_dict(token)
    getter = getattr(store, "getToken", None) or getattr(store, "get_token", None)
    return _token_to_dict(getter(key)) if callable(getter) else None


def _token_store_set(store: Any, key: str, token: dict[str, Any]) -> None:
    if store is None:
        return None
    if isinstance(store, dict):
        if callable(store.get("setToken")):
            store["setToken"](key, token)
        else:
            store[key] = token
        return None
    setter = getattr(store, "setToken", None) or getattr(store, "set_token", None)
    if callable(setter):
        setter(key, token)
    return None


def _token_to_dict(token: Any) -> dict[str, Any] | None:
    if token is None:
        return None
    if isinstance(token, AxMCPTokenSet):
        return {"accessToken": token.accessToken, "refreshToken": token.refreshToken, "expiresAt": token.expiresAt, "issuer": token.issuer}
    if isinstance(token, dict):
        return token
    return None


def _override_name(name: str, options: dict[str, Any]) -> str:
    for item in options.get("functionOverrides") or []:
        if item.get("name") == name:
            return item.get("updates", {}).get("name") or name
    return name


def _override_description(item: dict[str, Any], options: dict[str, Any]) -> str:
    name = item.get("name", "")
    description = item.get("description") or item.get("title") or name
    for override in options.get("functionOverrides") or []:
        if override.get("name") == name:
            return override.get("updates", {}).get("description") or description
    return description


def _safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in value).strip("_") or "item"


def _content_to_value(content: list[dict[str, Any]]) -> Any:
    texts = [item.get("text", "") for item in content if item.get("type") == "text"]
    if texts:
        return {"content": "\n".join(texts)}
    return {"content": content}


def run_mcp_conformance_fixture(fixture: dict[str, Any]) -> None:
    operation = fixture.get("operation", "initialize")
    expected_error = fixture.get("expected_error_contains")
    try:
        if operation == "ssrf":
            ax_mcp_validate_endpoint(fixture.get("endpoint", "https://127.0.0.1/mcp"), fixture.get("ssrfProtection"))
            if expected_error:
                raise AssertionError("expected SSRF validation to fail")
            return
        if operation == "stdio_framing":
            encoded = ax_mcp_stdio_encode(fixture["message"])
            if fixture.get("expected_line") is not None and encoded != fixture["expected_line"]:
                raise AssertionError(f"stdio line mismatch: {encoded!r}")
            decoded = ax_mcp_stdio_decode(encoded)
            _assert_subset(decoded, fixture["message"], "stdio decoded")
            return
        if operation == "oauth":
            challenge = ax_mcp_pkce_challenge(fixture.get("verifier", "test-verifier"))
            if fixture.get("expected_challenge") and challenge != fixture["expected_challenge"]:
                raise AssertionError("PKCE challenge mismatch")
            store: dict[str, Any] = {}
            auth_codes: list[str] = []
            transport = AxMCPStreamableHTTPTransport(
                fixture.get("endpoint", "https://example.com/mcp"),
                {"oauth": {"tokenStore": store, "onAuthCode": lambda url: auth_codes.append(url) or {"code": "abc"}}},
            )
            if not transport._apply_oauth():
                raise AssertionError("OAuth flow did not produce a token")
            if "Authorization" not in transport.headers:
                raise AssertionError("OAuth flow did not set Authorization")
            return
        if operation == "discover":
            constants = mcp_protocol_constants()
            version = fixture.get("protocol_version", "2026-07-28")
            if version not in (constants.get("supportedProtocolVersions") or []):
                raise AssertionError(f"missing supported MCP protocol version {version}")
            request = mcp_jsonrpc_request(
                fixture.get("request_id", "discover-1"),
                "server/discover",
                fixture.get("params") or {},
            )
            _assert_subset(request, fixture.get("expected_request") or {}, "discover request")
            return
        if operation == "modern_headers":
            headers = mcp_modern_request_headers(
                fixture.get("method", "server/discover"),
                fixture.get("resource_name"),
                fixture.get("protocol_version"),
            )
            _assert_subset(headers, fixture.get("expected_headers") or {}, "modern headers")
            for key in fixture.get("forbidden_headers") or []:
                if key in headers:
                    raise AssertionError(f"modern headers contain forbidden {key}")
            return
        if operation == "era_classification":
            classification = mcp_classify_discovery_result(fixture.get("discovery_result"))
            _assert_subset(classification, fixture.get("expected_classification") or {}, "discovery classification")
            for invalid in fixture.get("invalid_discovery_results") or []:
                result = mcp_classify_discovery_result(invalid)
                if result.get("valid") is not False:
                    raise AssertionError(f"invalid discovery result classified as valid: {invalid!r}")
            for case in fixture.get("era_cases") or []:
                actual = mcp_resolve_known_era(case.get("configured", "auto"), case.get("hint"), case.get("cached"), case.get("stored"))
                _assert_subset(actual, case.get("expected") or {}, "era resolution")
            capability_case = fixture.get("capability_case") or {}
            capabilities = mcp_client_capabilities(
                capability_case.get("has_roots", False),
                capability_case.get("has_sampling", False),
                capability_case.get("has_elicitation", False),
                capability_case.get("era", "legacy"),
                capability_case.get("tasks_extension", False),
            )
            _assert_subset(capabilities, capability_case.get("expected") or {}, "client capabilities")
            for case in fixture.get("request_name_cases") or []:
                actual = mcp_request_name(case.get("method", ""), case.get("params") or {})
                if actual != case.get("expected", ""):
                    raise AssertionError(f"request name mismatch: {actual!r}")
            return
        if operation == "mutual_version":
            for case in fixture.get("cases") or []:
                actual = mcp_select_mutual_version(case.get("error_data"), case.get("client_versions") or [])
                if actual != case.get("expected_version", ""):
                    raise AssertionError(f"mutual version mismatch: {actual!r}")
            return
        if operation == "request_meta":
            actual = mcp_build_request_meta(
                fixture.get("existing"),
                fixture.get("protocol_version", "2026-07-28"),
                fixture.get("client_capabilities") or {},
                fixture.get("client_info") or {},
                fixture.get("log_level"),
                fixture.get("traceparent"),
                fixture.get("tracestate"),
            )
            _assert_subset(actual, fixture.get("expected_meta") or {}, "request meta")
            return
        if operation == "extension_negotiation":
            actual = mcp_negotiate_extensions(fixture.get("client_extensions") or {}, fixture.get("server_extensions") or {})
            if actual != (fixture.get("expected_extensions") or {}):
                raise AssertionError(f"extension negotiation mismatch: {actual!r}")
            return
        if operation == "param_headers":
            bindings = mcp_param_header_bindings(fixture.get("input_schema") or {})
            if bindings != (fixture.get("expected_bindings") or []):
                raise AssertionError(f"parameter header bindings mismatch: {bindings!r}")
            values = mcp_param_header_values(bindings, fixture.get("arguments") or {})
            if values != (fixture.get("expected_values") or {}):
                raise AssertionError(f"parameter header values mismatch: {values!r}")
            for invalid in fixture.get("invalid_schemas") or []:
                try:
                    mcp_param_header_bindings(invalid.get("schema") or {})
                except Exception as error:
                    if invalid.get("expected_error_contains", "") not in str(error):
                        raise AssertionError(f"unexpected parameter header error: {error}") from error
                else:
                    raise AssertionError("invalid parameter header schema was accepted")
            for invalid in fixture.get("invalid_values") or []:
                try:
                    mcp_param_header_values(bindings, invalid.get("arguments") or {})
                except Exception as error:
                    if invalid.get("expected_error_contains", "") not in str(error):
                        raise AssertionError(f"unexpected parameter header value error: {error}") from error
                else:
                    raise AssertionError("invalid parameter header value was accepted")
            return
        if operation == "header_value":
            for case in fixture.get("cases") or []:
                actual = mcp_header_value_plan(case.get("value", ""))
                if actual != (case.get("expected_plan") or {}):
                    raise AssertionError(f"header value plan mismatch: {actual!r}")
            return
        if operation == "cache_fold":
            for case in fixture.get("cases") or []:
                actual = mcp_fold_cache_info(case.get("pages") or [], case.get("fetched_at", 0))
                _assert_subset(actual, case.get("expected") or {}, "cache info")
                for field in case.get("forbidden_fields") or []:
                    if field in actual:
                        raise AssertionError(f"cache info contains forbidden field {field}")
                fresh = mcp_cache_freshness(actual, case.get("now", 0))
                if fresh is not case.get("expected_fresh"):
                    raise AssertionError(f"cache freshness mismatch: {fresh!r}")
            return
        if operation == "http_session_headers":
            transport = AxMCPStreamableHTTPTransport(fixture.get("endpoint", "https://example.com/mcp"), fixture.get("transport_options") or {})
            transport.session_id = fixture.get("session_id", "session-1")
            transport.set_protocol_version(fixture.get("protocol_version", AX_MCP_PROTOCOL_VERSION))
            headers = transport.build_headers({"Accept": "application/json"})
            _assert_subset(headers, fixture.get("expected_headers") or {}, "headers")
            return
        if operation == "modern_transport_headers":
            transport = AxMCPStreamableHTTPTransport(fixture.get("endpoint", "https://example.com/mcp"))
            transport.session_id = fixture.get("session_id", "legacy-session")
            transport.set_era(fixture.get("era", "modern"))
            transport.set_protocol_version(fixture.get("protocol_version", "2026-07-28"))
            headers = transport.build_headers(
                {"Accept": "application/json"},
                True,
                fixture.get("method", ""),
                fixture.get("params") or {},
                fixture.get("extra_headers") or {},
            )
            _assert_subset(headers, fixture.get("expected_headers") or {}, "modern headers")
            for name in fixture.get("forbidden_headers") or []:
                if name in headers:
                    raise AssertionError(f"forbidden modern header present: {name}")
            if transport.era_cache_key != fixture.get("expected_era_cache_key"):
                raise AssertionError(f"era cache key mismatch: {transport.era_cache_key!r}")
            try:
                transport.start_listening()
            except Exception as error:
                if fixture.get("expected_listen_error_contains", "") not in str(error):
                    raise
            else:
                raise AssertionError("modern transport allowed legacy HTTP GET listening")
            return

        if operation == "execution_context_ucp":
            transport = AxMCPScriptedTransport(fixture.get("responses") or [])
            mcp = AxMCPClient(transport, fixture.get("client_options") or {})
            ucp = AxUCPClient(
                fixture.get("ucp_profile") or {},
                lambda _operation, _payload, _options: dict(fixture.get("ucp_response") or {}),
                fixture.get("ucp_options") or {},
            )
            context = AxExecutionContext([mcp], [ucp]).initialize()
            names = [client.namespace() for client in [*context.mcp, *context.ucp]]
            if names != list(fixture.get("expected_namespaces") or []):
                raise AssertionError(f"context namespaces mismatch: {names!r}")
            tool_names = [tool.name for tool in context.native_tools()]
            for expected in fixture.get("expected_native_tools") or []:
                if expected not in tool_names:
                    raise AssertionError(f"missing native context tool {expected}")
            call = fixture.get("call_ucp") or {}
            outcome = ucp.call(call.get("operation", "catalog.search"), call.get("payload") or {}, idempotency_key="fixture-key")
            _assert_subset(outcome, fixture.get("expected_ucp_outcome") or {}, "UCP outcome")
            state = context.continuation_state()
            if state.get("namespaces") != names or not state.get("catalogFingerprint"):
                raise AssertionError("invalid execution context continuation state")
            return

        transport = AxMCPScriptedTransport(fixture.get("responses") or fixture.get("transport_responses") or [])
        client = AxMCPClient(transport, fixture.get("client_options") or {})
        if operation == "protocol_negotiation":
            client.init()
            if fixture.get("expected_protocol_version") and client.negotiated_protocol_version != fixture["expected_protocol_version"]:
                raise AssertionError("protocol version mismatch")
            return
        client.init()
        if operation != "client_discovery" and fixture.get("expected_protocol_version") and client.negotiated_protocol_version != fixture["expected_protocol_version"]:
            raise AssertionError("protocol version mismatch")
        if operation == "client_discovery":
            if fixture.get("call_tool"):
                call = fixture["call_tool"]
                result = client.call_tool(call["name"], call.get("arguments") or {})
                _assert_subset(result, fixture.get("expected_call_result") or {}, "tool result")
            if client.get_era() != fixture.get("expected_era"):
                raise AssertionError(f"era mismatch: {client.get_era()!r}")
            if fixture.get("expected_protocol_version") and client.negotiated_protocol_version != fixture["expected_protocol_version"]:
                raise AssertionError("protocol version mismatch")
            _assert_catalog_names(client.tools, fixture.get("expected_tool_names"), "tool names")
            if fixture.get("expected_server_info"):
                _assert_subset(client.server_info or {}, fixture["expected_server_info"], "server info")
            _assert_requests(transport.requests, fixture)
            expected_headers = fixture.get("expected_request_headers") or []
            for index, subset in enumerate(expected_headers):
                _assert_subset(transport.request_headers[index], subset, f"request headers {index}")
            forbidden = set(fixture.get("forbidden_methods") or [])
            methods = [request.get("method") for request in transport.requests] + [item.get("method") for item in transport.notifications]
            if forbidden.intersection(methods):
                raise AssertionError(f"forbidden modern method emitted: {forbidden.intersection(methods)!r}")
            expected_notifications = fixture.get("expected_notification_methods")
            if expected_notifications is not None and [item.get("method") for item in transport.notifications] != expected_notifications:
                raise AssertionError("notification methods mismatch")
            return
        if operation == "read_cache":
            catalog_methods = {"resources/list", "resources/templates/list"}
            client.refresh(force=False)
            catalog_requests = sum(1 for request in transport.requests if request.get("method") in catalog_methods)
            if catalog_requests != fixture.get("expected_catalog_requests_after_fresh_refresh"):
                raise AssertionError(f"fresh catalog issued extra requests: {catalog_requests}")
            first = client.read_resource(fixture.get("uri", ""))
            second = client.read_resource(fixture.get("uri", ""))
            _assert_subset(first, fixture.get("expected_first") or {}, "first resource read")
            _assert_subset(second, fixture.get("expected_first") or {}, "cached resource read")
            transport.emit(fixture.get("notification") or {})
            after = client.read_resource(fixture.get("uri", ""))
            _assert_subset(after, fixture.get("expected_after_update") or {}, "resource read after update")
            reads = sum(1 for request in transport.requests if request.get("method") == "resources/read")
            if reads != fixture.get("expected_read_requests"):
                raise AssertionError(f"resource read request count mismatch: {reads}")
            return
        if operation == "initialize":
            _assert_requests(transport.requests, fixture)
            return
        if operation == "ping":
            client.ping()
            _assert_requests(transport.requests, fixture)
            return
        if operation == "tools":
            functions = client.native_tools()
            names = [fn.name for fn in functions]
            if fixture.get("expected_function_names") and names != fixture["expected_function_names"]:
                raise AssertionError(f"function names mismatch: {names!r}")
            if fixture.get("call_function"):
                call = fixture["call_function"]
                result = next(fn for fn in functions if fn.name == call["name"]).call(call.get("arguments") or {})
                _assert_subset(result, fixture.get("expected_call_result") or {}, "tool result")
            _assert_requests(transport.requests, fixture)
            return
        if operation == "prompts_resources":
            _assert_catalog_names(client.prompts, fixture.get("expected_prompt_names"), "prompt names")
            _assert_catalog_names(client.resources, fixture.get("expected_resource_names"), "resource names")
            _assert_catalog_names(client.resource_templates, fixture.get("expected_resource_template_names"), "resource template names")
            return
        if operation == "roots_notifications":
            transport.emit({"jsonrpc": "2.0", "id": "server-1", "method": "roots/list"})
            if fixture.get("expected_roots_response"):
                _assert_subset(transport.sent_responses[0], fixture["expected_roots_response"], "roots response")
            return
        if operation == "cancellation":
            client.cancel_request(fixture.get("request_id", "1"), fixture.get("reason", "cancelled"))
            _assert_subset(transport.notifications[-1], fixture.get("expected_notification") or {}, "cancel notification")
            return
        raise AssertionError(f"unsupported MCP conformance operation {operation}")
    except Exception as exc:
        if expected_error and expected_error in str(exc):
            return
        raise


def _assert_requests(requests: list[dict[str, Any]], fixture: dict[str, Any]) -> None:
    expected = fixture.get("expected_requests") or []
    if len(requests) < len(expected):
        raise AssertionError(f"expected at least {len(expected)} requests, got {len(requests)}")
    for index, subset in enumerate(expected):
        _assert_subset(requests[index], subset, f"request {index}")


def _assert_catalog_names(catalog: list[dict[str, Any]], expected: Any, label: str) -> None:
    if expected is None:
        return
    names = [str(item.get("name", "")) for item in catalog]
    if names != expected:
        raise AssertionError(f"{label} mismatch: {names!r}")


def _assert_subset(actual: Any, expected: Any, label: str) -> None:
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            raise AssertionError(f"{label}: expected dict, got {type(actual).__name__}")
        for key, value in expected.items():
            if key not in actual:
                raise AssertionError(f"{label}: missing key {key!r}")
            _assert_subset(actual[key], value, label + "." + key)
    elif isinstance(expected, list):
        if not isinstance(actual, list):
            raise AssertionError(f"{label}: expected list, got {type(actual).__name__}")
        if len(actual) < len(expected):
            raise AssertionError(f"{label}: expected list length at least {len(expected)}, got {len(actual)}")
        for index, value in enumerate(expected):
            _assert_subset(actual[index], value, f"{label}[{index}]")
    elif actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")
