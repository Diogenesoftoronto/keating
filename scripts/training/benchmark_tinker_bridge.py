#!/usr/bin/env python3
"""External TLS/OpenAI adapter for native Tinker sampling; the frozen Pi harness is unchanged."""
from __future__ import annotations

import copy
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import ssl
import subprocess
import threading
import time
import uuid

import typer
from serve_pilot import RequestError, make_server, validate_messages, validate_tools, Pilot


@dataclass(frozen=True)
class ModelSpec:
    alias: str
    base_model: str
    renderer: str
    input_rate: float
    output_rate: float
    effort: float | None = None
    context_limit: int = 65536


MODELS = {
    "inkling-small-base": ModelSpec("inkling-small-base", "thinkingmachines/Inkling-Small", "tml_v0", .58, 1.44, .1),
    "nemotron-lightning": ModelSpec("nemotron-lightning", "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16", "nemotron3_ultra_disable_thinking", .195, .495),
    "qwen3-8-27b": ModelSpec("qwen3-8-27b", "Qwen/Qwen3.8-27B", "qwen3_8_disable_thinking", 1.86, 5.595),
}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def validate_payload(body):
    allowed = {"model", "messages", "tools", "max_tokens", "max_completion_tokens", "temperature", "top_p", "seed",
               "stream", "stream_options", "store", "tool_choice", "parallel_tool_calls", "reasoning_effort"}
    if not isinstance(body, dict) or set(body) - allowed or body.get("model") not in MODELS:
        raise RequestError(400, "Unknown model or unsupported request field")
    if "max_tokens" in body and "max_completion_tokens" in body:
        raise RequestError(400, "Supply one output limit")
    limit = body.get("max_tokens", body.get("max_completion_tokens"))
    if type(limit) is not int or not 1 <= limit <= 16000:
        raise RequestError(400, "An explicit output limit from 1 to 16000 is required")
    settings = {"max_tokens": limit, "temperature": body.get("temperature", 1.0), "top_p": body.get("top_p", 1.0)}
    for key, maximum in (("temperature", 2), ("top_p", 1)):
        value = settings[key]
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum or (key == "top_p" and value == 0):
            raise RequestError(400, "Invalid sampling setting")
    if "seed" in body:
        if type(body["seed"]) is not int or not 0 <= body["seed"] < 2**31:
            raise RequestError(400, "Invalid seed")
        settings["seed"] = body["seed"]
    if type(body.get("stream", False)) is not bool or body.get("store", False) is not False:
        raise RequestError(400, "Invalid stream/store setting")
    options = body.get("stream_options", {})
    if not isinstance(options, dict) or set(options) - {"include_usage"} or type(options.get("include_usage", False)) is not bool:
        raise RequestError(400, "Unsupported streaming option")
    if "parallel_tool_calls" in body and body["parallel_tool_calls"] is not True:
        raise RequestError(400, "Constrained parallel-tool decoding is unavailable")
    if body.get("tool_choice", "auto") not in ("auto", "none"):
        raise RequestError(400, "Forced tool selection is unavailable")
    spec = MODELS[body["model"]]
    if "reasoning_effort" in body and (spec.effort is not None or body["reasoning_effort"] not in ("off", "none")):
        raise RequestError(400, "Requested reasoning override is unsupported by this native renderer")
    messages = validate_messages(body.get("messages"))
    tools = validate_tools(body.get("tools", []))
    if body.get("tool_choice") == "none":
        tools = []
    return spec, messages, tools, settings


def native_conversation(messages, tools, renderer, call_parser):
    """Preserve all caller content and schemas; reconstruct omitted OpenAI tool names from real call IDs."""
    history = copy.deepcopy(messages)
    system = []
    while history and history[0]["role"] == "system":
        content = history.pop(0)["content"]
        system.append(content if isinstance(content, str) else "\n".join(part["text"] for part in content))
    if any(message["role"] == "system" for message in history):
        raise RequestError(400, "Only leading system messages are supported")
    names = {}
    for message in history:
        if isinstance(message.get("content"), list):
            message["content"] = "\n".join(part["text"] for part in message["content"])
        if message.get("content") is None:
            message["content"] = ""
        for call in message.get("tool_calls", []):
            names[call["id"]] = call["function"]["name"]
        if message.get("tool_calls"):
            message["tool_calls"] = [call_parser(call) for call in message["tool_calls"]]
        if message["role"] == "tool":
            expected = names.get(message["tool_call_id"])
            if message.get("name") not in (None, expected):
                raise RequestError(400, "Tool result name disagrees with its call")
            message["name"] = expected
    specs = [{key: value for key, value in tool["function"].items() if key != "strict"} for tool in tools]
    prefix = renderer.create_conversation_prefix_with_tools(specs, system_prompt="\n\n".join(system))
    return prefix + history


class NativeSampler:
    def __init__(self, spec, key_env):
        import tinker
        from tinker.lib.retry_handler import RetryConfig
        from tinker_cookbook import renderers, tokenizer_utils
        from tinker_cookbook.renderers.base import ToolCall
        self.spec, self.tinker, self.renderers, self.call_parser = spec, tinker, renderers, ToolCall.model_validate
        self.renderer = renderers.get_renderer(spec.renderer, tokenizer_utils.get_tokenizer(spec.base_model), model_name=spec.base_model)
        service = tinker.ServiceClient(api_key=os.environ[key_env], max_retries=0)
        self.client = service.create_sampling_client(base_model=spec.base_model,
            retry_config=RetryConfig(enable_retry_logic=False))

    def prepare(self, messages, tools):
        conversation = native_conversation(messages, tools, self.renderer, self.call_parser)
        prompt = self.renderer.build_generation_prompt(conversation, **({"effort": self.spec.effort} if self.spec.effort is not None else {}))
        return prompt

    def sample(self, prompt, settings):
        params = self.tinker.SamplingParams(**settings, stop=self.renderer.get_stop_sequences())
        sequence = self.client.sample(prompt, num_samples=1, sampling_params=params).result(timeout=240).sequences[0]
        message, finished = self.renderer.parse_response(sequence.tokens)
        calls = []
        for call in message.get("tool_calls", []):
            raw = call.model_dump(mode="json") if hasattr(call, "model_dump") else dict(call)
            calls.append({"id": "call_" + uuid.uuid4().hex, "type": "function", "function": raw["function"]})
        return {"text": self.renderers.get_text_content(message), "tool_calls": calls,
                "completion_tokens": len(sequence.tokens), "parse_finished": bool(finished),
                "stop_reason": sequence.stop_reason,
                "finish_reason": "length" if sequence.stop_reason == "length" else "tool_calls" if calls else "stop"}


class Bridge(Pilot):
    def __init__(self, token, state_dir, key_env="TINKER_API_KEY", sampler_factory=NativeSampler):
        self.token, self.state_dir, self.key_env = token, Path(state_dir), key_env
        self.sampler_factory, self.samplers = sampler_factory, {}
        self.locks = {name: threading.Lock() for name in MODELS}
        self.receipt_lock = threading.Lock()

    def record(self, receipt):
        with self.receipt_lock:
            with (self.state_dir / "usage.jsonl").open("a") as stream:
                stream.write(json.dumps(receipt, allow_nan=False) + "\n")

    def complete(self, body):
        spec, messages, tools, settings = validate_payload(body)
        request_id = "chatcmpl-" + uuid.uuid4().hex
        receipt = {"id": request_id, "model": spec.alias, "base_model": spec.base_model, "renderer": spec.renderer,
                   "effort": spec.effort, "request_sha256": digest(body), "sampling": settings,
                   "created_at": time.time(), "status": "started", "cache_hits_measured": False,
                   "input_tokens": None, "output_tokens": None, "reasoning_tokens": None,
                   "defaulted_settings": [name for name in ("temperature", "top_p") if name not in body]}
        started = time.monotonic()
        self.record(receipt)
        try:
            with self.locks[spec.alias]:
                if spec.alias not in self.samplers:
                    self.samplers[spec.alias] = self.sampler_factory(spec, self.key_env)
                sampler = self.samplers[spec.alias]
                prompt = sampler.prepare(messages, tools)
                if prompt.length + settings["max_tokens"] > spec.context_limit:
                    raise RequestError(400, "Native context limit exceeded; no truncation applied")
                receipt["input_tokens"] = prompt.length
                receipt["native_prompt_sha256"] = digest(prompt.to_ints())
                result = sampler.sample(prompt, settings)
            receipt.update(status="completed", output_tokens=result["completion_tokens"],
                parse_finished=result["parse_finished"], stop_reason=result["stop_reason"],
                estimated_uncached_cost_usd=(prompt.length * spec.input_rate + result["completion_tokens"] * spec.output_rate) / 1e6,
                rates_usd_per_million={"input": spec.input_rate, "output": spec.output_rate},
                pricing_source="Earlier 2026-09-07 provider pricing receipts; estimate, not invoice; cache unmeasured")
            message = {"role": "assistant", "content": result["text"]}
            if result["tool_calls"]:
                message["tool_calls"] = result["tool_calls"]
            # Preserve generated errors/undeclared calls for the actual Pi executor to handle; never fabricate tool results.
            return {"id": request_id, "object": "chat.completion", "created": int(time.time()), "model": spec.alias,
                    "choices": [{"index": 0, "message": message, "finish_reason": result["finish_reason"]}],
                    "usage": {"prompt_tokens": prompt.length, "completion_tokens": result["completion_tokens"],
                              "total_tokens": prompt.length + result["completion_tokens"]}}
        except Exception as error:
            receipt.update(status="error", error_kind=type(error).__name__)
            raise
        finally:
            receipt["wall_seconds"] = time.monotonic() - started
            self.record(receipt)


def create_server(bridge, certificate, private_key, port=0):
    server = make_server(bridge, port=port)
    parent = server.RequestHandlerClass
    class Handler(parent):
        def do_GET(self):
            try:
                self.check_auth()
                if self.path != "/v1/models":
                    raise RequestError(404, "Not found")
                self.json_response(200, {"object": "list", "data": [{"id": model.alias, "object": "model", "created": 0,
                    "owned_by": "keating-tinker-bridge", "context_window": model.context_limit, "max_tokens": 16000,
                    "reasoning": False, "input": ["text"]} for model in MODELS.values()]})
            except RequestError as error:
                self.json_response(error.status, {"error": {"message": error.message}})
    server.RequestHandlerClass = Handler
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, private_key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def create_material(state_dir):
    state_dir = Path(state_dir).resolve()
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    token = secrets.token_urlsafe(40).encode()
    token_file, certificate, private_key = state_dir / "bearer-token", state_dir / "certificate.pem", state_dir / "tls-key.pem"
    token_file.write_bytes(token)
    token_file.chmod(0o600)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=localhost",
                    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", str(private_key), "-out", str(certificate)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, umask=0o077)
    return token, token_file, certificate, private_key


app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)


@app.command()
def serve(state_dir: Path = typer.Option(...), port: int = 8805, key_env: str = "TINKER_API_KEY"):
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key_env) or not os.environ.get(key_env):
        raise typer.BadParameter("An existing native API key environment reference is required")
    token, token_file, certificate, private_key = create_material(state_dir)
    bridge = Bridge(token, state_dir.resolve(), key_env)
    server = create_server(bridge, certificate, private_key, port)
    manifest = {"endpoint": f"https://127.0.0.1:{server.server_port}/v1", "token_file": str(token_file),
        "certificate": str(certificate), "models": [vars(model) for model in MODELS.values()],
        "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "http_adapter_sha256": hashlib.sha256(Path(__file__).with_name("serve_pilot.py").read_bytes()).hexdigest(),
        "limitations": ["External native transport bridge; frozen Pi runtime unchanged.",
            "Buffered SSE is not first-token latency or decode throughput.", "No training and no original training-budget ledger use.",
            "Output token counts include all native sampled tokens; cache and reasoning subdivisions unmeasured.",
            "No automatic generation retries. Historical checkpoint serving is not enabled in this minimal bridge."]}
    (state_dir / "bridge.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"ready": str(state_dir.resolve() / "bridge.json"), "endpoint": manifest["endpoint"]}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    app()
