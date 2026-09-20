# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["numpy==2.2.6", "scikit-learn==1.7.2", "matplotlib==3.10.8"]
# ///
"""Local, sealed four-layer source-readout analysis. No model loads or providers.

Declare the analysis before reading results, then revalidate the original worker
archive and join labels locally. All output paths must be new and Git-ignored.
"""
import argparse
from collections import Counter
from copy import deepcopy
import hashlib
from importlib.metadata import version
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

import observer_core as core
import observer_experiment as experiment
import observer_experiment_job as worker
import observer_probes as probes

require = experiment.require
LAYERS = [8, 12, 20, 28]
POOLINGS = list(experiment.POOLINGS[:2])
PARTITIONS = {'train': 26, 'calibration': 4, 'test': 10}
CLASSES = {'train': {'0': 16, '1': 10}, 'calibration': {'0': 3, '1': 1}, 'test': {'0': 8, '1': 2}}
SELECTION_SEED = 'mathdial-four-layer-readout-feasibility-v1'
SOFTWARE = {'numpy': '2.2.6', 'scikit-learn': '1.7.2', 'matplotlib': '3.10.8'}
ANALYSIS_NAMES = (*worker.SOURCE_NAMES, 'observer_probes.py', 'observer_experiment_report.py')
RECIPE = {
    'classifier': 'L2 logistic liblinear', 'C_grid': [.1, 1., 10., 100.],
    'selection': 'minimum mean train-only three-fold validation log loss; smaller C breaks ties',
    'fold_policy': 'known train labels stratified, group hash order then round robin; same folds for every representation',
    'seed': 73, 'max_iter': 3000, 'class_weight': None,
    'text': 'char_wb TF-IDF ngrams 3-5 max_features 20000; entire allowed delivered view',
    'raw': 'StandardScaler fitted within each train fold',
    'sae': 'MaxAbsScaler fitted within each train fold',
    'calibration': 'secondary sigmoid logistic C=1 lbfgs, four calibration families only',
    'primary_metric': 'uncalibrated test Brier; report every layer/pooling without choosing a winner',
    'threshold': .5, 'bootstrap_repetitions': 1000,
    'test_used_for_selection': False, 'model_selection_status': 'exploratory previously inspected test families',
}
LIMITATIONS = [
    'Exploratory 40-family mechanics study: train 26, calibration 4 (one positive), test 10 (two positives).',
    'The source target is a published human teacher move tag; MathDial students were simulated LLMs.',
    'Test families were previously inspected. No confirmatory layer selection or independent holdout claim.',
    'Calibration and bootstrap intervals are unstable with these few families; uncalibrated scores are primary.',
    'Source classification does not establish reward validity, causal behavior, native-task quality or human learning.',
    'Admission is the sealed preparation-time closure audit, not a fresh population or person-identity audit.',
]


def parse_json(body):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, 'Duplicate JSON key')
            value[key] = item
        return value
    value = json.loads(body, object_pairs_hook=pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
    core.canonical(value)
    return value


def read_json(path):
    return parse_json(worker.regular_bytes(Path(path)))


def analysis_hashes():
    return {name: hashlib.sha256(worker.regular_bytes(Path(__file__).with_name(name))).hexdigest()
            for name in ANALYSIS_NAMES}


def validate_sources(documents):
    """Recheck the sealed census, full closure, original labels and temporal views."""
    plan, job, join = (documents[n] for n in ('plan.json', 'helper/job.json', 'helper/join.local.json'))
    selection, proof, admission = (documents[n] for n in ('selection.json', 'source-proof.local.json', 'source-admission.json'))
    records = documents['source-records.local.json']['records']
    experiment.validate_plan(plan); worker.validate_job(job)
    for value, field in ((selection, 'selection_sha256'), (proof, 'source_proof_sha256'), (admission, 'admission_sha256')):
        worker.check_seal(value, field)
    uploaded, actual_join = worker.project_experiment_input(plan, records)
    require(uploaded == job['experiment'] and actual_join == join and join['join_sha256'] == job['join_sha256'],
            'Source projection/local label join changed')
    require(job['source_plan_sha256'] == plan['plan_sha256'], 'Source plan mismatch')
    worker.validate_preflight(job, documents['preflight.json'])
    config, families = plan['config'], plan['split_manifest']['families']
    require(config['mode'] == 'readout' and config['seeds'] == [42] and config['poolings'] == POOLINGS
            and [l['layer'] for l in config['observer']['layers']] == LAYERS and plan['trial_count'] == 160,
            'Expected exact four-layer two-pooling readout matrix')
    require(len(records) == 40 and len(families) == len(join['families']) == proof['complete_assigned_family_count'] == 334,
            'Expected complete 334-family closure and 40 selected records')
    require(admission['registry_default'] == 'deny' and admission['matches_frozen_family_audit'] is True
            and admission['full_closure_group_count'] == 1606 and admission['person_holdout_established'] is False,
            'Frozen full-source admission audit mismatch')
    split = plan['split_manifest']
    require(split['admission_sha256'] == proof['admission_sha256'] == admission['admission_sha256']
            and selection['source_proof_sha256'] == proof['source_proof_sha256']
            and split['selection_sha256'] == config['selection_sha256'] == selection['selection_sha256']
            and split['source_manifest_sha256'] == admission['source_manifest_file_sha256'] == selection['source_manifest_file_sha256']
            and split['source_family_audit_canonical_sha256'] == admission['artifact_canonical_sha256']['family-audit.json']
            and split['source_split_artifact_canonical_sha256'] == admission['artifact_canonical_sha256']['splits.json'],
            'Admission/selection/source bindings changed')
    require(split['partition_policy'] == 'authored_source_probe_split_not_published_holdout', 'Authored source partition policy required')
    all_families, all_ids = selection['all_200_family_ids'], selection['all_200_record_ids']
    require(len(all_ids) == len(set(all_ids)) == len(all_families) == len(set(all_families)) == 200
            and set(all_families) <= set(families) and proof['all_records_matched'] == proof['source_family_count'] == 200
            and proof['new_or_synthetic_labels'] == 0, 'Original 200-family census changed')
    require(selection['all_200_family_set_sha256'] == core.digest(sorted(all_families)), 'Original family set hash changed')
    policy = selection['policy']
    require(policy['seed'] == SELECTION_SEED and policy['selected_count'] == 40
            and policy['from_existing_frozen_200_only'] is True and policy['labels_used_for_selection'] is False
            and policy['reselection'] is False and policy['split_assignments_unchanged'] is True
            and selection['heldout_26_families_selected'] == 0, 'Accepted selection policy changed')
    ordered = sorted(zip(all_families, all_ids), key=lambda x: (hashlib.sha256((SELECTION_SEED+'\0'+x[0]).encode()).hexdigest(), x[0]))[:40]
    require(selection['selected_family_ids'] == [f for f, _ in ordered]
            and selection['selected_record_ids'] == [r for _, r in ordered]
            and selection['selected_family_set_sha256'] == core.digest(sorted(f for f, _ in ordered))
            and [r['record_id'] for r in records] == selection['selected_record_ids'], 'Label-blind selection/order changed')
    # Include unselected relatives: filtering to the 40 first could hide a cross-split bridge.
    closure = probes.split_groups([{'record_id': f, 'family_id': f, **v} for f, v in families.items()])
    by_id = {r['record_id']: r for r in proof['records']}
    require(len(by_id) == len(proof['records']) == 200 and set(by_id) == set(all_ids), 'Source-proof census mismatch')
    for family, rid in zip(all_families, all_ids):
        require(by_id[rid]['family_id'] == family and all(by_id[rid][k] == families[family][k] for k in ('split', 'group_ids')),
                'Unselected source family/partition changed')
    target = plan['concept_card']['target']
    require(target == 'move.probing' and plan['concept_card']['boundary'] == 'delivered', 'Exact source teacher-move target required')
    counts = {s: Counter() for s in PARTITIONS}
    selected_groups = []
    for record in records:
        rid = record['record_id']; view = core.boundary_view(record); evidence = by_id[rid]
        require(core.digest(record) == evidence['original_record_sha256'] == plan['source_record_sha256'][rid]
                and core.digest(view) == evidence['view_sha256']
                and view['latest_allowed_event_id'] == evidence['latest_allowed_event_id'], 'Source hash/temporal proof mismatch')
        label = record.get('labels', {}).get(target)
        require(type(label) is int and label in (0, 1), 'Unknown labels remain unknown; frozen all-known cohort required for this report')
        origin = record['label_provenance'][target]; annotation = origin['target']
        require(origin['origin'] == annotation['origin'] == evidence['label_origin'] == 'source_teacher_move_tag'
                and origin['example_sha256'] == evidence['source_example_sha256']
                and annotation['boundary'] == 'delivered' and annotation['value'] in ('probing', 'focus', 'generic', 'telling')
                and label == int(annotation['value'] == 'probing'), 'Source tag/origin mismatch; do not infer pedagogical success')
        require(record['split'] in PARTITIONS and annotation['fit_mask'] is (record['split'] == 'train')
                and annotation['evaluation_mask'] is (record['split'] != 'train'), 'Source fit/evaluation masks changed')
        selected_groups.append(closure['rows'][record['family_id']]['group'])
        counts[record['split']][str(label)] += 1
    require(len(set(selected_groups)) == 40, 'Selected records must be 40 independent connected source groups')
    require({s: sum(c.values()) for s,c in counts.items()} == selection['partition_counts'] == PARTITIONS
            and {s: dict(c) for s,c in counts.items()} == selection['class_counts_post_selection'] == CLASSES,
            'Frozen 26/4/10 partition/known-label counts changed')
    return {'documents': documents, 'records': records, 'closure': closure, 'job': job, 'join': join,
            'source_plan': plan, 'target': target}


def load_prepared(directory, expected_manifest):
    directory = Path(directory).resolve()
    manifest = read_json(directory / 'FILES.json')
    worker.check_seal(manifest, 'manifest_sha256')
    require(manifest['manifest_sha256'] == expected_manifest, 'Preparation file-manifest pin mismatch')
    documents = {}
    for name, spec in manifest['files'].items():
        relative = PurePosixPath(name)
        require(not relative.is_absolute() and '..' not in relative.parts, 'Unsafe prepared member')
        path = directory / name
        require(path.resolve().is_relative_to(directory) and not path.is_symlink(), 'Unsafe prepared file path')
        body = worker.regular_bytes(path)
        require(len(body) == spec['bytes'] and hashlib.sha256(body).hexdigest() == spec['sha256'], 'Prepared file bytes changed: '+name)
        if name.endswith('.json'): documents[name] = parse_json(body)
    result = validate_sources(documents)
    result.update(directory=directory, files_manifest_sha256=expected_manifest)
    return result


def declare_protocol(context):
    # Only known training labels enter fold assignment, and all modes share it.
    train = [r for r in context['records'] if r['split'] == 'train']
    folds = [[], [], []]
    for label in (0, 1):
        ordered = sorted((r for r in train if r['labels'][context['target']] == label),
                         key=lambda r: (core.digest([RECIPE['seed'], context['closure']['rows'][r['family_id']]['group']]), r['record_id']))
        for i, row in enumerate(ordered): folds[i % 3].append(row['record_id'])
    return worker.seal({'schema_version': 1, 'kind': 'four-layer-source-readout-analysis/v1',
        'files_manifest_sha256': context['files_manifest_sha256'], 'job_sha256': context['job']['job_sha256'],
        'source_plan_sha256': context['source_plan']['plan_sha256'], 'join_sha256': context['join']['join_sha256'],
        'analysis_files_sha256': analysis_hashes(), 'software': SOFTWARE, 'recipe': deepcopy(RECIPE),
        'validation_folds': [sorted(f) for f in folds], 'partition_counts': PARTITIONS, 'class_counts': CLASSES,
        'source_family_count': 334, 'original_selection_count': 200, 'selected_count': 40,
        'layers': LAYERS, 'poolings': POOLINGS, 'expected_trials': 160, 'expected_measurements': 320,
        'limitations': LIMITATIONS}, 'protocol_sha256')


def validate_archive(context, body):
    imported = worker.import_outputs(context['job'], context['join'], body)
    # The existing importer validates the complete remote preflight internally.
    # Additionally bind its actual token IDs/offsets to the earlier CPU preflight.
    with tarfile.open(fileobj=io.BytesIO(body), mode='r:') as archive:
        member = next((m for m in archive if m.name == 'preflight.json'), None)
        remote_flight = parse_json(archive.extractfile(member).read()) if member else None
    if remote_flight is not None:
        require(remote_flight == context['documents']['preflight.json'], 'Remote tokenizer preflight differs from sealed local tokens')
    require(imported['complete'] is True and imported['fit_eligible'] is True,
            f"Incomplete archive: {imported['validated_completed_trials']}/160 trials; preserve partial evidence, no fitting")
    result = imported['result']; records = {r['record_id']: r for r in context['records']}
    matrices = {(n, p): [] for n in LAYERS for p in POOLINGS}
    seen = set()
    for trial in result['rows']:
        local = context['join']['records'][trial['record_id']]; source = records[local['record_id']]
        for measure in trial['measurements']:
            key = (trial['layer'], measure['pooling'], source['record_id'])
            require(key not in seen, 'Duplicate layer/pooling/source measurement'); seen.add(key)
            matrices[key[:2]].append({k: deepcopy(source[k]) for k in ('record_id', 'family_id', 'group_ids', 'split', 'labels', 'label_provenance')} |
                {'text': core.boundary_view(source)['text'], 'raw': measure['raw'], 'sae': measure['sae'], 'sae_width': 65536})
    require(len(result['rows']) == 160 and len(seen) == 320 and all(len(v) == 40 for v in matrices.values()),
            'Expected complete 40 x 4 x 2 coverage')
    for rows in matrices.values(): rows.sort(key=lambda r: r['record_id'])
    return imported, matrices


def preprocessor(mode):
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.preprocessing import StandardScaler, MaxAbsScaler
    return TfidfVectorizer(analyzer='char_wb', ngram_range=(3,5), max_features=20000) if mode == 'text' else StandardScaler() if mode == 'raw' else MaxAbsScaler()


def fit_one(rows, mode, target, protocol):
    """Train-only preprocessing/C selection; cal/test never enter fitting or CV."""
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import log_loss
    from scipy.special import expit
    parts = {s: [r for r in rows if r['split'] == s] for s in PARTITIONS}
    train, cal, test = (parts[s] for s in PARTITIONS)
    labels = lambda rs: np.asarray([r['labels'][target] for r in rs])
    matrix = lambda rs: probes.feature_matrix(rs, mode, width=65536)
    train_ids = {r['record_id'] for r in train}
    folds = protocol['validation_folds']
    require(len(folds) == 3 and len([r for f in folds for r in f]) == len(train_ids)
            and set(r for f in folds for r in f) == train_ids, 'Training-only fold coverage mismatch')
    def classifier(c):
        return LogisticRegression(C=c, penalty='l2', solver='liblinear', max_iter=RECIPE['max_iter'], random_state=RECIPE['seed'])
    def fitted(c, x, y):
        model = classifier(c).fit(x, y)
        require(int(model.n_iter_.max()) < RECIPE['max_iter'], 'Classifier failed to converge')
        return model
    cv = {c: [] for c in RECIPE['C_grid']}
    for heldout in folds:
        fit_rows = [r for r in train if r['record_id'] not in heldout]
        val_rows = [r for r in train if r['record_id'] in heldout]
        require(len(set(labels(fit_rows))) == len(set(labels(val_rows))) == 2, 'Both train/CV classes required; do not reselect')
        transformer = preprocessor(mode)
        x_fit = transformer.fit_transform(matrix(fit_rows)); x_val = transformer.transform(matrix(val_rows))
        for c in cv:
            model = fitted(c, x_fit, labels(fit_rows))
            cv[c].append(float(log_loss(labels(val_rows), model.predict_proba(x_val)[:,1], labels=[0,1])))
    chosen = min(cv, key=lambda c: (sum(cv[c])/len(cv[c]), c))
    transformer = preprocessor(mode); x_train = transformer.fit_transform(matrix(train))
    x_cal, x_test = transformer.transform(matrix(cal)), transformer.transform(matrix(test))
    model = fitted(chosen, x_train, labels(train))
    require(len(set(labels(cal))) == 2, 'Calibration requires both known classes; preserve missingness')
    calibrator = LogisticRegression(C=1., solver='lbfgs', max_iter=1000, random_state=RECIPE['seed']).fit(
        model.decision_function(x_cal).reshape(-1,1), labels(cal))
    require(int(calibrator.n_iter_.max()) < 1000, 'Calibrator failed to converge')
    uncalibrated = model.predict_proba(x_test)[:,1]
    calibrated = calibrator.predict_proba(model.decision_function(x_test).reshape(-1,1))[:,1]
    state = ({'vocabulary': {k: int(v) for k,v in transformer.vocabulary_.items()}, 'idf': transformer.idf_.tolist(),
              'analyzer': 'char_wb', 'ngram_range': [3,5]} if mode == 'text' else
             {'scale': transformer.scale_.tolist(), 'mean': transformer.mean_.tolist() if mode == 'raw' else None})
    export = {'preprocessing': state, 'coefficients': model.coef_[0].tolist(), 'intercept': float(model.intercept_[0]),
        'classes': [0,1], 'calibration_coefficient': float(calibrator.coef_[0,0]),
        'calibration_intercept': float(calibrator.intercept_[0]), 'threshold': .5}
    require(np.allclose(probes.predict_probe(export, test, mode, width=65536), calibrated, rtol=1e-10, atol=1e-10),
            'JSON coefficient reload predictions differ')
    groups = [r['family_id'] for r in test]  # validate_sources proved all 40 have distinct connected groups.
    return {'mode': mode, 'selected_C': chosen, 'cv': [{'C': c, 'fold_log_loss': v, 'mean_log_loss': sum(v)/len(v)} for c,v in cv.items()],
        'uncalibrated_test': probes.calibration_metrics(labels(test), uncalibrated),
        'calibrated_test': probes.calibration_metrics(labels(test), calibrated),
        'uncalibrated_brier_bootstrap': probes.bootstrap_brier(labels(test), uncalibrated, groups, seed=RECIPE['seed'], repetitions=RECIPE['bootstrap_repetitions']),
        'calibrated_brier_bootstrap': probes.bootstrap_brier(labels(test), calibrated, groups, seed=RECIPE['seed'], repetitions=RECIPE['bootstrap_repetitions']),
        'predictions': [{'record_id': r['record_id'], 'family_id': r['family_id'], 'label': int(y), 'uncalibrated': float(u), 'calibrated': float(p)}
                        for r,y,u,p in zip(test, labels(test), uncalibrated, calibrated)],
        'nonzero_coefficients': int(np.count_nonzero(model.coef_)), 'model': export}


def build_report(context, protocol, body):
    worker.check_seal(protocol, 'protocol_sha256')
    require(protocol == declare_protocol(context), 'Sealed analysis protocol/code changed')
    require({p: version(p) for p in SOFTWARE} == SOFTWARE, 'Use pinned analysis dependencies')
    imported, matrices = validate_archive(context, body)
    sample = matrices[(LAYERS[0], POOLINGS[0])]
    runs = {'text': fit_one(sample, 'text', context['target'], protocol)}
    for (layer, pooling), rows in matrices.items():
        for mode in ('raw', 'sae'):
            runs[f'{mode}/{layer}/{pooling}'] = fit_one(rows, mode, context['target'], protocol) | {'layer': layer, 'pooling': pooling}
    train = [r for r in sample if r['split'] == 'train']; test = [r for r in sample if r['split'] == 'test']
    prior = sum(r['labels'][context['target']] for r in train)/len(train)
    constant = probes.calibration_metrics([r['labels'][context['target']] for r in test], [prior]*len(test))
    return worker.seal({'schema_version': 1, 'kind': 'exploratory-source-readout-comparison',
        'protocol': protocol, 'archive_sha256': imported['archive_sha256'], 'result_sha256': imported['result']['result_sha256'],
        'local_joined_sha256': imported['local_join']['local_joined_sha256'], 'complete': True,
        'coverage': {'records': 40, 'layers': LAYERS, 'poolings': POOLINGS, 'trials': 160, 'measurements': 320,
                     'original_families': 200, 'closure_families': 334, 'partitions': PARTITIONS, 'known_labels': CLASSES},
        'concept_card': context['source_plan']['concept_card'], 'observer_manifests': imported['result']['observer_manifests'],
        'source_family_manifest': context['source_plan']['split_manifest'],
        'source_label_provenance': {r['record_id']: r['label_provenance'] for r in context['records']},
        'runs': runs, 'train_prior_constant': {'positive_probability': prior, 'test': constant},
        'claims': {'source_classification': 'exploratory measured readout only', 'causal_behavior_effect': None,
                   'reward_validity': None, 'native_task_quality': None, 'human_learning': None},
        'limitations': LIMITATIONS}, 'report_sha256')


def ignored_new_path(value, prepared):
    path = Path(value).absolute()
    require(not path.exists() and not path.is_symlink() and not path.resolve().is_relative_to(Path(prepared).resolve()),
            'Output must be new and outside frozen preparation')
    root = Path(__file__).resolve().parents[2]
    require(path.resolve().is_relative_to(root / '.keating'), 'Explicit .keating output required')
    check = subprocess.run(['git', 'check-ignore', '-q', '--', str(path)], cwd=root, capture_output=True)
    require(check.returncode == 0, 'Output must be Git-ignored')
    return path


def write_report(directory, report):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    directory.mkdir(parents=True, mode=0o700, exist_ok=False)
    worker.write_bounded(directory / 'report.json', report)
    lines = ['# Exploratory four-layer source readout', '', *LIMITATIONS, '',
             '| Readout | C | Uncalibrated Brier | Calibrated Brier |', '|---|---:|---:|---:|']
    for name, value in report['runs'].items():
        lines.append(f"| {name} | {value['selected_C']:g} | {value['uncalibrated_test']['brier']:.5f} | {value['calibrated_test']['brier']:.5f} |")
    lines.extend(['', f"Train-prior constant test Brier: {report['train_prior_constant']['test']['brier']:.5f}", '',
                  'Every candidate is shown. No best layer is promoted from these test scores.', '',
                  '![Uncalibrated and secondary calibrated Brier](brier.png)', '',
                  f"Report seal: `{report['report_sha256']}`"])
    (directory / 'report.md').write_text('\n'.join(lines)+'\n'); (directory / 'report.md').chmod(0o600)
    with plt.rc_context({'svg.hashsalt': 'keating-four-layer-readout-v1', 'font.size': 10}):
        figure, axes = plt.subplots(1, 2, figsize=(11, 4.4), sharey=True)
        for axis, metric in zip(axes, ('uncalibrated_test', 'calibrated_test')):
            for mode, color in (('raw', '#0072B2'), ('sae', '#009E73')):
                for pooling, style in zip(POOLINGS, ('-', '--')):
                    axis.plot(LAYERS, [report['runs'][f'{mode}/{n}/{pooling}'][metric]['brier'] for n in LAYERS],
                              style, marker='o', color=color, label=f'{mode} / {"mean" if pooling == POOLINGS[0] else "last"}')
            axis.axhline(report['runs']['text'][metric]['brier'], color='#D55E00', label='shared text baseline')
            axis.axhline(report['train_prior_constant']['test']['brier'], color='#777777', linestyle=':', label='train-prior constant')
            axis.set(title='Uncalibrated (primary)' if metric == 'uncalibrated_test' else 'Calibrated (secondary; n=4)', xlabel='Residual block', xticks=LAYERS)
            axis.grid(alpha=.2)
        axes[0].set_ylabel('Test Brier (10 source families; lower is better)'); axes[1].legend(fontsize=8)
        figure.suptitle('Exploratory source classification — no causal or learning claim')
        figure.tight_layout(); figure.savefig(directory / 'brier.png', dpi=160); figure.savefig(directory / 'brier.svg'); plt.close(figure)
    for path in directory.iterdir(): path.chmod(0o600)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'report'))
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--expect-files-manifest', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--protocol', type=Path)
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args(argv)
    output = ignored_new_path(args.output, args.prepared)
    context = load_prepared(args.prepared, args.expect_files_manifest)
    if args.command == 'prepare':
        require(args.protocol is None and args.archive is None, 'Preparation does not consume result evidence')
        value = declare_protocol(context); output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        worker.write_bounded(output, value)
        print(core.canonical({'protocol_sha256': value['protocol_sha256'], 'expected_trials': 160,
            'expected_measurements': 320, 'partitions': PARTITIONS, 'output': str(output)}))
    else:
        require(args.protocol is not None and args.archive is not None, 'Report requires sealed protocol and original output archive')
        body = worker.regular_bytes(args.archive, worker.MAX_ARCHIVE)
        value = build_report(context, read_json(args.protocol), body)
        write_report(output, value)
        print(core.canonical({'report_sha256': value['report_sha256'], 'output': str(output), 'claims': value['claims']}))


if __name__ == '__main__':
    main()
