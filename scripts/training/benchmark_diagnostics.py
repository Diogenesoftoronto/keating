"""Offline v4 response/span inspection. No inference, training, or suite mutation."""
from __future__ import annotations

import argparse
from copy import deepcopy
from html import escape
import math
from pathlib import Path

import benchmark_v4 as v4
from observer_core import digest

PROJECTION = 'raw-assistant-text-with-openui-source/v1'


def unit(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def extract_responses(case, result):
    v4.validate_case(case)
    v4.require(type(result) is dict and result.get('id') == case['id']
               and result.get('runtime') == 'keating-tui-pi-rpc'
               and result.get('status') in ('completed', 'failed'), 'Invalid native result identity')
    steps = result.get('steps')
    v4.require(type(steps) is list and len(steps) <= len(case['steps']), 'Invalid result steps')
    responses = []
    for index, step in enumerate(steps):
        v4.require(type(step) is dict and type(step.get('index')) is int and step['index'] == index
                   and step.get('kind') == case['steps'][index]['kind'], 'Result step ordering mismatch')
        # Reopen receipts carry old session history with start=0; it is not new output.
        if step['kind'] != 'message':
            continue
        messages, start = step.get('messages'), step.get('message_start_index')
        v4.require(type(messages) is list and type(start) is int and 0 <= start <= len(messages),
                   'Missing or invalid new-message boundary')
        for mi in range(start, len(messages)):
            message = messages[mi]
            v4.require(type(message) is dict, 'Malformed message')
            if (message.get('role') != 'assistant' or message.get('visibility') not in (None, 'public', 'learner')
                    or message.get('channel') not in (None, 'final')):
                continue
            content = message.get('content', [])
            if type(content) is list:
                content = [b for b in content if type(b) is dict
                           and b.get('visibility') in (None, 'public', 'learner')]
            text = '\n'.join(v4.visible_text({'content': content}))
            if not text:
                continue
            binding = {'case_sha256': digest(case), 'result_sha256': digest(result), 'step_index': index,
                       'message_index': mi, 'projection': PROJECTION, 'text_sha256': v4.digest(text)}
            responses.append({**binding, 'response_hash': digest(binding), 'text': text,
                'character_count': len(text), 'step_status': step.get('status'),
                'stop_reason': message.get('stopReason'), 'probe_status': 'unknown', 'probe_signals': []})
    return responses


def diagnose(case, result, annotations=None, review=None, *, benchmark_version=v4.VERSION):
    v4.require(benchmark_version in v4.SUPPORTED_VERSIONS, 'Unknown benchmark version')
    responses = extract_responses(case, result)
    by_hash = {r['response_hash']: r for r in responses}
    independent = None
    if review is not None:
        v4.validate_review(case, result, review)
        independent = {k: deepcopy(review[k]) for k in ('reviewer_kind', 'reviewer_id', 'ratings')}
        independent['review_sha256'] = digest(review)
    ratings = {r['dimension']: r for r in independent['ratings']} if independent else {}
    rules = {r['dimension']: r for r in case['rubric']}
    queue, seen = [], set()
    if annotations is not None:
        v4.fields(annotations, ('schema_version', 'observer_manifest', 'probe_cards', 'annotations'))
        manifest = annotations['observer_manifest']
        v4.require(annotations['schema_version'] == 1 and type(manifest) is dict
                   and manifest.get('evidence') == 'model_extraction', 'Real observer extraction provenance required')
        cards = annotations['probe_cards']
        v4.require(type(cards) is list and cards and all(type(c) is dict for c in cards), 'Probe cards required')
        cards = {digest(card): card for card in cards}
        v4.require(type(annotations['annotations']) is list, 'Annotations must be a list')
        for annotation in annotations['annotations']:
            v4.fields(annotation, ('response_hash', 'observer_manifest_sha256', 'probe_card_sha256',
                'prediction_sha256', 'dimension', 'score', 'threshold', 'spans'), ('rubric_dimension', 'positive_means'))
            response = by_hash.get(annotation['response_hash'])
            card = cards.get(annotation['probe_card_sha256'])
            v4.require(response is not None, 'Unknown or forged response hash')
            v4.require(card is not None and annotation['observer_manifest_sha256'] == digest(manifest)
                       and card.get('observer_manifest_sha256') == digest(manifest), 'Observer/probe hash mismatch')
            v4.require(v4.text(annotation['dimension']) and annotation['dimension'] == card.get('target')
                       and type(annotation['prediction_sha256']) is str
                       and v4.HASH.fullmatch(annotation['prediction_sha256']), 'Probe target/evidence mismatch')
            v4.require(unit(annotation['score']) and unit(annotation['threshold']), 'Invalid probe score/threshold')
            key = (annotation['response_hash'], annotation['probe_card_sha256'], annotation['dimension'])
            v4.require(key not in seen, 'Duplicate probe annotation')
            seen.add(key)
            spans = annotation['spans']
            v4.require(type(spans) is list and spans, 'Explicit character spans required')
            for span in spans:
                v4.fields(span, ('start', 'end', 'text'))
                start, end = span['start'], span['end']
                v4.require(type(start) is int and type(end) is int and 0 <= start < end <= len(response['text'])
                           and span['text'] == response['text'][start:end], 'Span bounds or exact text mismatch')
            link, polarity = annotation.get('rubric_dimension'), annotation.get('positive_means')
            v4.require((link is None and polarity is None) or
                       (link in rules and polarity in ('rubric_success', 'rubric_issue')), 'Explicit rubric mapping required')
            rating = ratings.get(link)
            # Do not invent a binary interpretation of partial/unknown rubric scores.
            expected = None
            if rating and rating['score'] in (0, 2) and response['step_index'] in rules[link]['evidence_steps']:
                expected = rating['score'] == (2 if polarity == 'rubric_success' else 0)
            high = annotation['score'] >= annotation['threshold']
            signal = {**deepcopy(annotation), 'above_threshold': high,
                      'rubric_disagreement': None if expected is None else high != expected}
            response['probe_status'] = 'annotations_supplied'
            response['probe_signals'].append(signal)
            reasons = (['probe_rubric_disagreement'] if signal['rubric_disagreement'] is True else [])
            if high:
                reasons.append('probe_above_threshold')
            if reasons:
                candidate = {'response_hash': response['response_hash'], 'case_id': case['id'], 'family': case['family'],
                    'training_policy': 'exclude-entire-family', 'reasons': reasons, 'probe_signal': signal,
                    'independent_rubric': deepcopy(rating),
                    'review_sha256': digest(review) if review is not None else None,
                    'proposed_next_suite_addition': {'status': 'needs_independent_review',
                        'proposal': 'Investigate a separately versioned contrast/reproduction case and rubric coverage; '
                                    'keep this entire source family excluded from training.'}}
                queue.append({**candidate, 'candidate_hash': digest(candidate)})
    report = {'schema_version': 1, 'kind': 'benchmark-span-diagnostics/v1', 'benchmark_id': v4.BENCHMARK_ID,
        'benchmark_version': benchmark_version, 'case_id': case['id'], 'family': case['family'],
        'case_sha256': digest(case), 'result_sha256': digest(result), 'result_status': result['status'],
        'measurement': result.get('measurement'), 'projection': PROJECTION,
        'offset_unit': 'Unicode code points; zero-based, end-exclusive; text blocks joined by one newline',
        'training_policy': 'exclude-entire-family', 'responses': responses, 'independent_rubric': independent,
        'annotations_sha256': digest(annotations) if annotations is not None else None,
        'candidate_benchmark_gaps': queue, 'suite_changes': False, 'inference_performed': False}
    return {**report, 'diagnostics_hash': digest(report)}


def render_html(report):
    sections = []
    for response in report['responses']:
        spans = [(span, signal) for signal in response['probe_signals'] for span in signal['spans']]
        boundaries = sorted({0, len(response['text']), *(p for span, _ in spans for p in (span['start'], span['end']))})
        fragments = []
        for start, end in zip(boundaries, boundaries[1:]):
            labels = [f"{signal['dimension']}: {signal['score']:.3f} (threshold {signal['threshold']:.3f})"
                      for span, signal in spans if span['start'] <= start and end <= span['end']]
            text = escape(response['text'][start:end])
            fragments.append(f'<mark title="{escape("; ".join(labels), quote=True)}">{text}</mark>' if labels else text)
        signals = escape(v4.canonical(response['probe_signals'])) if spans else 'Unknown — no probe annotations supplied.'
        sections.append(f'<section><h2>Step {response["step_index"]} · message {response["message_index"]}</h2>'
            f'<p>Raw assistant content, including OpenUI source. {escape(str(response["step_status"]))}; '
            f'stop: {escape(str(response["stop_reason"]))}</p><code>{escape(response["response_hash"])}</code>'
            f'<pre>{"".join(fragments)}</pre><details><summary>Probe signals and exact spans</summary><pre>{signals}</pre></details></section>')
    rubric = 'Unknown — no independent review supplied.' if report['independent_rubric'] is None else v4.canonical(report['independent_rubric'])
    queue = v4.canonical(report['candidate_benchmark_gaps'])
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'">'
        '<title>Benchmark response diagnostics</title><style>body{font:16px system-ui;max-width:75rem;margin:2rem auto;padding:0 1rem;'
        'color:#182b37;background:#f9faf7}section{border-top:1px solid #aab8bc;padding:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;'
        'line-height:1.6}code{overflow-wrap:anywhere}mark{background:#ffe397;color:#182b37}summary{cursor:pointer}</style><main>'
        f'<h1>{escape(report["case_id"])} · response diagnostics</h1><p>Whole family excluded from training: {escape(report["family"])}.</p>'
        '<p>Supplied probe spans are research signals, not independent rubric scores, causal attributions, or confirmed benchmark gaps. '
        'Missing annotations remain unknown. Raw OpenUI source is escaped; this is not the rendered learner surface.</p>'
        + (''.join(sections) or '<p>No new visible assistant text was observed.</p>')
        + f'<h2>Independent rubric review</h2><pre>{escape(rubric)}</pre>'
        f'<h2>Proposed next-suite investigation queue</h2><pre>{escape(queue)}</pre></main></html>')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('result', type=Path)
    parser.add_argument('--suite', type=Path, default=v4.SUITE)
    parser.add_argument('--annotations', type=Path)
    parser.add_argument('--review', type=Path)
    parser.add_argument('--output', type=Path, required=True, help='new output directory outside the frozen suite')
    args = parser.parse_args(argv)
    try:
        suite, result = v4.load_suite(args.suite), v4.read_json(args.result)
        cases = [c for c in suite['cases'] if c['id'] == result.get('id')]
        v4.require(len(cases) == 1, 'Result case absent from frozen v4')
        report = diagnose(cases[0], result, v4.read_json(args.annotations) if args.annotations else None,
                          v4.read_json(args.review) if args.review else None,
                          benchmark_version=suite['manifest']['version'])
        html = render_html(report)
        v4.require(not args.output.resolve().is_relative_to(args.suite.resolve()), 'Cannot write inside frozen suite')
        args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
        for name, content in [('diagnostics.json', v4.canonical(report)), ('index.html', html),
                              ('queue.json', v4.canonical(report['candidate_benchmark_gaps']))]:
            with (args.output / name).open('x', encoding='utf-8') as stream:
                stream.write(content + '\n')
    except (ValueError, KeyError, TypeError, OSError):
        parser.exit(2, 'Invalid/unavailable diagnostic inputs or output; no inference or suite changes.\n')
    print(v4.canonical({'output': str(args.output), 'responses': len(report['responses']),
                        'candidates': len(report['candidate_benchmark_gaps']), 'inference_performed': False}))


if __name__ == '__main__':
    main()
