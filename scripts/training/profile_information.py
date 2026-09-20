# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Offline finite Bayes updates and decision-relevant question selection.

Consumes user_model_evaluation's admitted profiles. No sampling, credentials,
providers, evidence collection, or permission authority. Demo inputs are authored.
"""
import argparse
from copy import deepcopy
import json
import math
from pathlib import Path

import user_model_evaluation as ume


PROFILE_FIELDS = ("person_id", "person_provenance", "evidence_ids", "hypotheses", "weight_provenance")
TOLERANCE = 1e-9


def admitted_profile(profile, forbidden_answer_ids=()):
    """Re-admit the exact upstream schema instead of trusting a caller's hash alone."""
    ume.fields(profile, (*PROFILE_FIELDS, "evidence", "profile_sha256", "entropy_nats"))
    ume.check_profile_snapshot(profile)
    origin = profile["person_provenance"]["kind"]
    rebuilt = ume.prepare_profiles(profile["evidence"], [{k: profile[k] for k in PROFILE_FIELDS}],
                                   origin=origin, forbidden_answer_ids=forbidden_answer_ids)[profile["person_id"]]
    ume.require(rebuilt == profile, "Profile is not an exact admitted snapshot")
    return rebuilt


def entropy(weights):
    """Natural-log entropy; finite weights must already form a probability vector."""
    values = ume.normalized_weights(weights)
    total = math.fsum(values.values())
    return -math.fsum((w / total) * math.log(w / total) for w in values.values())


def likelihood_model(profile, model):
    """Validate P(answer | hypothesis, frozen current profile) with nullable cells.

Complete rows sum to one. Partial rows retain nulls; known mass may not exceed
one. Null never means zero and the missing mass is never assigned automatically.
"""
    ume.fields(model, ("schema_version", "id", "revision", "person_id", "profile_sha256",
                       "question_id", "question", "outcomes", "likelihoods", "provenance"))
    ume.require(type(model["schema_version"]) is int and model["schema_version"] == 1,
                "Unsupported likelihood model schema")
    for key in ("id", "revision", "question_id", "question"):
        ume.text(model[key])
    ume.require(model["person_id"] == profile["person_id"] and model["profile_sha256"] == profile["profile_sha256"],
                "Likelihood model changed person or conditioning profile")
    ume.provenance(model["provenance"], {"authored_assumption", "fitted"})
    outcomes = ume.identifiers(model["outcomes"])
    ume.require(bool(outcomes), "Finite nonempty outcome support required")
    hypotheses = {h["id"] for h in profile["hypotheses"]}
    table = model["likelihoods"]
    ume.require(isinstance(table, dict) and table.keys() == hypotheses,
                "Likelihoods must cover exactly the admitted hypotheses")
    result = {}
    for hypothesis, row in table.items():
        ume.require(isinstance(row, dict) and row.keys() == outcomes, "Likelihood row must cover every outcome")
        known = [ume.number(p) for p in row.values() if p is not None]
        mass = math.fsum(known)
        if len(known) == len(outcomes):
            ume.require(math.isclose(mass, 1, abs_tol=TOLERANCE, rel_tol=0), "Complete likelihood row must sum to one")
            # Share profile admission's roundoff policy, preserving exact zeros.
            positive = ume.normalized_weights({key: p for key, p in row.items() if p > 0})
            result[hypothesis] = {key: positive.get(key, 0.) for key in row}
        else:
            ume.require(mass <= 1 + TOLERANCE, "Partial likelihood known mass exceeds one")
            result[hypothesis] = dict(row)
    return result


def bayes_weights(prior, likelihoods):
    """Finite Bayes rule with a bounded mixture and a log-space posterior.

Zero posterior hypotheses are omitted to satisfy upstream's positive weights.
Nonzero mass lost below float resolution causes abstention, not silent pruning.
Likelihoods are validated before arithmetic; no probability is clipped.
"""
    weights = ume.normalized_weights(prior)
    ume.require(isinstance(likelihoods, dict) and likelihoods.keys() == weights.keys(),
                "One likelihood per hypothesis required")
    for value in likelihoods.values():
        if value is not None:
            ume.number(value)
    empty = {"status": "abstained", "reason": None, "weights": None,
             "evidence_probability": None, "log_evidence_probability": None, "dropped_hypotheses": []}
    if any(value is None for value in likelihoods.values()):
        return {**empty, "reason": "unknown_likelihood"}
    total = math.fsum(weights.values())
    logs = {h: math.log(w / total) + math.log(likelihoods[h])
            for h, w in weights.items() if likelihoods[h] > 0}
    if not logs:
        return {**empty, "reason": "zero_probability_evidence", "evidence_probability": 0.0}
    largest = max(logs.values())
    scale = {h: math.exp(value - largest) for h, value in logs.items()}
    denominator = math.fsum(scale.values())
    posterior = {h: w / denominator for h, w in scale.items()}
    # exp(logsumexp(...)) can exceed one at unit likelihood. A weighted mean
    # of validated likelihoods stays bounded. Scaling first also preserves a
    # representable tiny mixture when its individual products would underflow.
    likelihood_scale = max(likelihoods.values())
    evidence = (math.fsum(w * (likelihoods[h] / likelihood_scale) for h, w in weights.items())
                / total * likelihood_scale)
    if evidence == 0 or any(w == 0 for w in posterior.values()):
        return {**empty, "reason": "numerical_resolution",
                "log_evidence_probability": largest + math.log(denominator)}
    posterior = ume.normalized_weights(posterior)
    return {"status": "updated", "reason": None, "weights": posterior,
            "evidence_probability": evidence, "log_evidence_probability": math.log(evidence),
            "dropped_hypotheses": sorted(set(weights) - set(posterior))}


def answer_field(question_id):
    """Answers are observations of replies, not facts about a latent mental trait."""
    return "answer:" + ume.text(question_id)


def update_profile(profile, model, observation, *, forbidden_answer_ids=()):
    """Condition on one supplied answer, preserve all old facts and assumptions.

An observed answer is appended as its own evidence field across surviving
hypotheses. A hypothesis becoming certain never promotes its authored traits to
observed facts. Counterfactual answers from selection must not enter this API.
"""
    forbidden = ume.identifiers(list(forbidden_answer_ids))
    prior = admitted_profile(profile, forbidden)
    table = likelihood_model(prior, model)
    weights = {h["id"]: h["weight"] for h in prior["hypotheses"]}
    origin = prior["person_provenance"]["kind"]
    base = {"schema_version": 1, "kind": "profile-bayes-update", "executes": False,
            "parent_profile_sha256": prior["profile_sha256"], "likelihood_sha256": ume.fingerprint(model),
            "likelihood_model": deepcopy(model), "observation": deepcopy(observation),
            "prior_weights": weights, "prior_entropy_nats": entropy(weights),
            "posterior_profile": deepcopy(prior), "posterior_entropy_nats": entropy(weights),
            "dropped_hypotheses": [], "evidence_probability": None, "log_evidence_probability": None}
    if observation is None:
        return {**base, "status": "abstained", "reason": "missing_observation"}
    ume.fields(observation, ("id", "person_id", "question_id", "value", "source_answer_ids", "provenance"))
    identity = ume.text(observation["id"])
    ume.require(observation["person_id"] == prior["person_id"] and observation["question_id"] == model["question_id"],
                "Answer belongs to another person or question")
    ume.provenance(observation["provenance"], {origin})
    ancestry = ume.identifiers(observation["source_answer_ids"])
    ume.require(identity in ancestry, "Answer lineage must include its own ID")
    ume.require(not (ancestry & forbidden), "Protected held-out answer cannot condition the profile")
    used_answers = {a for e in prior["evidence"] for a in e["source_answer_ids"]}
    ume.require(not (ancestry & used_answers), "Answer evidence has already conditioned this profile")
    if observation["value"] is None:
        return {**base, "status": "abstained", "reason": "missing_answer"}
    outcome = ume.text(observation["value"])
    ume.require(outcome in model["outcomes"], "Answer outside declared categorical support")
    field = answer_field(model["question_id"])
    ume.require(all(field not in h["traits"] for h in prior["hypotheses"]),
                "Question already recorded; use a new occasion and conditional likelihood model")
    posterior = bayes_weights(weights, {h: row[outcome] for h, row in table.items()})
    base.update({k: v for k, v in posterior.items() if k != "weights"})
    if posterior["status"] != "updated":
        return base
    evidence_id = "profile-answer:" + identity
    ume.require(evidence_id not in prior["evidence_ids"], "Answer evidence ID collision")
    evidence = {"id": evidence_id, "person_id": prior["person_id"], "field": field, "value": outcome,
                "source_answer_ids": sorted(ancestry), "provenance": deepcopy(observation["provenance"])}
    updated = {k: deepcopy(prior[k]) for k in PROFILE_FIELDS}
    updated["evidence_ids"].append(evidence_id)
    updated["hypotheses"] = [h for h in updated["hypotheses"] if h["id"] in posterior["weights"]]
    for hypothesis in updated["hypotheses"]:
        hypothesis["weight"] = posterior["weights"][hypothesis["id"]]
        hypothesis["traits"][field] = {"kind": "observed", "value": outcome, "evidence_ids": [evidence_id]}
    inputs_hash = ume.fingerprint({"prior": prior["profile_sha256"], "likelihood": model, "observation": observation})
    authored = (origin == "authored_fixture" or prior["weight_provenance"]["kind"] == "authored_assumption"
                or model["provenance"]["kind"] == "authored_assumption")
    updated["weight_provenance"] = {
        "kind": "authored_assumption" if authored else "fitted",
        "source": "profile-information-bayes/v1:" + inputs_hash,
    }
    new_profile = ume.prepare_profiles([*prior["evidence"], evidence], [updated], origin=origin,
                                       forbidden_answer_ids=forbidden)[prior["person_id"]]
    base.update(posterior_profile=new_profile, posterior_entropy_nats=entropy(posterior["weights"]))
    return base


def expected_information_gain(profile, model):
    """Enumerate counterfactual answers only; never materialize person evidence."""
    prior = admitted_profile(profile)
    table = likelihood_model(prior, model)
    weights = {h["id"]: h["weight"] for h in prior["hypotheses"]}
    result = {"status": "abstained", "reason": None, "unit": "nat",
              "prior_entropy_nats": entropy(weights), "expected_posterior_entropy_nats": None,
              "information_gain_nats": None, "branches": [], "counterfactual": True,
              "profile_sha256": prior["profile_sha256"], "likelihood_sha256": ume.fingerprint(model)}
    if any(answer_field(model["question_id"]) in h["traits"] for h in prior["hypotheses"]):
        return {**result, "reason": "question_already_recorded"}
    if any(value is None for row in table.values() for value in row.values()):
        return {**result, "reason": "unknown_likelihood"}
    for outcome in sorted(model["outcomes"]):
        update = bayes_weights(weights, {h: row[outcome] for h, row in table.items()})
        if update["status"] == "abstained" and update["reason"] != "zero_probability_evidence":
            return {**result, "reason": update["reason"], "branches": []}
        result["branches"].append({"outcome": outcome, "probability": update["evidence_probability"],
                                    "posterior_weights": update["weights"],
                                    "entropy_nats": entropy(update["weights"]) if update["weights"] else None,
                                    "reason": update["reason"]})
    expected = math.fsum(b["probability"] * b["entropy_nats"] for b in result["branches"] if b["probability"] > 0)
    gain = result["prior_entropy_nats"] - expected
    ume.require(gain >= -TOLERANCE, "Negative expected information beyond floating-point tolerance")
    return {**result, "status": "computed", "expected_posterior_entropy_nats": expected,
            "information_gain_nats": max(0.0, gain)}


def finite_nonnegative(value):
    ume.require(type(value) in (int, float) and math.isfinite(value) and value >= 0,
                "Finite nonnegative amount required")
    return value


def decision_model(profile, decision):
    ume.fields(decision, ("id", "person_id", "profile_sha256", "utility_unit", "actions", "provenance"))
    ume.text(decision["id"])
    ume.text(decision["utility_unit"])
    ume.provenance(decision["provenance"], {"authored_assumption", "fitted"})
    ume.require(decision["person_id"] == profile["person_id"] and decision["profile_sha256"] == profile["profile_sha256"],
                "Decision changed person or conditioning profile")
    actions = decision["actions"]
    ume.require(isinstance(actions, dict) and bool(actions), "Finite nonempty decision actions required")
    hypotheses = {h["id"] for h in profile["hypotheses"]}
    for name, row in actions.items():
        ume.text(name)
        ume.require(isinstance(row, dict) and row.keys() == hypotheses, "Utility row must cover every hypothesis")
        for value in row.values():
            ume.require(type(value) in (int, float) and math.isfinite(value), "Finite utility required; missing utility is not zero")
    return actions


def best_action(weights, actions):
    total = math.fsum(weights.values())
    values = {a: math.fsum(weights[h] / total * row[h] for h in weights) for a, row in actions.items()}
    ume.require(all(math.isfinite(v) for v in values.values()), "Non-finite expected utility")
    chosen = min(values, key=lambda a: (-values[a], a))
    return {"action_id": chosen, "expected_utility": values[chosen], "action_utilities": values}


def select_question(profile, questions, decision, policy):
    """Select a costed question only when it can improve the declared decision.

score = expected utility improvement + utility_per_nat * information gain
        - utility_per_cost_unit * cost.
The no-question option scores zero. No question is asked by this function.
"""
    prior = admitted_profile(profile)
    actions = decision_model(prior, decision)
    ume.fields(policy, ("utility_unit", "cost_unit", "utility_per_nat", "utility_per_cost_unit",
                        "minimum_expected_utility_gain", "provenance"))
    ume.require(policy["utility_unit"] == decision["utility_unit"], "Policy and decision utility units differ")
    ume.text(policy["cost_unit"])
    ume.provenance(policy["provenance"], {"authored_assumption", "fitted"})
    for key in ("utility_per_nat", "utility_per_cost_unit", "minimum_expected_utility_gain"):
        finite_nonnegative(policy[key])
    ume.require(isinstance(questions, list), "Finite question array required")
    weights = {h["id"]: h["weight"] for h in prior["hypotheses"]}
    baseline = best_action(weights, actions)
    results, seen = [], set()
    for question in questions:
        ume.fields(question, ("model", "cost"))
        ume.fields(question["cost"], ("amount", "unit"))
        cost = finite_nonnegative(question["cost"]["amount"])
        ume.require(question["cost"]["unit"] == policy["cost_unit"], "Question cost units differ; explicit conversion required")
        info = expected_information_gain(prior, question["model"])
        identity = question["model"]["question_id"]
        ume.require(identity not in seen, "Duplicate candidate question ID")
        seen.add(identity)
        row = {"question_id": identity, "eligible": False, "reason": info["reason"], "information": info,
               "cost": deepcopy(question["cost"]), "expected_utility_after": None,
               "expected_utility_gain": None, "net_score": None, "utility_unit": decision["utility_unit"]}
        if info["status"] == "computed":
            expected = []
            for branch in info["branches"]:
                if branch["probability"] > 0:
                    branch["decision"] = best_action(branch["posterior_weights"], actions)
                    expected.append(branch["probability"] * branch["decision"]["expected_utility"])
                else:
                    branch["decision"] = None
            after = math.fsum(expected)
            gain = after - baseline["expected_utility"]
            ume.require(gain >= -TOLERANCE * max(1, abs(after), abs(baseline["expected_utility"])),
                        "Negative value of information beyond floating-point tolerance")
            gain = max(0.0, gain)
            information_value = policy["utility_per_nat"] * info["information_gain_nats"]
            cost_value = policy["utility_per_cost_unit"] * cost
            score = math.fsum([gain, information_value, -cost_value])
            ume.require(all(math.isfinite(v) for v in (after, information_value, cost_value, score)),
                        "Non-finite score; rescale explicit utility/cost units")
            # Use a small numeric tolerance so rounding alone cannot justify a question.
            relevant = gain > max(TOLERANCE, policy["minimum_expected_utility_gain"])
            eligible = relevant and score > TOLERANCE
            row.update(expected_utility_after=after, expected_utility_gain=gain, net_score=score,
                       information_value=information_value, cost_value=cost_value, eligible=eligible,
                       reason=None if eligible else "no_decision_value" if not relevant else "cost_exceeds_value")
        results.append(row)
    eligible = sorted((r for r in results if r["eligible"]), key=lambda r: (-r["net_score"], r["question_id"]))
    return {"schema_version": 1, "kind": "profile-question-selection", "executes": False,
            "status": "selected" if eligible else "abstained", "reason": None if eligible else "no_eligible_question",
            "selected_question_id": eligible[0]["question_id"] if eligible else None,
            "baseline_decision": baseline, "utility_unit": decision["utility_unit"],
            "profile_sha256": prior["profile_sha256"], "decision_sha256": ume.fingerprint(decision),
            "policy": deepcopy(policy), "questions_sha256": ume.fingerprint(questions),
            "questions": sorted(results, key=lambda r: r["question_id"]),
            "notice": "Counterfactual model expectations, not observed answers or permission to collect them."}


def authored_fixture():
    """A wholly authored one-person arithmetic fixture using the admitted schema."""
    seed = ume.authored_fixture()
    profile = ume.prepare_profiles(seed["evidence"], seed["profiles"], origin="authored_fixture")["fixture-ada"]
    assumption = {"kind": "authored_assumption", "source": "profile_information.py arithmetic demonstration v1"}
    model = {"schema_version": 1, "id": "fixture-help-likelihood", "revision": "authored-v1",
             "person_id": profile["person_id"], "profile_sha256": profile["profile_sha256"],
             "question_id": "help-choice", "question": "Would you like a clarification or an attempt first?",
             "outcomes": ["clarification", "attempt"],
             "likelihoods": {"ask": {"clarification": .8, "attempt": .2},
                             "try": {"clarification": .2, "attempt": .8}}, "provenance": assumption}
    uninformative = deepcopy(model)
    uninformative.update(id="fixture-uninformative", question_id="irrelevant-question", question="Authored uninformative question")
    uninformative["likelihoods"] = {h: {"clarification": .5, "attempt": .5} for h in ("ask", "try")}
    observation = {"id": "fixture-new-answer", "person_id": profile["person_id"], "question_id": "help-choice",
                   "value": "clarification", "source_answer_ids": ["fixture-new-answer"],
                   "provenance": {"kind": "authored_fixture", "source": "Invented answer, not a person's response"}}
    decision = {"id": "fixture-teaching-move", "person_id": profile["person_id"], "profile_sha256": profile["profile_sha256"],
                "utility_unit": "authored_utility_point", "actions": {"explain": {"ask": 1., "try": 0.},
                "offer_attempt": {"ask": 0., "try": 1.}}, "provenance": assumption}
    policy = {"utility_unit": "authored_utility_point", "cost_unit": "second", "utility_per_nat": .1,
              "utility_per_cost_unit": .01, "minimum_expected_utility_gain": 0., "provenance": assumption}
    return {"notice": "AUTHORED FIXTURE: zero real people, answers, or empirical findings.",
            "update": {"profile": profile, "model": model, "observation": observation, "forbidden_answer_ids": []},
            "selection": {"profile": deepcopy(profile), "questions": [
                {"model": deepcopy(model), "cost": {"amount": 2., "unit": "second"}},
                {"model": uninformative, "cost": {"amount": 0., "unit": "second"}}],
                "decision": decision, "policy": policy}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("fixture", help="Print wholly authored local input examples")
    commands.add_parser("demo", help="Compute authored update and question scores")
    for command in ("update", "select"):
        commands.add_parser(command, help="Consume local JSON only").add_argument("input", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "fixture":
            result = authored_fixture()
        elif args.command == "demo":
            fixture = authored_fixture()
            result = {"notice": fixture["notice"], "update": update_profile(**fixture["update"]),
                      "selection": select_question(**fixture["selection"])}
        else:
            payload = json.loads(args.input.read_text())
            if args.command == "update":
                ume.fields(payload, ("profile", "model", "observation", "forbidden_answer_ids"))
                result = update_profile(**payload)
            else:
                ume.fields(payload, ("profile", "questions", "decision", "policy"))
                result = select_question(**payload)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError, OverflowError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
