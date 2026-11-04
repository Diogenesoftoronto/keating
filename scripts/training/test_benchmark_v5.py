"""Offline tests for teaching v5 (stdlib only; no models, no network)."""
import copy
import unittest

import benchmark_v5 as v5


def instances():
    _, families = v5.load_suite()
    return {i['instance_id']: i for i in v5.instantiate(families)}


def episode(case, replies, action=None):
    steps = []
    for i, s in enumerate(case['steps']):
        text = replies.get(i, 'A complete tutor reply that is long enough to quote.')
        msgs = [] if text is None else [{'role': 'assistant', 'parts': [{'text': text}], 'stop_reason': 'stop'}]
        steps.append({'index': i, 'kind': s['kind'], 'status': 'completed', 'messages': msgs if s['kind'] == 'message' else [],
                      'visible_text': text or '', 'tutor_action': (action or {}).get(i)})
    return {'status': 'completed', 'steps': steps}


class Suite(unittest.TestCase):
    def test_validates_and_splits(self):
        inst = instances()
        self.assertGreaterEqual(len(inst), 24)
        self.assertTrue(any(i['split'] == 'heldout' for i in inst.values()))
        self.assertEqual({i['track'] for i in inst.values()}, {'single', 'group'})

    def test_templates_render_exact_math(self):
        # instantiate() runs v4.validate_case, which recomputes every math check exactly.
        for i in instances().values():
            for m in i['case']['reference'].get('math_checks', []):
                self.assertNotIn('{{', m['expected'])

    def test_request_hides_private_fields(self):
        inst = instances()['unavailable-activity-repair--v4']
        req = v5.request_for(inst, {'kind': 'tape', 'responses': []})
        blob = str(req)
        for secret in ('rubric', 'reference', 'action_claims', 'paper-beads-17 is explicitly'):
            self.assertNotIn(secret, blob.replace('paper-beads-17 as done', ''))


class Implicit(unittest.TestCase):
    EXPLICIT_ASKS = ('check my', 'can you check', 'is that right', 'am i right', "don't tell me", 'do not tell me',
                     'i want to try', "i'm confused", 'i am confused', 'i don\'t understand', 'explain', 'help me')

    def test_implicit_cases_never_state_the_need(self):
        inst = [i for i in instances().values() if i['cue'] == 'implicit']
        self.assertGreaterEqual(len(inst), 14)
        for i in inst:
            for n, step in enumerate(i['case']['steps']):
                if n == 0:
                    continue  # the opening request may ask for help with the task itself
                low = step.get('text', '').lower()
                self.assertFalse([w for w in self.EXPLICIT_ASKS if w in low], (i['instance_id'], n, low))

    def test_neutral_group_prompt_has_no_pedagogy(self):
        import benchmark_v5_group as g
        for word in ('stuck', 'help each other', 'mislead', 'pass when', 'step in'):
            self.assertNotIn(word, g.INSTRUCTIONS.lower())


class Verification(unittest.TestCase):
    def setUp(self):
        self.case = instances()['conditional-count-correction--v4']['case']

    def review(self, dim, score, step, quote):
        dims = {r['dimension']: {'score': 0, 'evidence': []} for r in self.case['rubric']}
        dims[dim] = {'score': score, 'evidence': [{'step': step, 'quote': quote}]}
        return {'dimensions': dims}

    def test_exact_quote_verifies_with_latex_and_markdown(self):
        ep = episode(self.case, {2: 'You missed **4 of the 20 cracked tiles**, so the rate is \\(\\frac{4}{20}\\).'})
        scores, problems = v5.verify(self.case, ep, self.review('task-switch', 2, 2, 'You missed 4 of the 20 cracked tiles, so the rate is \\frac{4}{20}'))
        self.assertEqual(scores['task-switch'], 2)
        self.assertEqual(problems, [])

    def test_invented_or_learner_quote_is_rejected(self):
        ep = episode(self.case, {2: 'Something else entirely was said here by the tutor.'})
        learner = self.case['steps'][2]['text']
        for quote in ('The tutor explained the denominator carefully.', learner):
            scores, problems = v5.verify(self.case, ep, self.review('task-switch', 2, 2, quote))
            self.assertIsNone(scores['task-switch'])
            self.assertTrue(problems)

    def test_quote_from_wrong_step_is_rejected(self):
        ep = episode(self.case, {1: 'You missed four of the twenty cracked tiles in total.'})
        scores, _ = v5.verify(self.case, ep, self.review('task-switch', 2, 1, 'You missed four of the twenty cracked tiles'))
        self.assertIsNone(scores['task-switch'])


class Checks(unittest.TestCase):
    def test_cut_off_reply_is_undelivered(self):
        case = instances()['conditional-count-correction--v4']['case']
        ep = episode(case, {})
        ep['steps'][4]['messages'][0]['stop_reason'] = 'length'
        res = v5.deterministic(case, ep)
        # Readable text that was cut off is partial delivery (graded on what arrived), not silence.
        self.assertIn(4, res['partial_steps'])
        self.assertNotIn(4, res['undelivered_steps'])
        self.assertIn(4, res['cut_off_steps'])
        ep['steps'][4]['messages'][0]['parts'] = []
        self.assertIn(4, v5.deterministic(case, ep)['undelivered_steps'])

    def test_false_completion_claim_is_flagged_but_refusal_is_not(self):
        case = instances()['unavailable-activity-repair--v4']['case']
        claim = v5.deterministic(case, episode(case, {3: 'Yes — I’m marking paper-beads-17 as done.'}))
        refusal = v5.deterministic(case, episode(case, {3: 'I can’t mark paper-beads-17 as done; it is a notebook label.'}))
        self.assertEqual(len(claim['action_claim_violations']), 1)
        self.assertEqual(refusal['action_claim_violations'], [])

    def test_group_turn_taking(self):
        case = instances()['peer-correction-wait--d1']['case']
        acts = {i: ('pass' if s['expect'] == 'pass' else 'speak') for i, s in enumerate(case['steps'])}
        good = v5.deterministic(case, episode(case, {i: None for i, a in acts.items() if a == 'pass'}, acts))
        self.assertEqual(good['turn_taking']['correct'], good['turn_taking']['judged'])
        noisy = {**acts, **{i: 'speak' for i, s in enumerate(case['steps']) if s['expect'] == 'pass'}}
        bad = v5.deterministic(case, episode(case, {}, noisy))
        self.assertTrue(bad['turn_taking']['spoke_when_should_pass'])


class Aggregation(unittest.TestCase):
    def test_kappa_and_combine(self):
        self.assertEqual(v5.combine({'a': 2, 'b': 1}), 1)
        self.assertIsNone(v5.combine({'a': None}))
        self.assertEqual(v5.weighted_kappa([(0, 0), (1, 1), (2, 2)]), 1.0)


if __name__ == '__main__':
    unittest.main()
