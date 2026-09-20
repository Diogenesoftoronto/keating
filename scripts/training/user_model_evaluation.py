# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["numpy==2.2.6", "scikit-learn==1.7.2"]
# ///
"""Offline finite-profile and paired panel measurements; never calls a provider.

The fixture is wholly authored, including its pretend survey answers. JSON
provenance is a caller declaration, not proof of consent or human observation.
"""
import argparse
from collections import defaultdict
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import random


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fields(value, required):
    require(isinstance(value, dict) and set(value) == set(required),
            f"Expected exactly these fields: {', '.join(required)}")


def text(value):
    require(isinstance(value, str) and bool(value.strip()), "Nonempty string required")
    return value


def number(value, low=0, high=1):
    require(type(value) in (int, float) and math.isfinite(value) and low <= value <= high,
            f"Finite number in [{low}, {high}] required")
    return value


def identifiers(values):
    require(isinstance(values, list), "Identifier array required")
    for value in values:
        text(value)
    require(len(values) == len(set(values)), "Duplicate identifiers")
    return set(values)


def fingerprint(value):
    """Local content identity; does not authenticate the source's claims."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def provenance(value, kinds):
    fields(value, ("kind", "source"))
    require(value["kind"] in kinds, "Ineligible provenance kind")
    text(value["source"])


def normalized_weights(weights):
    """Validate positive weights and canonicalize only admitted sum roundoff.

Drop zero-mass hypotheses explicitly before admission. Respondent weights are
positive so every person can participate in a cluster bootstrap denominator.
Mass outside 1 +/- 1e-9 is rejected. Canonical weights have fsum == 1, making
re-admission idempotent; no invalid probability or individual weight is clipped.
"""
    require(isinstance(weights, dict) and bool(weights), "Nonempty weight mapping required")
    for key, value in weights.items():
        text(key)
        number(value)
        require(value > 0, "Weights must be positive; omit zero-mass entries explicitly")
    total = math.fsum(weights.values())
    require(math.isclose(total, 1, rel_tol=0, abs_tol=1e-9),
            "Weights must sum to one")
    if total == 1:
        return dict(weights)
    normalized = {key: value / total for key, value in weights.items()}
    # Assign division roundoff to the largest mass, with a stable tie break.
    # Small positive hypotheses must not vanish to repair a large coordinate.
    anchor = min(normalized, key=lambda key: (-normalized[key], key))
    if math.fsum(normalized.values()) != 1:
        normalized[anchor] += 1 - math.fsum(normalized.values())
    if math.fsum(normalized.values()) != 1:
        normalized[anchor] = math.nextafter(normalized[anchor],
                                            math.inf if math.fsum(normalized.values()) < 1 else 0.)
    require(math.fsum(normalized.values()) == 1 and all(0 < w <= 1 for w in normalized.values()),
            "Weight roundoff could not be normalized without losing positive mass")
    return normalized


def evidence_records(evidence, *, origin, forbidden_answer_ids=()):
    """Validate the entire supplied lineage inventory, independently of selection."""
    require(origin in {"observed", "authored_fixture"}, "Explicit evidence origin required")
    require(isinstance(evidence, list), "Evidence array required")
    forbidden = set(forbidden_answer_ids)
    records = {}
    for item in evidence:
        fields(item, ("id", "person_id", "field", "value", "source_answer_ids", "provenance"))
        identity = text(item["id"])
        require(identity not in records, "Duplicate evidence ID")
        text(item["person_id"])
        text(item["field"])
        require(item["value"] is not None, "Missing evidence stays an unknown profile field")
        fingerprint(item["value"])
        require(not (identifiers(item["source_answer_ids"]) & forbidden),
                "Held-out answer leaked through evidence lineage")
        provenance(item["provenance"], {origin})
        records[identity] = deepcopy(item)
    return records


def prepare_profiles(evidence, profiles, *, origin, forbidden_answer_ids=()):
    """Validate finite alternatives against observed fields, preserving unknowns.

Weights and assumption rationales are supplied, not fitted or inferred here.
Every observed field is identical across hypotheses. Conflicting evidence needs
upstream adjudication; it cannot be silently resolved by an authored assumption.
"""
    require(origin in {"observed", "authored_fixture"}, "Explicit evidence origin required")
    require(isinstance(evidence, list) and isinstance(profiles, list) and bool(profiles),
            "Evidence array and nonempty profiles required")
    records = evidence_records(evidence, origin=origin, forbidden_answer_ids=forbidden_answer_ids)
    result = {}
    for profile in profiles:
        fields(profile, ("person_id", "person_provenance", "evidence_ids", "hypotheses", "weight_provenance"))
        person = text(profile["person_id"])
        require(person not in result, "One ensemble per canonical person required")
        provenance(profile["person_provenance"], {origin})
        provenance(profile["weight_provenance"], {"authored_assumption", "fitted"})
        ids = identifiers(profile["evidence_ids"])
        require(ids <= records.keys(), "Unknown conditioning evidence")
        selected = [records[key] for key in sorted(ids)]
        require(all(item["person_id"] == person for item in selected), "Cross-person conditioning evidence")
        observed = {}
        for item in selected:
            key = item["field"]
            if key in observed:
                require(fingerprint(observed[key]) == fingerprint(item["value"]), "Conflicting observed evidence")
            observed[key] = item["value"]
        hypotheses = profile["hypotheses"]
        require(isinstance(hypotheses, list) and bool(hypotheses), "Finite nonempty hypotheses required")
        weights, trait_names = {}, None
        for hypothesis in hypotheses:
            fields(hypothesis, ("id", "weight", "traits"))
            identity = text(hypothesis["id"])
            require(identity not in weights, "Duplicate hypothesis ID")
            weights[identity] = hypothesis["weight"]
            traits = hypothesis["traits"]
            require(isinstance(traits, dict) and bool(traits), "Explicit profile traits required")
            require(observed.keys() <= traits.keys(), "Observed fields must remain in every hypothesis")
            if trait_names is None:
                trait_names = set(traits)
            require(set(traits) == trait_names, "Every hypothesis must represent the same fields, including unknowns")
            for key, trait in traits.items():
                text(key)
                require(isinstance(trait, dict), "Typed trait required")
                kind = trait.get("kind")
                if kind == "observed":
                    fields(trait, ("kind", "value", "evidence_ids"))
                    refs = identifiers(trait["evidence_ids"])
                    require(bool(refs) and refs <= ids, "Observed trait needs selected evidence")
                    require(all(records[ref]["field"] == key and
                                fingerprint(records[ref]["value"]) == fingerprint(trait["value"]) for ref in refs),
                            "Trait contradicts its evidence")
                elif kind == "unknown":
                    fields(trait, ("kind", "value"))
                    require(trait["value"] is None, "Unknown must retain null")
                elif kind == "authored_assumption":
                    fields(trait, ("kind", "value", "rationale"))
                    require(trait["value"] is not None, "Use unknown for missing values")
                    text(trait["rationale"])
                    fingerprint(trait["value"])
                else:
                    raise ValueError("Unknown trait kind")
                if key in observed:
                    require(kind == "observed" and fingerprint(trait["value"]) == fingerprint(observed[key]),
                            "An assumption cannot replace observed evidence")
        weights = normalized_weights(weights)
        value = {**deepcopy(profile), "evidence": selected}
        for hypothesis in value["hypotheses"]:
            hypothesis["weight"] = weights[hypothesis["id"]]
        value["profile_sha256"] = fingerprint(value)
        value["entropy_nats"] = -math.fsum(w * math.log(w) for w in weights.values())
        result[person] = value
    require(all(item["person_id"] in result for item in records.values()), "Evidence for an unregistered person")
    return result


def profile_mixture(profile, probabilities):
    """Integrate conditional binary probabilities over the finite profile weights."""
    check_profile_snapshot(profile)
    weights = normalized_weights({h["id"]: h["weight"] for h in profile["hypotheses"]})
    require(isinstance(probabilities, dict) and probabilities.keys() == weights.keys(),
            "One conditional probability per hypothesis required")
    # A weighted mean uses the same denominator even at p=0 and p=1. Validate
    # probabilities before arithmetic; clipping a bad model output is forbidden.
    return math.fsum(weights[key] * number(value) for key, value in probabilities.items()) / math.fsum(weights.values())


def check_profile_snapshot(profile):
    """Reject mutation after admission; a checksum still is not source attestation."""
    body = {k: v for k, v in profile.items() if k not in {"profile_sha256", "entropy_nats"}}
    require(profile.get("profile_sha256") == fingerprint(body), "Profile snapshot changed after admission")


def respondent_bootstrap(rows, *, samples=2000, seed=42):
    """Bootstrap unique people uniformly, keeping their original analysis weights.

Each row is one person's already-aggregated value. Recompute the weighted ratio
in each draw. Bounds/count limits match native_pilot's percentile convention;
its situation/family means cannot represent this weighted respondent estimand.
"""
    require(type(samples) is int and 100 <= samples <= 20000, "Bootstrap samples must be 100-20000")
    require(type(seed) is int, "Integer bootstrap seed required")
    require(isinstance(rows, list), "Respondent rows required")
    identities = []
    for row in rows:
        fields(row, ("person_id", "weight", "value"))
        identities.append(text(row["person_id"]))
        require(number(row["weight"]) > 0, "Positive respondent weight required")
        number(row["value"], -1, 1)
    require(len(set(identities)) == len(rows), "Aggregate once per person before resampling")
    ordered = sorted(rows, key=lambda r: r["person_id"])
    result = {"unit": "person", "samples": samples, "seed": seed,
              "method": "percentile_order_statistic_fixed_weights", "interval_95": None,
              "reason": "fewer_than_two_people" if len(rows) < 2 else None}
    if len(rows) < 2:
        return result
    rng = random.Random(seed)
    draws = []
    for _ in range(samples):
        selected = [ordered[rng.randrange(len(ordered))] for _ in ordered]
        draws.append(math.fsum(r["weight"] * r["value"] for r in selected) /
                     math.fsum(r["weight"] for r in selected))
    draws.sort()
    result["interval_95"] = [draws[int((samples - 1) * q)] for q in (.025, .975)]
    return result


def evaluate_answers(profiles, holdout, *, origin, all_evidence, bins=10, samples=2000, seed=42):
    """Score supplied held-out answers; never treats synthetic replies as humans.

Known respondents occur in fit/calibration people; new people occur in neither.
All evaluation targets are excluded from fit/calibration answer IDs and from
conditioning lineage. Exposure is checked against all_evidence, not just the
selected conditioning subset. Person identifiers must resolve identity aliases.
"""
    from observer_probes import calibration_metrics

    require(origin in {"observed", "authored_fixture"}, "Explicit evidence origin required")
    for profile in profiles.values():
        check_profile_snapshot(profile)
        provenance(profile["person_provenance"], {origin})
    fields(holdout, ("fit_person_ids", "calibration_person_ids", "fit_answer_ids",
                     "calibration_answer_ids", "answers", "predictions"))
    fit_people, cal_people = (identifiers(holdout[k]) for k in ("fit_person_ids", "calibration_person_ids"))
    fit_answers, cal_answers = (identifiers(holdout[k]) for k in ("fit_answer_ids", "calibration_answer_ids"))
    require(not (fit_people & cal_people), "Fit and calibration people overlap")
    require(not (fit_answers & cal_answers), "Fit and calibration answers overlap")
    require(type(bins) is int and 1 <= bins <= 100, "Bins must be 1-100")
    require(isinstance(holdout["answers"], list) and isinstance(holdout["predictions"], list), "Answer/prediction arrays required")
    answers = {}
    for answer in holdout["answers"]:
        fields(answer, ("id", "person_id", "value", "provenance"))
        identity = text(answer["id"])
        require(identity not in answers and identity not in fit_answers | cal_answers,
                "Duplicate or previously used evaluation answer")
        require(answer["person_id"] in profiles, "Unregistered answer person")
        require(answer["value"] is None or (type(answer["value"]) is int and answer["value"] in (0, 1)),
                "Actual answer must be binary or null")
        provenance(answer["provenance"], {origin})
        answers[identity] = answer
    targets = set(answers)
    records = evidence_records(all_evidence, origin=origin, forbidden_answer_ids=targets)
    require(all(e["person_id"] in profiles for e in records.values()), "Evidence for an unregistered person")
    for profile in profiles.values():
        require(all(e["id"] in records and fingerprint(e) == fingerprint(records[e["id"]])
                    for e in profile["evidence"]), "Selected evidence missing or changed in full lineage inventory")
    for evidence in records.values():
        ancestry = set(evidence["source_answer_ids"])
        if ancestry & fit_answers:
            require(evidence["person_id"] in fit_people, "Fitting answer reveals an unregistered fitting person")
        if ancestry & cal_answers:
            require(evidence["person_id"] in cal_people, "Calibration answer reveals an unregistered calibration person")
    groups = {"known_respondent": [], "new_person": []}
    used = set()
    for prediction in holdout["predictions"]:
        fields(prediction, ("answer_id", "person_id", "holdout", "profile_sha256", "conditional_probabilities", "provenance"))
        identity, person = prediction["answer_id"], prediction["person_id"]
        require(identity in answers and identity not in used, "Unknown or repeated prediction target")
        used.add(identity)
        require(person == answers[identity]["person_id"], "Cross-person prediction/answer pairing")
        profile = profiles[person]
        require(prediction["profile_sha256"] == profile["profile_sha256"], "Prediction profile/evidence changed")
        expected = "known_respondent" if person in fit_people | cal_people else "new_person"
        require(prediction["holdout"] == expected, "Holdout person leaked or mislabeled")
        provenance(prediction["provenance"], {"authored_fixture" if origin == "authored_fixture" else "simulated"})
        groups[expected].append({"person_id": person, "answer_id": identity,
                                 "actual": answers[identity]["value"],
                                 "probability": profile_mixture(profile, prediction["conditional_probabilities"])})
    require(used == targets, "Every registered target requires one prediction, including unknown answers")
    result = {}
    for name, rows in groups.items():
        scored = [r for r in rows if r["actual"] is not None]
        by_person = defaultdict(list)
        for row in scored:
            by_person[row["person_id"]].append((row["probability"] - row["actual"]) ** 2)
        person_rows = [{"person_id": p, "scored_answers": len(errors), "brier": math.fsum(errors) / len(errors)}
                       for p, errors in sorted(by_person.items())]
        metrics = calibration_metrics([r["actual"] for r in scored], [r["probability"] for r in scored], bins) if scored else None
        bootstrap = respondent_bootstrap([{"person_id": r["person_id"], "weight": 1 / len(person_rows), "value": r["brier"]}
                                          for r in person_rows], samples=samples, seed=seed)
        result[name] = {"prediction_count": len(rows), "person_count": len({r["person_id"] for r in rows}),
                        "scored_person_count": len(person_rows), "unknown_answer_count": len(rows) - len(scored),
                        "actual_respondent_count": len(person_rows) if origin == "observed" else 0,
                        "answer_weighted_metrics": metrics,
                        "person_mean_brier": math.fsum(r["brier"] for r in person_rows) / len(person_rows) if person_rows else None,
                        "person_brier_bootstrap": bootstrap, "per_person": person_rows, "predictions": rows}
    return result


def paired_panel(profiles, panel, *, origin, samples=2000, seed=42):
    """Weighted B-minus-A effect of supplied simulations, conditional on evidence.

Each hypothesis/replicate must have both arms with the same frozen profile and
simulation contract. Average repetitions within hypothesis, mix hypotheses,
then weight people. Missing outcomes remain unknown; no success imputation.
"""
    require(origin in {"observed", "authored_fixture"}, "Explicit evidence origin required")
    for profile in profiles.values():
        check_profile_snapshot(profile)
        provenance(profile["person_provenance"], {origin})
    fields(panel, ("respondent_weights", "conditions", "simulation_manifest", "continuations"))
    weights = normalized_weights(panel["respondent_weights"])
    require(weights.keys() <= profiles.keys(), "Unknown panel respondent")
    fields(panel["conditions"], ("A", "B"))
    for value in panel["conditions"].values():
        fields(value, ("id", "description"))
        text(value["id"])
        text(value["description"])
    require(panel["conditions"]["A"]["id"] != panel["conditions"]["B"]["id"], "Distinct condition IDs required")
    manifest = panel["simulation_manifest"]
    fields(manifest, ("model_revision", "sampling", "outcome_definition", "evaluator_revision"))
    for key in ("model_revision", "outcome_definition", "evaluator_revision"):
        text(manifest[key])
    require(isinstance(manifest["sampling"], dict) and bool(manifest["sampling"]), "Explicit sampling settings required")
    manifest_hash = fingerprint(manifest)
    require(isinstance(panel["continuations"], list), "Continuation array required")
    pairs, seen = defaultdict(dict), set()
    counts, missing = {"A": 0, "B": 0}, {"A": 0, "B": 0}
    for row in panel["continuations"]:
        fields(row, ("id", "person_id", "hypothesis_id", "replicate_id", "arm", "profile_sha256",
                     "condition_sha256", "simulation_sha256", "value", "provenance"))
        identity, person, arm = text(row["id"]), row["person_id"], row["arm"]
        require(identity not in seen, "Duplicate continuation ID")
        seen.add(identity)
        require(person in weights and arm in counts, "Unknown panel person or condition")
        profile = profiles[person]
        require(row["profile_sha256"] == profile["profile_sha256"], "A/B changed person, profile weights, assumptions or evidence")
        require(row["hypothesis_id"] in {h["id"] for h in profile["hypotheses"]}, "Unknown hypothesis")
        require(row["condition_sha256"] == fingerprint(panel["conditions"][arm]), "Condition changed")
        require(row["simulation_sha256"] == manifest_hash, "Simulator/sampling/evaluator contract changed")
        provenance(row["provenance"], {"authored_fixture" if origin == "authored_fixture" else "simulated"})
        if row["value"] is not None:
            number(row["value"])
        else:
            missing[arm] += 1
        key = (person, row["hypothesis_id"], text(row["replicate_id"]))
        require(arm not in pairs[key], "Duplicate person/profile/replicate arm")
        pairs[key][arm] = row["value"]
        counts[arm] += 1
    require(all(set(pair) == {"A", "B"} for pair in pairs.values()), "Unpaired continuation; record a missing outcome as null")
    people = []
    for person, weight in sorted(weights.items()):
        profile = profiles[person]
        means = {"A": {}, "B": {}}
        unknown = {"A": False, "B": False}
        for hypothesis in profile["hypotheses"]:
            selected = [pair for (p, h, _), pair in pairs.items() if p == person and h == hypothesis["id"]]
            require(bool(selected), "Every respondent hypothesis needs paired continuations")
            for arm in means:
                if any(pair[arm] is None for pair in selected):
                    unknown[arm] = True
                else:
                    means[arm][hypothesis["id"]] = math.fsum(pair[arm] for pair in selected) / len(selected)
        a, b = (None if unknown[arm] else profile_mixture(profile, means[arm]) for arm in ("A", "B"))
        people.append({"person_id": person, "weight": weight, "A": a, "B": b,
                       "delta": b - a if a is not None and b is not None else None})
    available = [p for p in people if p["delta"] is not None]
    available_weight = math.fsum(p["weight"] for p in available)
    effect = math.fsum(p["weight"] * p["delta"] for p in available) / available_weight if available else None
    return {"estimand": "synthetic_weighted_B_minus_A", "respondent_count": len(people),
            "real_respondent_count": len(people) if origin == "observed" else 0,
            "authored_person_count": len(people) if origin == "authored_fixture" else 0,
            "continuation_count": len(seen), "continuation_counts_by_arm": counts,
            "missing_outcomes_by_arm": missing, "available_paired_respondents": len(available),
            "available_respondent_weight": available_weight,
            "weighting_ess": 1 / math.fsum(w * w for w in weights.values()),
            "available_weighting_ess": available_weight ** 2 / math.fsum(p["weight"] ** 2 for p in available) if available else None,
            "full_panel_effect": effect if len(available) == len(people) else None,
            "available_pair_effect": effect, "per_respondent": people,
            "bootstrap": respondent_bootstrap([{"person_id": p["person_id"], "weight": p["weight"], "value": p["delta"]}
                                                for p in available], samples=samples, seed=seed),
            "interpretation": "Conditional simulation estimate; not a human causal effect or population coverage claim. "
                              "Bootstrap conditions on these profiles and continuations; it excludes simulator bias and within-person simulation uncertainty."}


def evaluate(bundle, *, bins=10, samples=2000, seed=42):
    fields(bundle, ("schema_version", "kind", "mode", "provenance", "evidence", "profiles", "holdout", "panel"))
    require(type(bundle["schema_version"]) is int and bundle["schema_version"] == 1 and
            bundle["kind"] == "user-model-evaluation", "Unsupported evaluation schema")
    require(bundle["mode"] in {"authored_fixture", "observed_panel"}, "Explicit data mode required")
    origin = "authored_fixture" if bundle["mode"] == "authored_fixture" else "observed"
    provenance(bundle["provenance"], {origin})
    fields(bundle["holdout"], ("fit_person_ids", "calibration_person_ids", "fit_answer_ids",
                               "calibration_answer_ids", "answers", "predictions"))
    require(isinstance(bundle["holdout"]["answers"], list), "Answer array required")
    targets = [a["id"] for a in bundle["holdout"]["answers"]]
    profiles = prepare_profiles(bundle["evidence"], bundle["profiles"], origin=origin, forbidden_answer_ids=targets)
    return {"schema_version": 1, "kind": "user-model-evaluation-report", "mode": bundle["mode"],
            "provenance": deepcopy(bundle["provenance"]), "input_sha256": fingerprint(bundle),
            "notice": "AUTHORED FIXTURE: no human data or empirical findings." if origin == "authored_fixture" else
                      "Source-declared observed evidence; this tool does not verify consent, identity or provenance truth.",
            "profiles": profiles,
            "holdouts": evaluate_answers(profiles, bundle["holdout"], origin=origin, all_evidence=bundle["evidence"],
                                         bins=bins, samples=samples, seed=seed),
            "panel": paired_panel(profiles, bundle["panel"], origin=origin, samples=samples, seed=seed)}


def authored_fixture():
    """Entirely invented arithmetic example. Even the 'answers' are not human data."""
    authored = {"kind": "authored_fixture", "source": "user_model_evaluation.py authored demonstration v1"}
    assumption = {"kind": "authored_assumption", "source": "Illustrative weights, not calibrated to respondents"}
    bundle = {"schema_version": 1, "kind": "user-model-evaluation", "mode": "authored_fixture",
              "provenance": authored, "evidence": [], "profiles": [],
              "holdout": {"fit_person_ids": ["fixture-ada"], "calibration_person_ids": ["fixture-ben"],
                          "fit_answer_ids": ["fixture-fit-answer"], "calibration_answer_ids": ["fixture-cal-answer"],
                          "answers": [], "predictions": []},
              "panel": {"respondent_weights": {"fixture-ada": .5, "fixture-ben": .3, "fixture-cy": .2},
                        "conditions": {"A": {"id": "explanation", "description": "Product explanation"},
                                       "B": {"id": "walkthrough", "description": "Interactive walkthrough"}},
                        "simulation_manifest": {"model_revision": "none-authored", "sampling": {"method": "authored_values"},
                                                "outcome_definition": "Authored binary product-purpose check", "evaluator_revision": "none-authored"},
                        "continuations": []}}
    for person in bundle["panel"]["respondent_weights"]:
        evidence_id = person + "-preference"
        bundle["evidence"].append({"id": evidence_id, "person_id": person, "field": "preferred_format", "value": "brief",
                                   "source_answer_ids": [person + "-initial-answer"], "provenance": authored})
        bundle["profiles"].append({"person_id": person, "person_provenance": authored, "evidence_ids": [evidence_id],
                                   "weight_provenance": assumption,
                                   "hypotheses": [{"id": h, "weight": w, "traits": {
                                       "preferred_format": {"kind": "observed", "value": "brief", "evidence_ids": [evidence_id]},
                                       "confidence": {"kind": "unknown", "value": None},
                                       "next_move": {"kind": "authored_assumption", "value": h,
                                                     "rationale": "Unobserved behavior hypothesis for this arithmetic demonstration"}}}
                                                  for h, w in (("ask", .6), ("try", .4))]})
    profiles = prepare_profiles(bundle["evidence"], bundle["profiles"], origin="authored_fixture")
    for person, actual in (("fixture-ada", 1), ("fixture-ben", 0), ("fixture-cy", 1), ("fixture-cy", None)):
        identity = f"fixture-target-{len(bundle['holdout']['answers'])}"
        bundle["holdout"]["answers"].append({"id": identity, "person_id": person, "value": actual, "provenance": authored})
        bundle["holdout"]["predictions"].append({"answer_id": identity, "person_id": person,
            "holdout": "new_person" if person == "fixture-cy" else "known_respondent",
            "profile_sha256": profiles[person]["profile_sha256"], "conditional_probabilities": {"ask": .25, "try": .75},
            "provenance": authored})
    for index, person in enumerate(profiles):
        for hypothesis in ("ask", "try"):
            for replicate in range(2):
                for arm in ("A", "B"):
                    # All numbers are authored. Pairing is an experiment index,
                    # not a claim that an identical random stream was executed.
                    value = int((arm == "B" and index != 1) or (arm == "A" and index == 1))
                    bundle["panel"]["continuations"].append({"id": f"{person}-{hypothesis}-{replicate}-{arm}",
                        "person_id": person, "hypothesis_id": hypothesis, "replicate_id": str(replicate), "arm": arm,
                        "profile_sha256": profiles[person]["profile_sha256"],
                        "condition_sha256": fingerprint(bundle["panel"]["conditions"][arm]),
                        "simulation_sha256": fingerprint(bundle["panel"]["simulation_manifest"]),
                        "value": value, "provenance": authored})
    # JSON round-trip also detaches repeated provenance dictionaries. Editing one
    # fixture row in a notebook must not rewrite the provenance of other rows.
    return json.loads(json.dumps(bundle))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("fixture", help="Print authored input JSON; contains no human records")
    demo = commands.add_parser("demo", help="Evaluate the authored fixture only")
    run = commands.add_parser("evaluate", help="Evaluate local JSON; never generates responses")
    run.add_argument("input", type=Path)
    for command in (demo, run):
        command.add_argument("--bins", type=int, default=10)
        command.add_argument("--samples", type=int, default=2000)
        command.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)
    try:
        if args.command == "fixture":
            result = authored_fixture()
        else:
            bundle = authored_fixture() if args.command == "demo" else json.loads(args.input.read_text())
            result = evaluate(bundle, bins=args.bins, samples=args.samples, seed=args.seed)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
