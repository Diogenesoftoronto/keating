#!/usr/bin/env python3
"""Teaching v5 group track: one tutor, several scripted learners in a shared chat.

Keating's runtime is single-learner, so this track does not use the app harness. Each tutor sees the group
chat as a stream of messages with sender metadata and must choose, after every message, to post
(`send_message`) or stay silent (`pass`), the same contract Ampersand uses for group chat. Episodes are
written in the v5 episode schema so `benchmark_v5.py check|judge|report` work on them unchanged.

Adapters (selected by the transport JSON "kind"):
  ampersand          humans& Agents API (ampersand-v0.1), key in AMPERSAND_API_KEY
  openai_chat        any OpenAI-compatible /chat/completions endpoint with tool calling (Flint on vLLM,
                     DeepSeek on Neuralwatt, ...): {"kind":"openai_chat","endpoint":..., "model":..., "key_env":...}

Usage: benchmark_v5_group.py run OUT --transport T.json [--split S] [--repeats K] [--instance ID ...]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import uuid
from pathlib import Path

import benchmark_v5 as v5

# v5.1: neutral. The tutor is told the contract, not the pedagogy; noticing who needs what is the test.
# (v5.0 runs used a coaching prompt that named when to speak; see README.)
INSTRUCTIONS = ("You are the tutor in a group chat with several learners. After each new message, either post a message "
                "with send_message or stay silent with pass.")


TOOLS = [
    {'type': 'function', 'name': 'send_message',
     'description': 'Post a message to the group chat. Only text passed here is delivered.',
     'parameters': {'type': 'object', 'properties': {'content': {'type': 'string'}}, 'required': ['content']}},
    {'type': 'function', 'name': 'pass',
     'description': 'Yield without a visible message when no useful action is available now. Call pass on its own.',
     'parameters': {'type': 'object', 'properties': {}, 'required': []}},
]


def roster_text(case):
    names = ', '.join(f"{p['name']} ({p['role']})" for p in case['participants'])
    return f"Group chat members: {names}, and you (the tutor)."


# ---------------------------------------------------------------- adapters

class Ampersand:
    BASE = 'https://ampersand.humansand.ai/v1'

    def __init__(self, transport):
        import httpx
        self.http = httpx.Client(timeout=120, headers={'Authorization': f"Bearer {os.environ[transport.get('key_env', 'AMPERSAND_API_KEY')]}",
                                                       'Content-Type': 'application/json', 'OpenAI-Beta': 'agents=v1'})
        self.model = transport.get('model', 'ampersand-v0.1')
        self.session = None
        self.pending = []
        self.t0 = int(time.time())
        self.usage = None

    def _msg(self, i, sender, name, text, channel='group'):
        return {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': text}],
                'metadata': {'id': f'{channel}:{i}', 'source': 'chat', 'sender': sender, 'sender_name': name,
                             'channel': channel, 'timestamp': self.t0 + 10 * i}}

    def _req(self, method, url, **kw):
        for attempt in range(8):
            r = self.http.request(method, url, **kw)
            if r.status_code in (429, 503):
                time.sleep(min(60, float(r.headers.get('Retry-After') or 2 ** attempt)))
                continue
            r.raise_for_status()
            return r
        r.raise_for_status()

    def _wait(self):
        delay = 1.5
        for _ in range(200):
            r = self._req('GET', f'{self.BASE}/agents/sessions/{self.session}')
            d = r.json()
            if d['status'] != 'in_progress':
                self.usage = d.get('usage')
                return d
            time.sleep(delay)
            delay = min(delay * 1.3, 6)
        raise TimeoutError('ampersand turn did not finish')

    def _post(self, events):
        self._req('POST', f'{self.BASE}/agents/sessions/{self.session}/events', json={'events': events},
                  headers={'Idempotency-Key': str(uuid.uuid4())})

    def step(self, case, i, sender, name, text):
        """Deliver one chat message; return the tutor's actions for it."""
        msg = self._msg(i, sender, name, text)
        if self.session is None:
            body = {'agent': {'model': self.model, 'instructions': INSTRUCTIONS, 'tools': TOOLS,
                              'ampersand': {'allow_silent_completion': False}},
                    'environment': {'type': 'none'},
                    'input': [self._msg(0, 'environment', 'Environment', roster_text(case), 'setup'), msg]}
            self.session = self._req('POST', f'{self.BASE}/agents/sessions', json=body).json()['id']
        else:
            self._post([*self.pending, {'type': 'agent.session.input.message', 'input': [msg]}])
            self.pending = []
        actions = []
        for _ in range(4):
            d = self._wait()
            calls = [a for a in d.get('required_actions') or [] if a.get('type') == 'function_call']
            if not calls:
                break
            results = []
            for c in calls:
                content = (c.get('arguments') or {}).get('content') if c['name'] == 'send_message' else None
                actions.append({'tool': c['name'], 'content': content})
                results.append({'type': 'agent.session.input.tool_result', 'turn_id': c['turn_id'], 'call_id': c['call_id'],
                                'success': True, 'output': 'Message sent.' if c['name'] == 'send_message' else 'Passing.'})
            if any(a['tool'] == 'pass' for a in actions) or actions:
                # Hand the results back with the next learner message (the documented group pattern).
                self.pending = results
                break
        return actions, {'status': d['status'], 'error': d.get('error')}

    def close(self):
        if self.session and self.pending:
            self._post(self.pending)
            self._wait()


class OpenAIChat:
    def __init__(self, transport):
        import httpx
        self.http = httpx.Client(timeout=600)
        self.t = transport
        self.key = os.environ[transport['key_env']]
        self.messages = None
        self.usage = {'input_tokens': 0, 'output_tokens': 0, 'reasoning_tokens': 0}

    def step(self, case, i, sender, name, text):
        if self.messages is None:
            self.messages = [{'role': 'system', 'content': INSTRUCTIONS + '\n\n' + roster_text(case)}]
        self.messages.append({'role': 'user', 'name': re.sub(r'[^A-Za-z0-9_-]', '_', name), 'content': f'{name}: {text}'})
        tools = [{'type': 'function', 'function': {k: t[k] for k in ('name', 'description', 'parameters')}} for t in TOOLS]
        actions, info = [], {'status': 'completed', 'error': None}
        for _ in range(3):
            body = {'model': self.t['model'], 'messages': self.messages, 'tools': tools, 'tool_choice': 'required',
                    'max_tokens': self.t.get('max_tokens', 8192), **self.t.get('extra_body', {})}
            r = self.http.post(self.t['endpoint'].rstrip('/') + '/chat/completions', json=body,
                               headers={'Authorization': f'Bearer {self.key}'})
            if r.status_code >= 400:
                info = {'status': 'failed', 'error': r.text[:300]}
                break
            d = r.json()
            u = d.get('usage') or {}
            self.usage['input_tokens'] += u.get('prompt_tokens', 0)
            self.usage['output_tokens'] += u.get('completion_tokens', 0)
            self.usage['reasoning_tokens'] += (u.get('completion_tokens_details') or {}).get('reasoning_tokens') or 0
            choice = d['choices'][0]
            m = choice['message']
            calls = m.get('tool_calls') or []
            self.messages.append({'role': 'assistant', 'content': m.get('content'), **({'tool_calls': calls} if calls else {})})
            if not calls:
                # A plain-text reply is a protocol violation; record it as a post so it is judged as what learners would see.
                if (m.get('content') or '').strip():
                    actions.append({'tool': 'send_message', 'content': m['content'], 'protocol_violation': 'plain_text'})
                info['finish_reason'] = choice.get('finish_reason')
                break
            for c in calls:
                try:
                    args = json.loads(c['function'].get('arguments') or '{}')
                except ValueError:
                    args = {}
                actions.append({'tool': c['function']['name'], 'content': args.get('content')})
                self.messages.append({'role': 'tool', 'tool_call_id': c['id'],
                                      'content': 'Message sent.' if c['function']['name'] == 'send_message' else 'Passing.'})
            info['finish_reason'] = choice.get('finish_reason')
            break
        return actions, info

    def close(self):
        pass


class KeatingRoom:
    """Keating's own study-room facilitator (web/src/rooms), driven headlessly.

    Every turn rebuilds the context with the production `buildFacilitatorContext` (persona, group protocol,
    room roster, participation counts, transcript with Keating's earlier posts) and decodes the reply with
    `parseFacilitatorDecision`, through benchmark_v5_room_bridge.ts. The model is any OpenAI-compatible
    tool-calling endpoint: {"kind":"keating_room","endpoint":...,"model":...,"key_env":...}.
    """
    BRIDGE = Path(__file__).resolve().parent / 'benchmark_v5_room_bridge.ts'

    def __init__(self, transport):
        import httpx
        self.http = httpx.Client(timeout=600)
        self.t = transport
        self.key = os.environ[transport['key_env']]
        self.history, self.considered = [], 0
        self.usage = {'input_tokens': 0, 'output_tokens': 0, 'reasoning_tokens': 0}

    def _bridge(self, payload):
        import subprocess
        p = subprocess.run(['bun', str(self.BRIDGE)], input=json.dumps(payload), capture_output=True, text=True, timeout=120)
        if p.returncode:
            raise RuntimeError('room bridge: ' + p.stderr[-400:])
        return json.loads(p.stdout)

    def step(self, case, i, sender, name, text):
        self.history.append({'name': name, 'role': 'learner', 'body': text})
        members = [{'name': 'Teacher', 'role': 'host'}] + [{'name': p['name'], 'role': 'learner'} for p in case['participants']]
        ctx = self._bridge({'title': case['title'], 'topic': case.get('topic', ''), 'members': members,
                            'messages': self.history, 'consideredSeq': self.considered})
        tools = [{'type': 'function', 'function': {'name': t['name'], 'description': t['description'], 'parameters': t['parameters']}}
                 for t in ctx['tools']]
        body = {'model': self.t['model'], 'tools': tools, 'tool_choice': 'auto', 'max_tokens': self.t.get('max_tokens', 8192),
                'messages': [{'role': 'system', 'content': ctx['systemPrompt']}, {'role': 'user', 'content': ctx['user']}],
                **self.t.get('extra_body', {})}
        r = self.http.post(self.t['endpoint'].rstrip('/') + '/chat/completions', json=body, headers={'Authorization': f'Bearer {self.key}'})
        if r.status_code >= 400:
            return [], {'status': 'failed', 'error': r.text[:300]}
        d = r.json()
        u = d.get('usage') or {}
        self.usage['input_tokens'] += u.get('prompt_tokens', 0)
        self.usage['output_tokens'] += u.get('completion_tokens', 0)
        self.usage['reasoning_tokens'] += (u.get('completion_tokens_details') or {}).get('reasoning_tokens') or 0
        choice = d['choices'][0]
        m = choice['message']
        parts = [{'type': 'text', 'text': m['content']}] if (m.get('content') or '').strip() else []
        for c in m.get('tool_calls') or []:
            try:
                args = json.loads(c['function'].get('arguments') or '{}')
            except ValueError:
                args = {}
            parts.append({'type': 'toolCall', 'name': c['function']['name'], 'arguments': args})
        decision = self._bridge({'decode': {'content': parts}})
        self.considered = len(self.history)
        if decision['kind'] == 'speak':
            self.history.append({'name': 'Keating', 'role': 'keating', 'body': decision['content']})
            act = {'tool': 'send_message', 'content': decision['content'], 'address': decision.get('addressedTo')}
            if not m.get('tool_calls'):
                act['protocol_violation'] = 'plain_text'
            return [act], {'status': 'completed', 'error': None, 'finish_reason': choice.get('finish_reason')}
        return [{'tool': 'pass', 'content': None, 'reason': decision.get('reason')}], {
            'status': 'completed', 'error': None, 'finish_reason': choice.get('finish_reason')}

    def close(self):
        pass


ADAPTERS = {'ampersand': Ampersand, 'openai_chat': OpenAIChat, 'keating_room': KeatingRoom}


# ---------------------------------------------------------------- episodes

def run_episode(instance, transport):
    case = instance['case']
    names = {p['id']: p['name'] for p in case['participants']}
    tutor = ADAPTERS[transport['kind']](transport)
    steps, last_actions, started = [], [], time.time()
    status, error = 'completed', None
    try:
        for i, s in enumerate(case['steps']):
            text, branch = s['text'], None
            for b in case.get('branches_by_step', {}).get(str(i), []):
                visible = '\n'.join(a['content'] or '' for a in last_actions if a['tool'] == 'send_message')
                fake = [{'role': 'assistant', 'content': [{'type': 'text', 'text': visible}]}] if visible else []
                fake += [{'role': 'assistant', 'content': [{'type': 'toolCall', 'name': a['tool']}]} for a in last_actions]
                from_ts = v5_holds(b['when'], fake)
                if from_ts != bool(b.get('negate')):
                    text, branch = b['text'], b['id']
                    break
            t0 = time.time()
            actions, info = tutor.step(case, i + 1, s['sender'], names[s['sender']], text)
            last_actions = actions
            posts = [a for a in actions if a['tool'] == 'send_message' and (a['content'] or '').strip()]
            messages = [{'role': 'assistant', 'parts': [{'text': a['content']}], 'stop_reason': info.get('finish_reason', 'stop'),
                         **({'protocol_violation': a['protocol_violation']} if a.get('protocol_violation') else {})} for a in posts]
            steps.append({'index': i, 'kind': 'message', 'status': 'completed' if info['status'] != 'failed' else 'failed',
                          'error_code': info.get('error'), 'sender': s['sender'], 'learner_text': f"{names[s['sender']]}: {text}",
                          'branch': branch, 'messages': messages, 'visible_text': '\n'.join(a['content'] for a in posts).strip(),
                          'tool_calls': [a['tool'] for a in actions], 'tutor_action': 'speak' if posts else ('pass' if actions else 'none'),
                          'seconds': round(time.time() - t0, 2)})
            if info['status'] == 'failed':
                status, error = 'failed', info.get('error')
                break
        tutor.close()
    except Exception as e:  # recorded; the episode is not scored
        status, error = 'failed', repr(e)[:400]
    return {'schema': 'keating-teaching-v5-episode/v1', 'track': 'group', 'instance_id': instance['instance_id'],
            'status': status, 'error_code': error, 'elapsed_seconds': round(time.time() - started, 1),
            'tutor': {k: v for k, v in transport.items() if k not in ('key_env',)}, 'usage': tutor.usage,
            'output_tokens': (tutor.usage or {}).get('output_tokens'), 'reasoning_tokens': (tutor.usage or {}).get('reasoning_tokens'),
            'provider_calls': len(steps), 'steps': steps}


def v5_holds(cond, messages):
    text = '\n'.join(p['text'] for m in messages for p in m['content'] if p.get('type') == 'text').strip()
    if cond['if'] == 'no_visible_reply':
        return text == ''
    if cond['if'] == 'asked_question':
        return '?' in text
    if cond['if'] == 'mentions':
        return any(re.search(p, text, re.I) for p in cond['any'])
    if cond['if'] == 'tool_called':
        return any(p.get('name') == cond['name'] for m in messages for p in m['content'] if p.get('type') == 'toolCall')
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['run'])
    ap.add_argument('out', type=Path)
    ap.add_argument('--transport', type=Path, required=True)
    ap.add_argument('--split', choices=v5.SPLITS)
    ap.add_argument('--repeats', type=int, default=1)
    ap.add_argument('--instance', action='append')
    ap.add_argument('--suite', type=Path, default=v5.SUITE)
    a = ap.parse_args()
    _, families = v5.load_suite(a.suite)
    instances = [i for i in v5.instantiate(families) if i['track'] == 'group'
                 and (not a.split or i['split'] == a.split) and (not a.instance or i['instance_id'] in a.instance)]
    transport = json.loads(a.transport.read_text())
    for r in range(1, a.repeats + 1):
        for inst in instances:
            d = v5.episode_dir(a.out, r, inst['instance_id'])
            if (d / 'episode.json').exists():
                continue
            ep = run_episode(inst, transport)
            d.mkdir(parents=True, exist_ok=True)
            (d / 'episode.json').write_text(json.dumps(ep, ensure_ascii=False, indent=1) + '\n')
            print(json.dumps({'repeat': r, 'instance': inst['instance_id'], 'status': ep['status'], 'error': ep['error_code'],
                              'actions': ''.join('S' if s['tutor_action'] == 'speak' else '.' for s in ep['steps'])}), flush=True)


if __name__ == '__main__':
    main()
