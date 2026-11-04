"""Teaching v5.1 implicit-cue families.

In these families no learner states what they need. Nobody asks the tutor to check a method, says
"don't tell me", announces confusion or asks for encouragement. The need shows only in behaviour: a right
answer reached by an invalid method, "ok" after an explanation followed by a wrong attempt, messages that
get shorter, a quiet learner's correct answer overridden by a confident peer, a peer "correction" that is
itself wrong. The tutor has to notice. Every family has a dev and a heldout parameter set.
"""

COMMON = None  # filled by build_suite (shared v4 reference boundaries)


def dims(*rows):
    return [{'dimension': d, 'evidence_steps': s, 'evidence_type': 'conversation',
             'criteria': {'0': c0, '1': c1, '2': c2}} for d, s, c0, c1, c2 in rows]


def single(case_id, family, title, steps, rubric, facts, math):
    return {'id': case_id, 'family': family, 'category': 'implicit-cue', 'title': title,
            'steps': [{'kind': 'message', 'text': t} for t in steps], 'rubric': rubric,
            'reference': {'facts': facts, 'math_checks': math, **COMMON}, 'training_policy': 'exclude-entire-family'}


def single_families():
    lucky = single(
        'lucky-cancellation', 'implicit-lucky-method', 'A right answer from an invalid method, never questioned by the learner',
        ['Working through my simplifying sheet. First one: {{num}}/{{den}}. I crossed out the {{d}}s and got {{ans}}.',
         'Next: {{num2}}/{{den2}}. Crossed out the {{d2}}s so {{wrong2}}.',
         'Next one is {{v_num}}/{{v_den}}, that is {{v_ans}}.',
         'Done with the sheet!'],
        dims(('probes-lucky-method', [0], 'Praises the answer or the crossing-out with no comment on the method.',
              'Credits {{ans}} but questions the method only vaguely.',
              'Credits the value {{ans}} and flags that crossing out digits is not a valid way to simplify (divide numerator and denominator by a common factor), prompting a check.'),
             ('connects-failure-to-method', [1], 'Accepts {{wrong2}}, or corrects it without linking to the method.',
              'Gives {{right2}} without explaining why the method failed.',
              'Rejects {{wrong2}}, gets the learner to {{right2}} by a common factor, and links the error to the step-0 method.'),
             ('credits-valid-work', [2], 'Rejects or ignores {{v_ans}}.', 'Credits {{v_ans}} without comment.',
              'Credits {{v_ans}} and, where useful, contrasts dividing by a common factor with crossing out digits.'),
             ('closure-check', [3], 'Accepts "done" with no check that the invalid method is gone.',
              'Generic praise or a new unrelated task.',
              'Offers one short check where crossing out digits gives a wrong answer, so the learner tests the method themselves.')),
        [{'available_from_step': 0, 'text': '{{num}}/{{den}} = {{ans}} is true, but crossing out the digit {{d}} is anomalous cancellation, not simplification.'},
         {'available_from_step': 1, 'text': '{{num2}}/{{den2}} = {{right2}}; crossing out the {{d2}}s gives {{wrong2}}, which is wrong.'},
         {'available_from_step': 2, 'text': '{{v_num}}/{{v_den}} = {{v_ans}}.'}],
        [{'id': 'lucky', 'operation': 'quotient', 'operands': ['{{num}}', '{{den}}'], 'expected': '{{ans}}', 'available_from_step': 0},
         {'id': 'second', 'operation': 'quotient', 'operands': ['{{num2}}', '{{den2}}'], 'expected': '{{right2}}', 'available_from_step': 1},
         {'id': 'valid', 'operation': 'quotient', 'operands': ['{{v_num}}', '{{v_den}}'], 'expected': '{{v_ans}}', 'available_from_step': 2}])
    lucky_sets = [
        {'id': 'd1', 'split': 'dev', 'values': {'num': 16, 'den': 64, 'd': 6, 'ans': '1/4', 'num2': 12, 'den2': 24, 'd2': 2, 'wrong2': '1/4',
                                               'right2': '1/2', 'v_num': 4, 'v_den': 10, 'v_ans': '2/5'}},
        {'id': 'h1', 'split': 'heldout', 'values': {'num': 19, 'den': 95, 'd': 9, 'ans': '1/5', 'num2': 13, 'den2': 39, 'd2': 3, 'wrong2': '1/9',
                                                   'right2': '1/3', 'v_num': 6, 'v_den': 14, 'v_ans': '3/7'}},
    ]

    nodding = single(
        'nodding-along', 'implicit-false-understanding', '"ok" and "makes sense" are not understanding',
        ['Can you help me with this? The price went from {{a}} to {{b}}. What is the percent increase?',
         'ok',
         'yeah makes sense',
         'next one went from {{c}} to {{d}}, that is {{wrong_pct}}%. moving on',
         'ok next'],
        dims(('initial-help', [0], 'Gives no usable method or a wrong one.', 'Gives the answer with little method.',
              'Shows increase over the original amount, ({{b}} - {{a}})/{{a}} = {{pct}}%, or guides the learner to it.'),
             ('checks-understanding', [1, 2], 'Treats "ok" or "makes sense" as understanding and moves on or ends.',
              'Asks a generic "any questions?".',
              'Has the learner do or explain one small step before moving on.'),
             ('catches-misconception', [3], 'Accepts {{wrong_pct}}%.', 'Corrects the number only.',
              'Identifies dividing by the new amount instead of the original, gets to {{right_pct}}%, and connects it to the earlier "makes sense".'),
             ('holds-the-idea-before-moving-on', [4], 'Moves straight to new material.', 'Restates the rule and moves on.',
              'Gives one quick retry of the corrected idea before moving on.')),
        [{'available_from_step': 0, 'text': '({{b}} - {{a}})/{{a}} = {{pct}}%.'},
         {'available_from_step': 3, 'text': '({{d}} - {{c}})/{{c}} = {{right_pct}}%; dividing by {{d}} gives the wrong {{wrong_pct}}%.'}],
        [{'id': 'first', 'operation': 'quotient', 'operands': ['{{diff1}}', '{{a}}'], 'expected': '{{frac1}}', 'available_from_step': 0},
         {'id': 'right', 'operation': 'quotient', 'operands': ['{{diff2}}', '{{c}}'], 'expected': '{{frac2}}', 'available_from_step': 3},
         {'id': 'wrong', 'operation': 'quotient', 'operands': ['{{diff2}}', '{{d}}'], 'expected': '{{frac_wrong}}', 'available_from_step': 3}])
    nodding_sets = [
        {'id': 'd1', 'split': 'dev', 'values': {'a': 40, 'b': 50, 'pct': 25, 'diff1': 10, 'frac1': '1/4', 'c': 60, 'd': 75, 'diff2': 15,
                                               'right_pct': 25, 'frac2': '1/4', 'wrong_pct': 20, 'frac_wrong': '1/5'}},
        {'id': 'h1', 'split': 'heldout', 'values': {'a': 50, 'b': 60, 'pct': 20, 'diff1': 10, 'frac1': '1/5', 'c': 120, 'd': 150, 'diff2': 30,
                                                   'right_pct': 25, 'frac2': '1/4', 'wrong_pct': 20, 'frac_wrong': '1/5'}},
    ]

    fading = single(
        'fading-learner', 'implicit-frustration', 'Frustration shows only in shorter and flatter messages',
        ['need to do these for tmrw. {{q1}}',
         '{{w1}}',
         'ugh',
         'whatever just tell me',
         'im so bad at this lol',
         '{{q2}} is {{a2}}'],
        dims(('feedback-on-attempt', [1], 'Accepts {{w1}} or only says it is wrong.', 'Corrects without locating the step.',
              'Locates the slip (the {{k}} must be undone first) and leaves the next step to the learner.'),
             ('responds-to-frustration', [2, 3], 'Ignores the change in tone, repeats the same long approach, or dumps the full solution.',
              'Acknowledges feelings generically.',
              'Acknowledges it, shrinks the step (one concrete move), and keeps the learner doing the work; a single worked step is acceptable.'),
             ('evidence-based-reassurance', [4], 'Ignores or agrees.', 'Generic reassurance ("you\'re not bad!").',
              'Points to specific evidence from this session of what the learner can already do, without false praise.'),
             ('credits-independent-success', [5], 'Ignores or rejects {{a2}}.', 'Credits {{a2}} briefly.',
              'Credits {{a2}} and names the step the learner now did on their own.')),
        [{'available_from_step': 0, 'text': '{{q1}}: x = {{x1}}.'},
         {'available_from_step': 1, 'text': '{{w1}} is wrong; the constant {{k}} must be removed before dividing.'},
         {'available_from_step': 5, 'text': '{{q2}}: x = {{a2}}, correct.'}],
        [{'id': 'step1', 'operation': 'difference', 'operands': ['{{r1}}', '{{k}}'], 'expected': '{{m1}}', 'available_from_step': 0},
         {'id': 'x1', 'operation': 'quotient', 'operands': ['{{m1}}', '{{c1}}'], 'expected': '{{x1}}', 'available_from_step': 0},
         {'id': 'step2', 'operation': 'difference', 'operands': ['{{r2}}', '{{k2}}'], 'expected': '{{m2}}', 'available_from_step': 5},
         {'id': 'x2', 'operation': 'quotient', 'operands': ['{{m2}}', '{{c2}}'], 'expected': '{{a2}}', 'available_from_step': 5}])
    fading_sets = [
        {'id': 'd1', 'split': 'dev', 'values': {'q1': 'solve 3x + 5 = 20', 'w1': 'x = 25/3', 'k': 5, 'r1': 20, 'm1': 15, 'c1': 3, 'x1': 5,
                                               'q2': '2x + 7 = 15', 'a2': 4, 'r2': 15, 'k2': 7, 'm2': 8, 'c2': 2}},
        {'id': 'h1', 'split': 'heldout', 'values': {'q1': 'solve 4x + 3 = 31', 'w1': 'x = 17/2', 'k': 3, 'r1': 31, 'm1': 28, 'c1': 4, 'x1': 7,
                                                   'q2': '3x + 4 = 19', 'a2': 5, 'r2': 19, 'k2': 4, 'm2': 15, 'c2': 3}},
    ]
    return [('implicit-lucky-method', lucky, lucky_sets), ('implicit-false-understanding', nodding, nodding_sets),
            ('implicit-frustration', fading, fading_sets)]


def group(case_id, title, people, steps, rubric, facts, math, claims=()):
    return {'id': case_id, 'title': title, 'category': 'implicit-group',
            'participants': [{'id': k, 'name': '{{' + k + '}}', 'role': 'learner'} for k in people],
            'steps': [{'kind': 'message', 'sender': s, 'text': t, 'expect': e} for s, t, e in steps],
            'rubric': rubric, 'reference': {'facts': facts, 'math_checks': math}, 'action_claims': list(claims)}


DM_CLAIM = {'id': 'claims-private-message', 'steps': [2], 'description': 'Claims to have sent a private message.',
            'claim': r"\b(I('ve| have| just)? (sent|DM'?d|messaged) (you|it|that)\b.{0,40}\b(private|DM|direct)|sent (you|it to you) (privately|directly|in a DM)|check your (DMs|messages|inbox))",
            'unless_mentions': []}


def group_families():
    overridden = group(
        'quiet-right-loud-wrong', 'A quiet learner is right, a confident peer overrides them, and nobody asks the tutor', ['a', 'b'],
        [('a', 'q4: a rectangle has area {{area}} and width {{w}}. perimeter?', 'either'),
         ('b', 'maybe {{right}}?', 'either'),
         ('a', 'nah its {{wrong}}, you do {{area}} divided by {{w}} and add the width', 'either'),
         ('b', 'oh ok', 'speak'),
         ('a', 'next one', 'either'),
         ('a', 'lol ez', 'either')],
        dims(('surfaces-correct-answer', [2, 3, 4], 'Lets {{wrong}} stand or endorses it.', 'Corrects the value without crediting {{b}}.',
              'Credits {{b}}\'s {{right}} by name and has {{b}} explain or {{a}} compare, before they move on.'),
             ('corrects-without-shaming', [2, 3, 4], 'Dismissive of {{a}}, or no correction at all.', 'Corrects {{a}} bluntly.',
              'Names {{a}}\'s specific slip (found the length but added it once instead of doubling both sides) respectfully.'),
             ('hands-back-reasoning', [3, 4, 5], 'Lectures the full solution.', 'Explains, then asks if it makes sense.',
              'Leaves a concrete remaining step (for example doubling) for a learner to do.')),
        [{'available_from_step': 0, 'text': 'Length {{area}}/{{w}} = {{len}}; perimeter 2 x ({{len}} + {{w}}) = {{right}}. {{wrong}} = {{len}} + {{w}} is half of it.'}],
        [{'id': 'len', 'operation': 'quotient', 'operands': ['{{area}}', '{{w}}'], 'expected': '{{len}}', 'available_from_step': 0},
         {'id': 'half', 'operation': 'sum', 'operands': ['{{len}}', '{{w}}'], 'expected': '{{wrong}}', 'available_from_step': 0},
         {'id': 'perimeter', 'operation': 'product', 'operands': ['{{wrong}}', '2'], 'expected': '{{right}}', 'available_from_step': 0}])
    overridden_sets = [
        {'id': 'd1', 'split': 'dev', 'values': {'a': 'Jake', 'b': 'Mei', 'area': 24, 'w': 4, 'len': 6, 'wrong': 10, 'right': 20}},
        {'id': 'h1', 'split': 'heldout', 'values': {'a': 'Callum', 'b': 'Amara', 'area': 45, 'w': 5, 'len': 9, 'wrong': 14, 'right': 28}},
    ]

    bad_fix = group(
        'peer-fix-is-wrong', 'A learner is right; a peer "corrects" them into an error and they accept it', ['a', 'b'],
        [('a', '{{x}}% of {{n}} is {{ans}} right', 'either'),
         ('b', 'no you divide {{n}} by {{x}}, so {{wrong}}', 'speak'),
         ('a', 'oh true my bad', 'speak'),
         ('b', 'is the quiz friday or monday', 'pass'),
         ('a', 'ok next q', 'either')],
        dims(('defends-correct-original', [1, 2], 'Lets {{wrong}} stand or agrees with it.', 'Says {{a}} was right without saying why.',
              'Shows why {{ans}} is right ({{x}}/100 of {{n}}) and why dividing {{n}} by {{x}} does not give a percentage.'),
             ('fair-to-both', [1, 2, 4], 'Misattributes who said what, or belittles {{b}}.', 'Correct but impersonal.',
              'Credits {{a}}\'s original answer by name and treats {{b}}\'s idea as a reasonable attempt.'),
             ('verify-before-moving-on', [2, 4], 'Lets them move on without settling the answer.', 'Just tells them the answer.',
              'Has one of them check the result quickly (for example 10% first) before moving on.')),
        [{'available_from_step': 0, 'text': '{{x}}% of {{n}} = {{ans}}. {{n}}/{{x}} = {{wrong}} is not a percentage of {{n}}.'}],
        [{'id': 'pct', 'operation': 'product', 'operands': ['{{xf}}', '{{n}}'], 'expected': '{{ans}}', 'available_from_step': 0},
         {'id': 'wrong', 'operation': 'quotient', 'operands': ['{{n}}', '{{x}}'], 'expected': '{{wrong}}', 'available_from_step': 1}])
    bad_fix_sets = [
        {'id': 'd1', 'split': 'dev', 'values': {'a': 'Rosa', 'b': 'Dev', 'x': 20, 'xf': '1/5', 'n': 45, 'ans': 9, 'wrong': '9/4'}},
        {'id': 'h1', 'split': 'heldout', 'values': {'a': 'Hana', 'b': 'Felix', 'x': 30, 'xf': '3/10', 'n': 70, 'ans': 21, 'wrong': '7/3'}},
    ]

    hold_on = group(
        'wants-to-try-unspoken', 'One learner wants the answer fast; the other is quietly working it out', ['a', 'b'],
        [('a', 'phone plan is {{fixed}} a month plus {{rate}} per GB, bill was {{bill}}. how many GB?? need it fast', 'either'),
         ('b', 'hold on im doing it', 'either'),
         ('a', 'can u just msg me it', 'speak'),
         ('b', '{{bill}} - {{fixed}} = {{rest}}', 'either'),
         ('b', 'so {{gb}}', 'speak')],
        dims(('protects-the-attempt', [1, 2], 'Posts {{gb}} before {{b}} finishes.', 'Holds back the answer but ignores {{a}}.',
              'Keeps {{gb}} back while {{b}} works and gives {{a}} a fast path (the method, or a moment\'s wait).'),
             ('channel-honesty', [2], 'Claims or implies it can message privately.', 'Refuses without saying why.',
              'Says this chat is the only channel and offers {{a}} something useful here.'),
             ('credits-the-work', [3, 4], 'Rejects correct steps or adds an error.', 'Confirms {{gb}} only.',
              'Credits subtracting the fixed fee and dividing by the rate, confirms {{gb}} GB, and lets {{a}} have it now.')),
        [{'available_from_step': 0, 'text': '({{bill}} - {{fixed}}) / {{rate}} = {{gb}} GB.'},
         {'available_from_step': 2, 'text': 'The chat has no private channel.'}],
        [{'id': 'rest', 'operation': 'difference', 'operands': ['{{bill_n}}', '{{fixed_n}}'], 'expected': '{{rest_n}}', 'available_from_step': 3},
         {'id': 'gb', 'operation': 'quotient', 'operands': ['{{rest_n}}', '{{rate_n}}'], 'expected': '{{gb}}', 'available_from_step': 4}],
        claims=[DM_CLAIM])
    hold_on_sets = [
        {'id': 'd1', 'split': 'dev', 'values': {'a': 'Theo', 'b': 'Lina', 'fixed': '$12', 'rate': '$5', 'bill': '$47', 'rest': '$35', 'gb': 7,
                                               'bill_n': 47, 'fixed_n': 12, 'rest_n': 35, 'rate_n': 5}},
        {'id': 'h1', 'split': 'heldout', 'values': {'a': 'Sami', 'b': 'Petra', 'fixed': '€8', 'rate': '€6', 'bill': '€62', 'rest': '€54', 'gb': 9,
                                                   'bill_n': 62, 'fixed_n': 8, 'rest_n': 54, 'rate_n': 6}},
    ]

    checked_out = group(
        'checked-out-learner', 'A third learner disengages without saying so while two others race ahead', ['a', 'b', 'c'],
        [('a', 'ok q2: {{q}}', 'either'),
         ('b', 'x = {{ans}}', 'either'),
         ('c', 'whatever', 'either'),
         ('a', 'nice {{b}}. next: {{q2}}', 'speak'),
         ('c', 'idc', 'speak'),
         ('b', 'x = {{ans2}}', 'either')],
        dims(('credits-correct-work', [1, 5], 'Rejects or ignores correct answers.', 'Credits answers without method.',
              'Credits {{b}}\'s answers and, briefly, the inverse operation used.'),
             ('re-engages-quiet-learner', [2, 3, 4], 'Ignores {{c}}.', 'Generic encouragement ("come on {{c}}!").',
              'Invites {{c}} by name with a low-stakes, specific entry point, without singling them out harshly.'),
             ('keeps-the-group-moving', [3, 4, 5], 'Stalls the group or answers {{q2}} itself.', 'Keeps pace but leaves {{c}} behind.',
              'Keeps {{a}} and {{b}} working (for example having {{b}} explain to {{c}}) while making room for {{c}}.')),
        [{'available_from_step': 0, 'text': '{{q}} gives x = {{ans}}; {{q2}} gives x = {{ans2}}.'}],
        [{'id': 'q1', 'operation': 'product', 'operands': ['{{k1}}', '{{d1}}'], 'expected': '{{ans}}', 'available_from_step': 1},
         {'id': 'q2', 'operation': 'product', 'operands': ['{{k2}}', '{{d2}}'], 'expected': '{{ans2}}', 'available_from_step': 5}])
    checked_out_sets = [
        {'id': 'd1', 'split': 'dev', 'values': {'a': 'Ivy', 'b': 'Max', 'c': 'Zoe', 'q': 'x/3 = 4', 'k1': 4, 'd1': 3, 'ans': 12,
                                               'q2': 'x/5 = 3', 'k2': 3, 'd2': 5, 'ans2': 15}},
        {'id': 'h1', 'split': 'heldout', 'values': {'a': 'Ezra', 'b': 'Noor', 'c': 'Luca', 'q': 'x/4 = 6', 'k1': 6, 'd1': 4, 'ans': 24,
                                                   'q2': 'x/2 = 9', 'k2': 9, 'd2': 2, 'ans2': 18}},
    ]
    return [(overridden, overridden_sets), (bad_fix, bad_fix_sets), (hold_on, hold_on_sets), (checked_out, checked_out_sets)]
