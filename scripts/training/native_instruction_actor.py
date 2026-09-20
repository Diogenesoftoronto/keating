# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["tinker==0.27.1", "tinker-cookbook==0.5.7", "transformers==5.3.0", "torch==2.10.0", "typer>=0.12", "certifi"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""Funded, evaluation-only instruction actor for the production Pi harness.

Draft/audit/plan are account-free. Serve requires a dedicated, parent-funded
child ledger; provider calls occur only on valid requests after reservation.
"""
from __future__ import annotations

import argparse
import copy
from decimal import Decimal, ROUND_CEILING
import fcntl
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import queue
import re
import ssl
import threading
import time
import uuid

import native_training as nt
import native_tinker_learner as nl
from native_tinker_update import dollars, need, sealed, write_private
from serve_pilot import validate_messages, validate_tools, validate_tool_call

MODEL = nl.MODEL
KIND = "native-instruction-actor/v1"
ACTOR_PROMPT = """Keating instruction-actor baseline, evaluation condition v2.
Respond as the tutor to the learner's latest actual message. Ground your reply
in the supplied task and the learner's work; check your reasoning and arithmetic.
Respect the requested help level. If the learner asks for a hint, give one useful
next step and leave the work to them. If they request a worked explanation, make
the reasoning clear. Ask one relevant question when more evidence is needed.
Do not invent a mistake, a prior interaction, learner progress, or mastery.
Only the tools declared in this request exist. A plan or a tool result is not
a learner answer. Use the workspace paths supplied by the runtime, never guessed
absolute paths. Do not claim delivery, submission, assessment, or saved state
without the corresponding real runtime receipt. Follow the runtime's surface
instructions: chat can use plain text; interactive content must use the actual
provided schema. If a tool or activity fails, acknowledge that failure and use
a usable text fallback. Do not promise capabilities that are unavailable.
Teach in short, direct turns. Address one next step, then wait for the learner.
When the learner requests an interactive question, deliver one supported
canonical question using the runtime schema. Stop after the question; let the
learner attempt it before explaining the answer. Include the current runtime
surface in supportedSurfaces. After a submission, respond to the actual choice
or written attempt, then offer at most one next step.
Check each factual and mathematical claim before including it. Prefer a simple,
precise explanation over an elaborate analogy. Do not invent historical origins,
diagnoses, previous instruction, or reasons why this learner made a mistake.
An accepted submission records an answer; it does not establish mastery or a
change in the learner's identity. Keep feedback specific to the visible work.
For a focused question or hint, aim for at most 100 words of prose, excluding
the canonical activity JSON. Expand only when the learner requests detail."""
PROMPT_HASH = hashlib.sha256(ACTOR_PROMPT.encode()).hexdigest()
IDENTITY = {"temperature": 1, "top_p": 1, "top_k": -1}
INELIGIBLE = "hosted_catalog_weights_have_no_immutable_checkpoint_attestation"


def actor_config(value=None):
    draft = nl.learner_config()
    draft["kind"] = KIND
    draft["condition"] = {"id": "qwen-instruction-strong-prompt/v2", "prompt_sha256": PROMPT_HASH,
                          "training_eligible": False, "purpose": "evaluation_only"}
    draft["max_provider_calls"] = 4
    if value is None:
        return draft
    value = copy.deepcopy(value)
    sealed(value, "config_hash")
    need(set(value) == set(draft) | {"config_hash"} and value["kind"] == KIND
         and value["condition"] == draft["condition"], "actor_config_condition_or_fields")
    need(type(value["max_provider_calls"]) is int and 1 <= value["max_provider_calls"] <= 12,
         "bounded_actor_call_count_required")
    # Reuse immutable instruction-model, tokenizer, renderer, pricing, account,
    # limit and allocation validation; this projection is never a journal role.
    projected = {k: v for k, v in value.items() if k not in {"config_hash", "condition", "max_provider_calls"}}
    projected["kind"] = "native-tinker-learner/v1"
    nl.learner_config(nt.seal(projected, "config_hash"))
    return value


def validate_request(body, config):
    allowed = {"model", "messages", "tools", "max_tokens", "max_completion_tokens", "temperature",
               "top_p", "top_k", "seed", "stream", "stream_options", "store", "tool_choice", "parallel_tool_calls"}
    need(type(body) is dict and not set(body) - allowed and body.get("model") == MODEL,
         "actor_request_fields_or_model")
    need(not ("max_tokens" in body and "max_completion_tokens" in body), "one_completion_limit")
    limit = body.get("max_tokens", body.get("max_completion_tokens"))
    need(type(limit) is int and 1 <= limit <= config["limits"]["max_output_tokens"], "bounded_actor_output_required")
    for key, expected in IDENTITY.items():
        need(type(body.get(key, expected)) in (int, float) and body.get(key, expected) == expected,
             "fixed_actor_sampling_required")
    need(body.get("seed") is None, "fixed_seed_none_required")
    need(type(body.get("stream", False)) is bool and body.get("store", False) is False,
         "actor_stream_or_store")
    options = body.get("stream_options", {})
    need(type(options) is dict and not set(options) - {"include_usage"}
         and type(options.get("include_usage", False)) is bool, "actor_stream_options")
    need(body.get("parallel_tool_calls", True) is True and body.get("tool_choice", "auto") in ("auto", "none"),
         "no_constrained_or_forced_tool_decoding")
    need(len(json.dumps(body, ensure_ascii=False, allow_nan=False).encode()) <= nl.MAX_BODY, "actor_body_limit")
    messages = copy.deepcopy(validate_messages(body.get("messages")))
    tools = copy.deepcopy(validate_tools(body.get("tools", [])))
    if body.get("tool_choice") == "none":
        tools = []
    # Reject unsupported history before tokenizer/client construction.
    leading = True
    names = {}
    for message in messages:
        need(leading or message["role"] != "system", "only_leading_system_messages_supported")
        leading = leading and message["role"] == "system"
        for call in message.get("tool_calls", []):
            names[call["id"]] = call["function"]["name"]
        if message["role"] == "tool":
            need(message.get("name") in (None, names[message["tool_call_id"]]), "tool_result_name_mismatch")
    need(messages[-1]["role"] in {"user", "tool"}, "actor_decision_boundary_required")
    return messages, tools, {**IDENTITY, "max_tokens": limit}


def prompted_messages(messages):
    messages = copy.deepcopy(messages)
    index = next((i for i, m in enumerate(messages) if m["role"] != "system"), len(messages))
    messages.insert(index, {"role": "system", "content": ACTOR_PROMPT})
    return messages


def cost_plan(config, body, ids, *, create_client=True):
    _, _, settings = validate_request(body, config)
    need(type(ids) is list and ids and all(type(v) is int and 0 <= v < 2**31 for v in ids), "original_prompt_ids_required")
    need(len(ids) + settings["max_tokens"] <= config["limits"]["context_tokens"], "actor_context_overflow")
    price = config["pricing"]
    amount = ((Decimal(len(ids)) * dollars(price["input_usd_per_million"])
               + Decimal(settings["max_tokens"]) * dollars(price["output_usd_per_million"])) / 1000000
              + (dollars(price["setup_upper_bound_usd"]) if create_client else 0)) * price["safety_factor"]
    return nt.seal({"kind": "native-instruction-actor-reservation/v1", "request_id": uuid.uuid4().hex,
                    "request_hash": nt.native_hash(body), "config_hash": config["config_hash"],
                    "allocation_id": config["allocation"]["id"], "prompt_tokens": len(ids),
                    "prompt_token_ids_hash": nt.native_hash(ids),
                    "sampling": {**settings, "seed": None, "stop": [nl.IM_END]},
                    "phases": (["create_client"] if create_client else []) + ["sample"],
                    "cost": {"reserved_usd": str(amount.quantize(Decimal("0.00000001"), rounding=ROUND_CEILING)),
                             "basis": "full_prompt_and_max_output_no_cache_discount", "pricing": price}}, "plan_hash")


def require_dispatch(config, plan, phase):
    """Even direct sampler use needs the bridge's already-recorded phase."""
    sealed(plan, "plan_hash")
    need(plan["config_hash"] == config["config_hash"] and plan["allocation_id"] == config["allocation"]["id"],
         "actor_dispatch_config_mismatch")
    path = nl.private_path(config["allocation"]["ledger_path"])
    child = nt.load_json(path)
    sealed(child, "ledger_hash")
    parent_path = nl.private_path(config["allocation"]["parent_ledger_path"])
    parent = nt.load_json(parent_path)
    sealed(parent, "ledger_hash")
    need(not path.stat().st_mode & 0o077 and not parent_path.stat().st_mode & 0o077,
         "private_funding_required")
    grant = parent["runs"].get(config["allocation"]["id"])
    need(parent["project_id"] == nl.PARENT_PROJECT and parent["model_id"] == nl.PARENT_MODEL
         and parent["cap_usd"] == "100" and grant is not None and grant["status"] == "complete"
         and grant["dispatched"] == grant["phases"] and bool(grant["phases"])
         and dollars(grant["reserved_usd"]) >= dollars(config["allocation"]["cap_usd"])
         and sum((dollars(r["reserved_usd"]) for r in parent["runs"].values()), Decimal(0)) <= 100,
         "actor_parent_funding_changed_before_dispatch")
    run = child["runs"].get(plan["plan_hash"])
    need(child["project_id"] == config["allocation"]["budget_project_id"] and child["model_id"] == MODEL
         and child["cap_usd"] == str(dollars(config["allocation"]["cap_usd"]))
         and child["parent_allocation"] == {"ledger_path": str(parent_path), "plan_hash": config["allocation"]["id"]}
         and run is not None and run["status"] == "dispatching" and run["dispatched"][-1:] == [phase]
         and run["phases"] == plan["phases"] and run["reserved_usd"] == plan["cost"]["reserved_usd"]
         and sum((dollars(r["reserved_usd"]) for r in child["runs"].values()), Decimal(0)) <= dollars(child["cap_usd"]),
         "actor_dispatch_not_reserved")


class PinnedActorSampler(nl.PinnedInstructionSampler):
    """Reuse only the pinned local renderer and SDK mechanics, never LearnerBridge."""
    def __init__(self, config=None, *, download_tokenizer=False, secret_loader=None):
        checked = None if config is None else actor_config(config)
        super().__init__(None, download_tokenizer=download_tokenizer, secret_loader=secret_loader)
        self.config = checked

    def prepare(self, messages, tools):
        from benchmark_tinker_bridge import native_conversation
        from tinker_cookbook.renderers.base import ToolCall
        conversation = native_conversation(messages, tools, self.renderer, ToolCall.model_validate)
        return self.renderer.build_generation_prompt(conversation)

    def connect(self, plan):
        need(self.config is not None, "funded_actor_config_required")
        require_dispatch(self.config, plan, "create_client")
        return super().connect()

    def sample(self, client, prompt, settings, timeout, plan):
        require_dispatch(self.config, plan, "sample")
        need(plan["sampling"] == {**settings, "seed": None, "stop": [nl.IM_END]}
             and plan["prompt_tokens"] == len(prompt.to_ints())
             and plan["prompt_token_ids_hash"] == nt.native_hash(list(prompt.to_ints())), "reserved_actor_sampling_mismatch")
        return super().sample(client, prompt, settings, timeout)

    def parse(self, tokens):
        # The pinned cookbook parses the ORIGINAL sequence. It performs its
        # documented XML parameter conversion; no re-encoding/rescoring occurs.
        raw = self.decode(tokens[:-1] if tokens[-1:] == [nl.IM_END] else tokens)
        blocks = re.findall(r"<tool_call>.*?</tool_call>", raw, re.DOTALL)
        for block in blocks:
            names = re.findall(r"<parameter=([^>\n]+)>", block)
            need(len(names) == len(set(name.strip() for name in names)), "ambiguous_duplicate_tool_parameter")
        message, termination = self.renderer.parse_response(list(tokens))
        content = message.get("content", "")
        need(isinstance(content, str) or all(part.get("type") == "text" for part in content),
             "unexpected_nontext_actor_output")
        text = content if isinstance(content, str) else "".join(part["text"] for part in content)
        calls = []
        id_sources = []
        for call in message.get("tool_calls", []):
            item = call.model_dump(mode="json", exclude_none=True)
            # Preserve IDs supplied by the parser. This XML format normally has
            # no IDs: allocate a transport ID ONCE and retain it in the journal,
            # SSE and following tool-result history. It is never a sampled ID.
            supplied = bool(item.get("id"))
            item["id"] = item.get("id") or "call_" + uuid.uuid4().hex
            item["type"] = "function"
            calls.append(item)
            id_sources.append("parser" if supplied else "bridge_transport")
        return {"message": {"role": "assistant", "content": text or None,
                            **({"tool_calls": calls} if calls else {})},
                "parse_finished": getattr(termination, "is_clean", False) is True,
                "unparsed_tool_calls": bool(message.get("unparsed_tool_calls")),
                "tool_id_sources": id_sources, "raw_text": raw}


class InstructionActorBridge:
    def __init__(self, config, token, state_dir, *, sampler_factory=PinnedActorSampler):
        self._config = nt.native_json(actor_config(config))
        need(type(token) is bytes and len(token) >= 32, "private_actor_bearer_required")
        self.token = token
        self.state = nl.private_path(state_dir)
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        need(not self.state.stat().st_mode & 0o077, "private_actor_state_required")
        self.raw_path = self.state / "actor-journal.jsonl"
        fd = os.open(self.raw_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        self.factory, self.sampler, self.client = sampler_factory, None, None
        self.lock, self.halted = threading.Lock(), threading.Event()
        self.previous_hash = None
        self.completed_plans = {}

    @property
    def config(self):
        return json.loads(self._config)

    def emit(self, record):
        value = nt.seal({**record, "kind": "native-instruction-actor-journal/v1", "origin": "actor",
                        "training_eligible": False, "actor_training_eligible": False,
                        "original_token_capture_eligible": False, "ineligible_reason": INELIGIBLE,
                        "previous_hash": self.previous_hash, "recorded_at": time.time()}, "record_hash")
        fd = os.open(self.raw_path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
        with os.fdopen(fd, "ab") as stream:
            stream.write((nt.native_json(value) + "\n").encode())
            stream.flush()
            os.fsync(stream.fileno())
        self.previous_hash = value["record_hash"]

    def complete(self, body):
        body = copy.deepcopy(body)
        cfg = self.config
        messages, tools, settings = validate_request(body, cfg)
        with self.lock:
            need(not self.halted.is_set(), "actor_halted_after_unknown_failure")
            ledger = nl.funded_ledger(cfg)  # Full parent and child proof before factory/secret/client.
            # Serialize across bridge processes sharing this allocation. Do not
            # queue another remote call behind an uncertain/in-flight operation.
            fd = os.open(str(ledger.path) + ".actor-lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as allocation_lock:
                fcntl.flock(allocation_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                ledger = nl.funded_ledger(cfg)
                need(len(nt.load_json(ledger.path)["runs"]) < cfg["max_provider_calls"], "actor_call_horizon_exhausted")
                return self._complete_funded(body, messages, tools, settings, cfg, ledger)

    def _complete_funded(self, body, messages, tools, settings, cfg, ledger):
        if self.sampler is None:
            self.sampler = self.factory(cfg)
        effective = prompted_messages(messages)
        prompt = self.sampler.prepare(effective, tools)
        ids = list(prompt.to_ints())
        plan = cost_plan(cfg, body, ids, create_client=self.client is None)
        ledger.reserve(plan)
        common = {"request_id": plan["request_id"], "config_hash": cfg["config_hash"],
                  "condition": cfg["condition"], "model": cfg["model"], "tokenizer": cfg["tokenizer"],
                  "renderer": cfg["renderer"], "reservation": plan, "source_audit": self.sampler.audit}
        try:
            self.emit({**common, "phase": "prepared", "original_request": body,
                       "effective_messages": effective, "effective_tools": tools, "prompt_token_ids": ids,
                       "effective_messages_hash": nt.native_hash(effective), "tool_schema_hash": nt.native_hash(tools),
                       "sampling": plan["sampling"]})
            results = queue.Queue(maxsize=1)
            def dispatch():
                try:
                    client = self.client
                    if client is None:
                        ledger.before(plan, "create_client")
                        client = self.sampler.connect(plan)
                    if self.halted.is_set():
                        return
                    ledger.before(plan, "sample")
                    response = self.sampler.sample(client, prompt, settings, cfg["limits"]["timeout_seconds"], plan)
                    results.put((client, response, None))
                except Exception as error:
                    results.put((None, None, type(error).__name__))
            threading.Thread(target=dispatch, daemon=True, name="funded-instruction-actor").start()
            try:
                client, response, failure = results.get(timeout=cfg["limits"]["timeout_seconds"])
            except queue.Empty:
                raise TimeoutError("actor_deadline") from None
            need(failure is None, "actor_provider_failed")
            sequences = list(response.sequences)
            for index, sequence in enumerate(sequences):
                tokens = list(sequence.tokens)
                probs = None if sequence.logprobs is None else list(sequence.logprobs)
                finite = probs is not None and all(type(x) in (int, float) and math.isfinite(x) for x in probs)
                self.emit({**common, "phase": "sampled", "sequence_index": index,
                           "completion_token_ids": tokens, "provider_logprobs": probs if finite else None,
                           "provider_logprobs_hex": None if probs is None else [float(x).hex() for x in probs],
                           "stop_reason": sequence.stop_reason, "sequence_id": getattr(sequence, "sequence_id", None),
                           "logprob_semantics": "provider_reported_eval_only_no_training_attestation"})
            need(len(sequences) == 1, "exactly_one_actor_sequence_required")
            sequence = sequences[0]
            tokens = list(sequence.tokens)
            need(tokens and all(type(v) is int and 0 <= v < 2**31 for v in tokens)
                 and len(tokens) <= settings["max_tokens"], "actor_output_overflow_or_invalid_ids")
            parsed = self.sampler.parse(tokens)
            self.emit({**common, "phase": "parsed", **parsed, "json_repaired": False, "tool_repaired": False})
            need(sequence.stop_reason == "stop" and tokens[-1] == nl.IM_END and tokens.count(nl.IM_END) == 1
                 and parsed["parse_finished"] and not parsed["unparsed_tool_calls"], "incomplete_or_malformed_actor_completion")
            message = parsed["message"]
            calls = message.get("tool_calls", [])
            need(message.get("content") or calls, "empty_actor_completion")
            names = {tool["function"]["name"] for tool in tools}
            seen = {call["id"] for m in messages for call in m.get("tool_calls", [])}
            for call in calls:
                validate_tool_call(call)
                need(call["function"]["name"] in names and call["id"] not in seen, "undeclared_or_duplicate_actor_tool_call")
                seen.add(call["id"])
            result = {"id": "chatcmpl-" + plan["request_id"], "object": "chat.completion", "created": int(time.time()),
                      "model": MODEL, "choices": [{"index": 0, "message": message,
                                  "finish_reason": "tool_calls" if calls else "stop"}],
                      "usage": {"prompt_tokens": len(ids), "completion_tokens": len(tokens), "total_tokens": len(ids) + len(tokens)}}
            self.emit({**common, "phase": "returned", "original_response": result,
                       "delivery_semantics": "response_prepared_not_runtime_delivery_or_tool_execution_receipt"})
            ledger.mark(plan, status="complete")
            self.completed_plans[result["id"]] = plan
            self.client = client
            return result
        except Exception as error:
            self.halted.set()
            ledger.mark(plan, status="failed_unknown")
            self.emit({**common, "phase": "failed_unknown", "error_kind": type(error).__name__,
                       "reservation_retained": True, "remote_cancellation_confirmed": False})
            raise ValueError("actor_failed_unknown_reservation_retained") from None

    def delivery_failed(self, result):
        with self.lock:
            self.halted.set()
            # A disconnect is not a tool-execution receipt. Persist the uncertain
            # local delivery so changing the server directory cannot retry it.
            plan = self.completed_plans.get(result["id"])
            need(plan is not None, "actor_delivery_request_mismatch")
            alloc = self.config["allocation"]
            ledger = nl.BudgetLedger(nl.private_path(alloc["ledger_path"]), alloc["budget_project_id"], MODEL, alloc["cap_usd"])
            ledger.mark(plan, status="failed_unknown")
            self.emit({"phase": "delivery_failed", "request_id": plan["request_id"],
                       "reservation_retained": True, "runtime_receipt_available": False})

    def server(self, certificate, key, port=0):
        bridge = self
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *_):
                pass
            def send(self, status, data, content_type="application/json"):
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                self.wfile.write(data)
            def send_json(self, status, body):
                self.send(status, json.dumps(body, ensure_ascii=False, allow_nan=False).encode())
            def authorized(self):
                auth = self.headers.get_all("Authorization", [])
                return (len(auth) == 1 and hmac.compare_digest(auth[0].encode(), b"Bearer " + bridge.token)
                        and self.headers.get("Origin") is None
                        and self.headers.get("Host") in {f"localhost:{self.server.server_port}", f"127.0.0.1:{self.server.server_port}"})
            def do_GET(self):
                if not self.authorized():
                    return self.send_json(401, {"error": {"message": "Unauthorized"}})
                if self.path != "/v1/models":
                    return self.send_json(404, {"error": {"message": "Not found"}})
                self.send_json(200, {"object": "list", "data": [{"id": MODEL, "object": "model",
                    "owned_by": "native-instruction-actor", "context_window": bridge.config["limits"]["context_tokens"],
                    "max_tokens": bridge.config["limits"]["max_output_tokens"], "reasoning": False, "input": ["text"]}]})
            def do_POST(self):
                if not self.authorized():
                    return self.send_json(401, {"error": {"message": "Unauthorized"}})
                if self.path != "/v1/chat/completions":
                    return self.send_json(404, {"error": {"message": "Not found"}})
                try:
                    sizes = self.headers.get_all("Content-Length", [])
                    need(not self.headers.get("Transfer-Encoding") and len(sizes) == 1
                         and re.fullmatch(r"[0-9]{1,7}", sizes[0]), "bounded_body_required")
                    size = int(sizes[0])
                    need(0 < size <= nl.MAX_BODY and self.headers.get_content_type() == "application/json", "json_body_required")
                    self.connection.settimeout(10)
                    raw = self.rfile.read(size)
                    need(len(raw) == size, "incomplete_body")
                    def unique(pairs):
                        value = {}
                        for k, v in pairs:
                            need(k not in value, "duplicate_json_key")
                            value[k] = v
                        return value
                    def nonfinite(_):
                        raise ValueError("nonfinite_json")
                    body = json.loads(raw, object_pairs_hook=unique, parse_constant=nonfinite)
                    result = bridge.complete(body)
                except Exception:
                    return self.send_json(503 if bridge.halted.is_set() else 400, {"error": {"message":
                        "Actor halted; reservation retained" if bridge.halted.is_set() else "Actor request or funding rejected"}})
                try:
                    if not body.get("stream", False):
                        return self.send_json(200, result)
                    self.send(200, sse_response(result, body.get("stream_options", {}).get("include_usage", False)), "text/event-stream")
                except (OSError, TimeoutError):
                    # Generation may have succeeded but local delivery is unknown.
                    # Do not trigger another provider request or claim a receipt.
                    bridge.delivery_failed(result)
        class Server(ThreadingHTTPServer):
            daemon_threads = True
            request_queue_size = 4
            def handle_error(self, request, client_address):
                pass  # No provider/request/credential traceback to stderr.
        server = Server(("127.0.0.1", port), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        return server


def sse_response(result, include_usage):
    """Buffered OpenAI SSE: exact IDs/arguments, honest usage, no latency claim."""
    common = {k: result[k] for k in ("id", "created", "model")}
    common["object"] = "chat.completion.chunk"
    choice = result["choices"][0]
    delta = copy.deepcopy(choice["message"])
    if "tool_calls" in delta:
        delta["tool_calls"] = [{"index": i, **call} for i, call in enumerate(delta["tool_calls"])]
    events = [{**common, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
              {**common, "choices": [{"index": 0, "delta": {}, "finish_reason": choice["finish_reason"]}]}]
    if include_usage:
        events.append({**common, "choices": [], "usage": result["usage"]})
    return ("".join("data: " + json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n\n" for event in events)
            + "data: [DONE]\n\n").encode()


def actor_cli(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("draft")
    audit = sub.add_parser("audit")
    audit.add_argument("--download-tokenizer", action="store_true")
    for name in ("seal-config", "plan", "serve"):
        command = sub.add_parser(name)
        command.add_argument("--config", required=True)
        if name == "seal-config":
            command.add_argument("--output", required=True)
        if name == "plan":
            command.add_argument("--request", required=True)
        if name == "serve":
            command.add_argument("--state", required=True)
            command.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    if args.command == "draft":
        print(json.dumps(actor_config(), indent=2))
        return
    if args.command == "audit":
        print(json.dumps(PinnedActorSampler(download_tokenizer=args.download_tokenizer).audit, indent=2))
        return
    config_path = nl.private_path(args.config)
    config = nt.load_json(config_path)
    if args.command == "seal-config":
        config = actor_config(nt.seal(config, "config_hash"))
        destination = nl.private_path(args.output)
        need(not destination.exists(), "output_exists")
        write_private(destination, config)
        print(json.dumps({"config_hash": config["config_hash"]}))
        return
    config = actor_config(config)
    if args.command == "plan":
        body = nt.load_json(nl.private_path(args.request))
        messages, tools, _ = validate_request(body, config)
        sampler = PinnedActorSampler(config)
        ids = list(sampler.prepare(prompted_messages(messages), tools).to_ints())
        print(json.dumps(cost_plan(config, body, ids), indent=2))
        return
    nl.funded_ledger(config)
    from benchmark_tinker_bridge import create_material
    state = nl.private_path(args.state)
    need(not state.exists(), "new_private_state_required")
    token, token_file, cert, key = create_material(state)
    bridge = InstructionActorBridge(config, token, state)
    server = bridge.server(cert, key, args.port)
    manifest = {"base_url": f"https://localhost:{server.server_port}/v1",
                "endpoint": f"https://localhost:{server.server_port}/v1/chat/completions", "model": MODEL,
                "revision": "native-instruction-actor-config:" + config["config_hash"],
                "token_file": str(token_file), "cert_file": str(cert), "raw_captures": str(bridge.raw_path),
                "raw_journal": str(bridge.raw_path), "config_hash": config["config_hash"],
                "condition": config["condition"], "prompt_sha256": PROMPT_HASH,
                "max_tokens": config["limits"]["max_output_tokens"], "temperature": 1,
                "retry_scope": nl.RETRY_SCOPE, "streaming": "buffered_sse", "origin": "actor",
                "training_eligible": False, "provider_weight_revision": config["model"]["provider_weight_revision"]}
    write_private(state / "actor-server.json", manifest)
    print(json.dumps(manifest), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    try:
        actor_cli()
    except Exception:
        print(json.dumps({"error": "Actor configuration or operation failed; inspect private ledger/journal"}))
        raise SystemExit(1) from None
