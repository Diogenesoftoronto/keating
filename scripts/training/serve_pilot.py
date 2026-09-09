#!/usr/bin/env python3
"""Serve one account's frozen pilot checkpoint on loopback; not production auth."""
from typing import Annotated
import typer
import asyncio
from dataclasses import dataclass
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import stat
import threading
import time
from urllib.parse import urlsplit
import uuid

MODEL_ALIAS = "keating-pilot"
MAX_BODY = 512 * 1024
MAX_PROMPT = 32768
MAX_COMPLETION = 2048
MAX_CONTEXT = 65536
ALLOWED_HEADERS = {"authorization", "content-type", "x-stainless-lang", "x-stainless-package-version",
                   "x-stainless-os", "x-stainless-arch", "x-stainless-runtime", "x-stainless-runtime-version",
                   "x-stainless-retry-count", "x-stainless-timeout", "x-stainless-helper-method"}


@dataclass(frozen=True)
class Checkpoint:
    owner_did: str
    model: str
    sampler_path: str
    renderer: str
    effort: float = 0.1
    public_model_id: str = MODEL_ALIAS

    @classmethod
    def load(cls, run_dir):
        raw = json.loads((Path(run_dir) / "result.json").read_text())
        values = {name: raw.get(name) for name in ("owner_did", "model", "sampler_path", "renderer")}
        if any(not isinstance(value, str) or not value for value in values.values()):
            raise ValueError("result.json requires owner_did, model, sampler_path and renderer")
        if not re.fullmatch(r"did:(?:plc|web):[A-Za-z0-9._:%-]+", values["owner_did"]):
            raise ValueError("Invalid checkpoint owner DID")
        if not re.fullmatch(r"tinker://[^/\s]+/sampler_weights/[^/\s]+", values["sampler_path"]):
            raise ValueError("Expected an immutable Tinker sampler checkpoint")
        if values["model"] != "thinkingmachines/Inkling-Small" or values["renderer"] != "tml_v0":
            raise ValueError("This pilot serves Inkling-Small with its native tml_v0 renderer")
        effort = raw.get("effort")
        if type(effort) not in (int, float) or not math.isfinite(effort) or effort != 0.1:
            raise ValueError("Checkpoint must record the pilot's native thinking effort of 0.1")
        values["effort"] = effort
        alias = raw.get("public_model_id", MODEL_ALIAS)
        if not isinstance(alias, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", alias):
            raise ValueError("public_model_id must be an opaque lowercase model alias")
        values["public_model_id"] = alias
        return cls(**values)


def load_token(path):
    # Avoid following a token symlink or silently accepting group-readable secrets.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
            raise ValueError("Pilot token must be an operator-owned regular file with mode 0600")
        token = source.read(513).strip()
    if not 32 <= len(token) <= 512 or not re.fullmatch(rb"[A-Za-z0-9._~-]+", token):
        raise ValueError("Pilot token must contain 32-512 opaque ASCII characters")
    return token


class NativeSampler:
    """Use the training renderer and native effort; preserve Keating tool framing."""
    def __init__(self, checkpoint):
        if not os.environ.get("TINKER_API_KEY"):
            raise ValueError("TINKER_API_KEY environment variable is required")
        import tinker
        from tinker_cookbook import renderers
        from tinker_cookbook.tokenizer_utils import get_tokenizer
        self.tinker = tinker
        self.renderers = renderers
        self.effort = checkpoint.effort
        self.renderer = renderers.get_renderer(checkpoint.renderer, get_tokenizer(checkpoint.model), model_name=checkpoint.model)
        self.client = tinker.ServiceClient().create_sampling_client(model_path=checkpoint.sampler_path)

    def prepare(self, messages, tools):
        # This is the native TML declaration shape emitted by the cookbook's
        # create_conversation_prefix_with_tools. Preserve exact schemas and the
        # caller's system prompt; never replace either with a server tutor prompt.
        conversation = list(messages)
        if tools:
            insertion = 0
            while insertion < len(conversation) and conversation[insertion]["role"] == "system":
                insertion += 1
            conversation.insert(insertion, {"role": "tool_declare", "content": json.dumps(tools, separators=(",", ":"), allow_nan=False)})
        prompt = self.renderer.build_generation_prompt(conversation, effort=self.effort)
        return prompt, prompt.length

    def sample(self, prompt, max_tokens, temperature):
        async def generate():
            return await self.client.sample_async(
                prompt, num_samples=1,
                sampling_params=self.tinker.SamplingParams(
                    max_tokens=max_tokens, temperature=temperature, top_p=1.0,
                    stop=self.renderer.get_stop_sequences()),
            )
        sequence = asyncio.run(generate()).sequences[0]
        message, _ = self.renderer.parse_response(sequence.tokens)
        tool_calls = []
        for call in message.get("tool_calls", []):
            value = call.model_dump(mode="json") if hasattr(call, "model_dump") else call
            function = value["function"]
            # Transport IDs are assigned here, so generated IDs cannot collide
            # with calls earlier in this account's conversation.
            tool_calls.append({"id": "call_" + uuid.uuid4().hex,
                               "type": "function", "function": {"name": function["name"],
                               "arguments": function["arguments"]}})
        return {"text": self.renderers.get_text_content(message),
                "tool_calls": tool_calls,
                "completion_tokens": len(sequence.tokens),
                "finish_reason": "length" if sequence.stop_reason == "length" else ("tool_calls" if tool_calls else "stop")}


class RequestError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def validate_tool_call(call):
    if not isinstance(call, dict) or set(call) != {"id", "type", "function"} or call.get("type") != "function":
        raise RequestError(400, "Expected an OpenAI function tool call")
    if not isinstance(call["id"], str) or not 1 <= len(call["id"]) <= 256:
        raise RequestError(400, "Invalid tool call ID")
    function = call["function"]
    if not isinstance(function, dict) or set(function) != {"name", "arguments"}:
        raise RequestError(400, "Tool calls require a function name and JSON arguments")
    if not isinstance(function["name"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", function["name"]):
        raise RequestError(400, "Invalid function name")
    try:
        if not isinstance(function["arguments"], str) or not isinstance(json.loads(function["arguments"]), dict):
            raise ValueError()
    except ValueError:
        raise RequestError(400, "Function arguments must encode a JSON object") from None


def validate_tools(tools):
    if not isinstance(tools, list) or len(tools) > 128:
        raise RequestError(400, "Supply at most 128 function tools")
    names = set()
    for tool in tools:
        if not isinstance(tool, dict) or set(tool) != {"type", "function"} or tool.get("type") != "function":
            raise RequestError(400, "Only OpenAI function tool schemas are supported")
        function = tool["function"]
        if not isinstance(function, dict) or set(function) - {"name", "description", "parameters", "strict"}:
            raise RequestError(400, "Invalid function tool schema")
        name = function.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name) or name in names:
            raise RequestError(400, "Function tool names must be valid and unique")
        names.add(name)
        if not isinstance(function.get("parameters"), dict) or function["parameters"].get("type") != "object":
            raise RequestError(400, "Function parameters must be an object JSON schema")
        if "description" in function and not isinstance(function["description"], str):
            raise RequestError(400, "Function description must be text")
        if function.get("strict", False) is not False:
            raise RequestError(400, "Strict constrained tool decoding is not supported by this pilot")
    return tools


def validate_messages(messages):
    if not isinstance(messages, list) or not 1 <= len(messages) <= 128:
        raise RequestError(400, "Supply 1-128 messages")
    pending, seen = set(), set()
    for message in messages:
        if not isinstance(message, dict) or set(message) - {"role", "content", "tool_calls", "tool_call_id", "name"}:
            raise RequestError(400, "Unsupported message fields")
        role = message.get("role")
        if role not in ("system", "user", "assistant", "tool"):
            raise RequestError(400, "Only system, user, assistant and tool messages are supported")
        content = message.get("content")
        if not isinstance(content, str):
            if isinstance(content, list):
                if not all(isinstance(part, dict) and set(part) == {"type", "text"} and part["type"] == "text" and isinstance(part["text"], str) for part in content):
                    raise RequestError(400, "Only text content parts are supported")
            elif not (content is None and role == "assistant" and message.get("tool_calls")):
                raise RequestError(400, "Message content must be text")
        if role != "tool" and pending:
            raise RequestError(400, "Tool results must resolve all preceding calls")
        if role == "assistant":
            if set(message) - {"role", "content", "tool_calls"}:
                raise RequestError(400, "Unsupported assistant message fields")
            calls = message.get("tool_calls", [])
            if not isinstance(calls, list) or len(calls) > 128:
                raise RequestError(400, "Invalid assistant tool calls")
            for call in calls:
                validate_tool_call(call)
                if call["id"] in seen:
                    raise RequestError(400, "Duplicate tool call ID")
                pending.add(call["id"])
                seen.add(call["id"])
        elif role == "tool":
            if "tool_calls" in message or not isinstance(message.get("tool_call_id"), str) or message["tool_call_id"] not in pending:
                raise RequestError(400, "Tool result must reference a pending assistant call")
            if "name" in message and not isinstance(message["name"], str):
                raise RequestError(400, "Tool result name must be text")
            pending.remove(message["tool_call_id"])
        elif set(message) != {"role", "content"}:
            raise RequestError(400, "Unsupported system or user message fields")
    if pending or not any(message["role"] == "user" for message in messages):
        raise RequestError(400, "A user message and completed tool results are required")
    return messages


def validate_request(body, model_alias=MODEL_ALIAS):
    if not isinstance(body, dict) or body.get("model") != model_alias:
        raise RequestError(400, "Use the model alias advertised by /v1/models")
    allowed = {"model", "messages", "max_tokens", "max_completion_tokens", "temperature", "stream", "stream_options", "tools", "tool_choice", "parallel_tool_calls", "store"}
    if set(body) - allowed:
        raise RequestError(400, "Unsupported request fields")
    if "max_tokens" in body and "max_completion_tokens" in body:
        raise RequestError(400, "Specify only one completion limit")
    limit = body.get("max_completion_tokens", body.get("max_tokens", MAX_COMPLETION))
    if type(limit) is not int or not 1 <= limit <= MAX_COMPLETION:
        raise RequestError(400, f"Completion limit must be 1-{MAX_COMPLETION} tokens")
    temperature = body.get("temperature", 1.0)
    if type(temperature) not in (int, float) or not math.isfinite(temperature) or not 0 <= temperature <= 2:
        raise RequestError(400, "Temperature must be finite and between 0 and 2")
    if type(body.get("stream", False)) is not bool:
        raise RequestError(400, "stream must be boolean")
    options = body.get("stream_options", {})
    if not isinstance(options, dict) or set(options) - {"include_usage"} or type(options.get("include_usage", False)) is not bool:
        raise RequestError(400, "Invalid stream options")
    if body.get("store", False) is not False:
        raise RequestError(400, "This pilot does not store conversations")
    if type(body.get("parallel_tool_calls", True)) is not bool:
        raise RequestError(400, "parallel_tool_calls must be boolean")
    if body.get("tool_choice", "auto") not in ("auto", "none"):
        raise RequestError(400, "Only auto or none tool choice is supported")
    tools = validate_tools(body.get("tools", []))
    messages = validate_messages(body.get("messages"))
    return messages, tools if body.get("tool_choice") != "none" else [], limit, temperature


class Pilot:
    def __init__(self, checkpoint, token, sampler, reserve):
        self.checkpoint = checkpoint
        self.token = token
        self.sampler = sampler
        self.reserve = reserve
        self.generation_lock = threading.Lock()

    def authorized(self, header):
        # Compare bytes so non-ASCII attacker input cannot throw from compare_digest.
        return hmac.compare_digest((header or "").encode("utf-8"), b"Bearer " + self.token)

    def complete(self, body):
        messages, tools, limit, temperature = validate_request(body, self.checkpoint.public_model_id)
        if not self.generation_lock.acquire(blocking=False):
            raise RequestError(429, "One pilot generation may run at a time")
        try:
            prompt, tokens = self.sampler.prepare(messages, tools)
            if tokens > MAX_PROMPT or tokens + limit > MAX_CONTEXT:
                raise RequestError(400, "Prompt exceeds pilot token or context limit")
            # Reserve the maximum possible request cost before any provider call.
            # Reservations are deliberately retained on failures and short generations.
            with self.reserve(tokens, limit):
                result = self.sampler.sample(prompt, limit, temperature)
            tool_calls = result.get("tool_calls", [])
            names = {tool["function"]["name"] for tool in tools}
            for call in tool_calls:
                try:
                    validate_tool_call(call)
                    if call["function"]["name"] not in names:
                        raise ValueError()
                except (ValueError, RequestError):
                    raise RequestError(502, "Model generated an invalid or undeclared tool call") from None
            if body.get("parallel_tool_calls") is False and len(tool_calls) > 1:
                raise RequestError(502, "Model generated multiple calls when parallel tools were disabled")
            message = {"role": "assistant", "content": result["text"]}
            if tool_calls:
                message["tool_calls"] = tool_calls
            return {"id": "chatcmpl-" + uuid.uuid4().hex, "object": "chat.completion",
                    "created": int(time.time()), "model": self.checkpoint.public_model_id,
                    "choices": [{"index": 0, "message": message,
                                 "finish_reason": result["finish_reason"]}],
                    "usage": {"prompt_tokens": tokens, "completion_tokens": result["completion_tokens"],
                              "total_tokens": tokens + result["completion_tokens"]}}
        finally:
            self.generation_lock.release()


def make_server(pilot, host="127.0.0.1", port=8789, origin="http://localhost:3000"):
    if host != "127.0.0.1":
        raise ValueError("Pilot serving must bind to 127.0.0.1")
    parsed = urlsplit(origin)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError("CORS origin must be one exact HTTP(S) origin")

    class Handler(BaseHTTPRequestHandler):
        server_version = "KeatingPilot"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, *_):
            pass

        def headers_for(self, status, content_type="application/json", length=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            if length is not None:
                self.send_header("Content-Length", str(length))
            if self.headers.get("Origin") == origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.close_connection = True

        def json_response(self, status, value):
            data = json.dumps(value, allow_nan=False).encode()
            self.headers_for(status, length=len(data))
            self.wfile.write(data)

        def check_origin(self):
            if self.headers.get("Origin") not in (None, origin):
                raise RequestError(403, "Origin is not allowed")
            if self.headers.get("Host") not in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"):
                raise RequestError(403, "Host is not allowed")

        def check_auth(self):
            self.check_origin()
            if not pilot.authorized(self.headers.get("Authorization")):
                raise RequestError(401, "A valid pilot bearer token is required")

        def do_OPTIONS(self):
            try:
                self.check_origin()
                if self.path not in ("/v1/models", "/v1/chat/completions"):
                    raise RequestError(404, "Not found")
                requested = {value.strip().lower() for value in self.headers.get("Access-Control-Request-Headers", "").split(",") if value.strip()}
                if requested - ALLOWED_HEADERS:
                    raise RequestError(403, "Request headers are not allowed")
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", ", ".join(sorted(ALLOWED_HEADERS)))
                self.send_header("Content-Length", "0")
                self.end_headers()
            except RequestError as error:
                self.json_response(error.status, {"error": {"message": error.message}})

        def do_GET(self):
            try:
                self.check_auth()
                if self.path != "/v1/models":
                    raise RequestError(404, "Not found")
                self.json_response(200, {"object": "list", "data": [
                    {"id": pilot.checkpoint.public_model_id, "object": "model", "created": 0, "owned_by": "keating-pilot",
                     "display_name": ("Keating Bot (latest)" if pilot.checkpoint.public_model_id == "keating-bot-latest"
                                      else "Keating pilot (Inkling-Small)" if pilot.checkpoint.public_model_id == MODEL_ALIAS
                                      else pilot.checkpoint.public_model_id), "context_window": MAX_CONTEXT,
                     "max_input_tokens": MAX_PROMPT, "max_tokens": MAX_COMPLETION,
                     "reasoning": False, "input": ["text"]}]})
            except RequestError as error:
                self.json_response(error.status, {"error": {"message": error.message}})

        def do_POST(self):
            try:
                self.check_auth()
                if self.path != "/v1/chat/completions":
                    raise RequestError(404, "Not found")
                lengths = self.headers.get_all("Content-Length", [])
                if len(lengths) != 1 or self.headers.get("Transfer-Encoding"):
                    raise RequestError(400, "One Content-Length header is required")
                try:
                    length = int(lengths[0])
                except ValueError:
                    raise RequestError(400, "Invalid Content-Length") from None
                if not 0 < length <= MAX_BODY:
                    raise RequestError(413, "Request exceeds 512 KiB")
                if self.headers.get_content_type() != "application/json":
                    raise RequestError(415, "Expected application/json")
                data = self.rfile.read(length)
                if len(data) != length:
                    raise RequestError(400, "Incomplete request body")
                try:
                    body = json.loads(data)
                except (ValueError, UnicodeDecodeError):
                    raise RequestError(400, "Invalid JSON") from None
                result = pilot.complete(body)
                if not body.get("stream", False):
                    return self.json_response(200, result)
                # Buffered SSE preserves the OpenAI client contract, not token latency.
                common = {key: result[key] for key in ("id", "created", "model")}
                common["object"] = "chat.completion.chunk"
                choice = result["choices"][0]
                delta = dict(choice["message"])
                if "tool_calls" in delta:
                    delta["tool_calls"] = [{"index": index, **call} for index, call in enumerate(delta["tool_calls"])]
                events = [{**common, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                          {**common, "choices": [{"index": 0, "delta": {}, "finish_reason": choice["finish_reason"]}]}]
                if body.get("stream_options", {}).get("include_usage"):
                    events.append({**common, "choices": [], "usage": result["usage"]})
                payload = "".join("data: " + json.dumps(event) + "\n\n" for event in events) + "data: [DONE]\n\n"
                data = payload.encode()
                self.headers_for(200, "text/event-stream", len(data))
                self.wfile.write(data)
            except RequestError as error:
                self.json_response(error.status, {"error": {"message": error.message}})
            except Exception:
                # Provider exceptions can contain request data; never print or return them.
                self.json_response(503, {"error": {"message": "Pilot generation unavailable; check local budget and provider status"}})

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        request_queue_size = 4

        def handle_error(self, request, client_address):
            pass

    return Server((host, port), Handler)


def load_budget(run_dir, checkpoint, budget_file=None):
    """Reuse the original pilot's ledger for child SFT runs; never seed a new cap."""
    from pilot_budget import PilotBudget
    budget_path = Path(budget_file) if budget_file is not None else Path(run_dir) / "budget.json"
    if not budget_path.is_file() or checkpoint.model != PilotBudget.MODEL:
        raise ValueError("Serving requires the existing pilot budget and its priced model")
    ledger = json.loads(budget_path.read_text())
    if ledger.get("model") != checkpoint.model:
        raise ValueError("Checkpoint and budget models differ")
    return PilotBudget(budget_path.resolve(), cap_usd=ledger["cap_usd"])


app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)


def loopback_host(value: str) -> str:
    if value != "127.0.0.1":
        raise typer.BadParameter("Pilot serving must bind to 127.0.0.1")
    return value


@app.command()
def main(
    run_dir: Annotated[Path, typer.Option("--run-dir")],
    token_file: Annotated[Path, typer.Option("--token-file")],
    budget_file: Annotated[Path | None, typer.Option("--budget-file", help="Existing shared pilot ledger; required when serving a child run without its own budget")] = None,
    host: Annotated[str, typer.Option("--host", callback=loopback_host)] = "127.0.0.1",
    port: Annotated[int, typer.Option("--port")] = 8789,
    origin: Annotated[str, typer.Option("--origin")] = "http://localhost:3000",
):
    checkpoint = Checkpoint.load(run_dir)
    token = load_token(token_file)
    # The operator must attach the shared pilot budget before serving; there is
    # deliberately no unmetered command-line fallback.
    budget = load_budget(run_dir, checkpoint, budget_file)
    def reserve(prompt_tokens, max_tokens):
        return budget.reserve("serve", prefill=prompt_tokens, sample=max_tokens)
    pilot = Pilot(checkpoint, token, NativeSampler(checkpoint), reserve)
    server = make_server(pilot, host, port, origin)
    print(json.dumps({"listen": f"http://127.0.0.1:{server.server_port}/v1", "model": checkpoint.public_model_id,
                      "scope": "local account pilot; operator-issued bearer auth"}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    app()
