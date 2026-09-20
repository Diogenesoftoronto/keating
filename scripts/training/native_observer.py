"""Project validated native receipts into the frozen observer's public text contract."""
import argparse
import json
from pathlib import Path

from native_training import validate_episode, feature_inputs, native_hash
from observer_core import boundary_view, digest


def project_feature(feature, family, source):
    """No labels, hidden documents or private runtime payloads enter observer text."""
    boundary = feature['boundary']
    events = []
    spans = []
    input_events = feature['input_events']
    for index, event in enumerate(input_events):
        event_id, kind, payload = event['event_id'], event['kind'], event['payload']
        phase = 'pre_action'
        if event_id == feature['delivery_event_id']:
            phase = 'delivered'
        if boundary == 'retrospective' and kind in {'learner_intent', 'learner_delivery_evidence'} and index >= len(input_events) - 2:
            phase = 'retrospective'
        chunks = []
        if kind == 'learner_initial_message':
            chunks.append(('learner_message', payload['text'], None))
        elif kind in {'delivered_observation', 'source_observation'}:
            if payload['visibleText'].strip():
                chunks.append(('delivered_artifact', payload['visibleText'], event_id) if kind == 'source_observation'
                              else ('actor_message', payload['visibleText'], None))
            for document in payload['documents']:
                text = '\n'.join([document['heading'], *document['body']]).strip()
                if text:
                    chunks.append(('delivered_artifact', text, event_id))
        elif kind == 'learner_intent':
            intent = payload['intent']
            if intent['kind'] == 'message':
                chunks.append(('learner_message', intent['text'], None))
            elif intent['kind'] == 'ui_action':
                # Preserve actual learner input. No correct-answer or evaluator fields are added.
                chunks.append(('learner_message', json.dumps(intent, ensure_ascii=False, separators=(',', ':')), None))
        elif kind != 'learner_delivery_evidence':
            raise ValueError('Unsupported public native event')
        for chunk_index, (public_kind, text, receipt_id) in enumerate(chunks):
            projected_id = event_id if chunk_index == len(chunks) - 1 else f'{event_id}:part-{chunk_index}'
            public = {'event_id': projected_id, 'native_event_id': event_id, 'phase': phase,
                      'kind': public_kind, 'visibility': 'public', 'text': text}
            if receipt_id:
                public['receipt_id'] = receipt_id
            events.append(public)
            if phase == boundary:
                spans.append({'event_id': projected_id, 'start': 0, 'end': len(text)})
    if not events or not spans or events[-1]['phase'] != boundary:
        raise ValueError('No semantic evidence at the requested native boundary')
    record = {
        'record_id': f"{feature['episode_id']}:{feature['branch_id']}:{feature['event_id']}:{boundary}",
        'family_id': family, 'source': source, 'boundary': boundary,
        'latest_allowed_event_id': events[-1]['event_id'],
        'native_latest_allowed_event_id': feature['latest_allowed_event_id'],
        'native_latest_allowed_event_hash': feature['latest_allowed_event_hash'],
        'native_feature_hash': feature['feature_hash'],
        'events': events, 'spans': spans, 'labels': {}, 'label_provenance': {},
        'pooling_scope': 'all_semantic_content_at_requested_phase',
        'limitations': ['Session controls and delivery-status metadata remain provenance, not fabricated learner text.',
                       'Unknown need, action quality and learning labels remain missing.'],
    }
    boundary_view(record)
    return record


def project_episode(value):
    episode = validate_episode(value)
    return [project_feature(feature, value['family'], {'dataset': value['source'].get('dataset'),
                                                     'measurement': value['measurement'],
                                                     'episode_hash': native_hash(value)})
            for feature in feature_inputs(episode)]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('episodes', type=Path, nargs='+')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    records = [r for path in args.episodes for r in project_episode(json.loads(path.read_text()))]
    if len({r['record_id'] for r in records}) != len(records):
        raise ValueError('Duplicate projection record IDs')
    result = {'schema_version': 1, 'records': records,
              'projection_sha256': digest(records), 'weights_loaded': False}
    with args.output.open('x') as stream:
        json.dump(result, stream, ensure_ascii=False, allow_nan=False, indent=2)
    print(json.dumps({'records': len(records), 'projection_sha256': result['projection_sha256'], 'weights_loaded': False}))
