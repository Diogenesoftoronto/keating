# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx>=0.28,<1"]
# ///
"""One JSON semantic-classifier request on stdin; one JSON decision on stdout.

OpenAI-compatible model judge adapter. Hosted inference is explicit through CLI
arguments; importing this module makes no calls. API keys are environment names.
"""
import argparse
import json
import os
import sys
from urllib.parse import urlsplit


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--api-key-env', required=True)
    parser.add_argument('--max-tokens', type=int, default=2400)
    args = parser.parse_args(argv)
    endpoint = urlsplit(args.endpoint)
    if endpoint.scheme != 'https' or not endpoint.netloc or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
        parser.exit(2, 'A credential-free HTTPS endpoint is required.\n')
    if not 128 <= args.max_tokens <= 8000 or not os.environ.get(args.api_key_env):
        parser.exit(2, 'Token bound or API key environment is unavailable.\n')
    try:
        import httpx
        request = json.loads(sys.stdin.read())
        if request['stage'] not in ('need', 'reaction') or request['protocol'] != 'contextual-tutor-response/v1':
            raise ValueError('Unsupported classifier protocol')
        payload = {'model': args.model, 'messages': [
            {'role': 'system', 'content': request['system']},
            {'role': 'user', 'content': json.dumps({'stage': request['stage'], 'input': request['input']}, ensure_ascii=False)}],
            'temperature': 0, 'max_tokens': args.max_tokens, 'response_format': {'type': 'json_object'}, 'stream': False}
        with httpx.Client(timeout=120, follow_redirects=False) as client:
            response = client.post(args.endpoint.rstrip('/') + '/chat/completions', json=payload,
                                   headers={'Authorization': 'Bearer ' + os.environ[args.api_key_env]})
        response.raise_for_status()
        raw = response.json()
        choices = raw['choices']
        if len(choices) != 1 or choices[0]['finish_reason'] != 'stop':
            raise ValueError('Incomplete classification')
        value = json.loads(choices[0]['message']['content'])
        print(json.dumps(value, ensure_ascii=False, allow_nan=False))
    except Exception:
        # Transport exceptions can carry request headers; do not print them.
        parser.exit(2, 'Classifier transport or structured output failed; no grade.\n')


if __name__ == '__main__':
    main()
