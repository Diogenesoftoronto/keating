# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["numpy==2.2.6", "scikit-learn==1.7.2", "matplotlib==3.10.8"]
# ///
"""Authored local protocol fixtures; no source corpus, GPU, Hub or provider."""
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import observer_core as core
import observer_experiment as experiment
import observer_experiment_job as worker
import observer_experiment_report as report
from test_observer_experiment_job import fixture, materialization, result_fixture, Tokens, reseal


def source_fixture():
    _, _, base, inventory, limits, _, _, bodies = fixture(layers=tuple(report.LAYERS))
    families = {f'authored-family-{i}': {'split': 'train', 'group_ids': [f'authored-group-{i}']} for i in range(334)}
    all_families = list(families)[:200]; all_ids = [f'authored-record-{i}' for i in range(200)]
    ordered = sorted(zip(all_families, all_ids), key=lambda x: (hashlib.sha256((report.SELECTION_SEED+'\0'+x[0]).encode()).hexdigest(), x[0]))[:40]
    records = []
    for i, (family, rid) in enumerate(ordered):
        split = 'train' if i < 26 else 'calibration' if i < 30 else 'test'
        label = int(i < 10 or i == 26 or 30 <= i < 32)
        families[family]['split'] = split
        row = deepcopy(base['records'][0])
        row.update(record_id=rid, family_id=family, group_ids=families[family]['group_ids'], split=split,
                   labels={'move.probing': label}, source='entirely authored test fixture')
        row['label_provenance'] = {'move.probing': {'origin': 'source_teacher_move_tag', 'example_sha256': 'e'*64,
            'target': {'origin': 'source_teacher_move_tag', 'boundary': 'delivered',
                       'value': 'probing' if label else 'telling', 'fit_mask': split == 'train', 'evaluation_mask': split != 'train'}}}
        records.append(row)
    admission = worker.seal({'schema_version': 1, 'registry_default': 'deny', 'matches_frozen_family_audit': True,
        'full_closure_group_count': 1606, 'person_holdout_established': False, 'source_manifest_file_sha256': 'd'*64,
        'artifact_canonical_sha256': {'family-audit.json': 'f'*64, 'splits.json': 'a'*64}}, 'admission_sha256')
    by_id = {r['record_id']: r for r in records}
    proof_rows = []
    for family, rid in zip(all_families, all_ids):
        row = {'record_id': rid, 'family_id': family, **families[family]}
        if rid in by_id:
            source = by_id[rid]
            row.update(original_record_sha256=core.digest(source), view_sha256=core.digest(core.boundary_view(source)),
                latest_allowed_event_id=source['latest_allowed_event_id'], source_example_sha256='e'*64,
                label_origin='source_teacher_move_tag')
        proof_rows.append(row)
    proof = worker.seal({'complete_assigned_family_count': 334, 'all_records_matched': 200, 'source_family_count': 200,
        'new_or_synthetic_labels': 0, 'admission_sha256': admission['admission_sha256'], 'records': proof_rows}, 'source_proof_sha256')
    selection = worker.seal({'all_200_family_ids': all_families, 'all_200_record_ids': all_ids,
        'all_200_family_set_sha256': core.digest(sorted(all_families)),
        'selected_family_ids': [f for f,_ in ordered], 'selected_record_ids': [r for _,r in ordered],
        'selected_family_set_sha256': core.digest(sorted(f for f,_ in ordered)),
        'source_proof_sha256': proof['source_proof_sha256'], 'source_manifest_file_sha256': 'd'*64,
        'policy': {'seed': report.SELECTION_SEED, 'selected_count': 40, 'from_existing_frozen_200_only': True,
                   'labels_used_for_selection': False, 'reselection': False, 'split_assignments_unchanged': True},
        'heldout_26_families_selected': 0, 'partition_counts': report.PARTITIONS, 'class_counts_post_selection': report.CLASSES}, 'selection_sha256')
    splits = {'schema_version': 1, 'families': families, 'source_manifest_sha256': 'd'*64,
        'admission_sha256': admission['admission_sha256'], 'selection_sha256': selection['selection_sha256'],
        'source_family_audit_canonical_sha256': 'f'*64, 'source_split_artifact_canonical_sha256': 'a'*64,
        'partition_policy': 'authored_source_probe_split_not_published_holdout'}
    card, config = deepcopy(base['concept_card']), deepcopy(base['config'])
    card['target'] = 'move.probing'
    config.update(seeds=[42], poolings=report.POOLINGS, evaluation_record_ids=[r['record_id'] for r in records], selection_sha256=selection['selection_sha256'])
    plan = experiment.prepare(config, records, card, splits)
    job, join = worker.prepare_job(plan, inventory, limits, records)
    documents = {'plan.json': plan, 'helper/job.json': job, 'helper/join.local.json': join,
        'source-records.local.json': {'records': records}, 'selection.json': selection,
        'source-proof.local.json': proof, 'source-admission.json': admission, 'preflight.json': worker.preflight(job, Tokens())}
    return documents, bodies


def export_fixture(documents, bodies, mutate=None, *, partial=False):
    job, flight = documents['helper/job.json'], documents['preflight.json']
    mat = materialization(job, bodies); result = result_fixture(job, flight, mat)
    if mutate: mutate(result)
    reseal(result, 'result_sha256')
    files = {'materialization.json': core.canonical(mat).encode(), 'preflight.json': core.canonical(flight).encode(),
             'experiment.log': b'AUTHORED TRANSPORT FIXTURE; no actual Qwen execution\n'}
    if partial:
        result.update(evidence='incomplete_local_pinned_model_forward_experiment', fit_eligible=False)
        result['rows'] = result['rows'][:3]; result['completed_trials'] = 3; reseal(result, 'result_sha256')
        lines = b''.join((core.canonical(r)+'\n').encode() for r in result['rows'])
        header = {k:v for k,v in result.items() if k != 'rows'}
        files['trials.jsonl'] = lines
        files['partial.json'] = core.canonical(worker.seal({'job_sha256': job['job_sha256'], 'fit_eligible': False,
            'rows_sha256': hashlib.sha256(lines).hexdigest(), 'result_header': header}, 'partial_sha256')).encode()
    else: files['results.json'] = core.canonical(result).encode()
    files['progress.json'] = core.canonical({'job_sha256': job['job_sha256'], 'completed_trials': result['completed_trials']}).encode()
    files['receipt.json'] = core.canonical({'job_sha256': job['job_sha256'], 'exit_code': 1 if partial else 0,
        'complete': not partial, 'fit_eligible': not partial, 'completed_trials': result['completed_trials'],
        'files': {n:hashlib.sha256(b).hexdigest() for n,b in files.items()}}).encode()
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        for name, body in files.items():
            member = tarfile.TarInfo(name); member.size = len(body); archive.addfile(member, io.BytesIO(body))
    return output.getvalue()


def context_fixture(documents):
    context = report.validate_sources(documents)
    context['files_manifest_sha256'] = 'a'*64
    return context


class SourceReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.documents, cls.bodies = source_fixture()

    def test_full_census_grouping_and_train_only_protocol(self):
        ctx = context_fixture(self.documents); protocol = report.declare_protocol(ctx)
        self.assertEqual(len(ctx['closure']['rows']), 334)
        self.assertEqual(len(ctx['records']), 40)
        self.assertEqual(protocol['partition_counts'], {'train':26,'calibration':4,'test':10})
        self.assertEqual(protocol, report.declare_protocol(ctx))
        folds = protocol['validation_folds']
        self.assertEqual({r for f in folds for r in f}, {r['record_id'] for r in ctx['records'] if r['split'] == 'train'})
        self.assertEqual(len([r for f in folds for r in f]), 26)

    def test_unselected_family_bridge_cannot_cross_test_boundary(self):
        docs = deepcopy(self.documents); plan = docs['plan.json']
        train, test = [next(r for r in plan['records'] if r['split'] == s) for s in ('train','test')]
        unused = next(f for f in plan['split_manifest']['families'] if f not in {r['family_id'] for r in plan['records']})
        plan['split_manifest']['families'][unused]['group_ids'] = train['group_ids'] + test['group_ids']
        plan['split_manifest_sha256'] = core.digest(plan['split_manifest']); reseal(plan, 'plan_sha256')
        with self.assertRaisesRegex(ValueError, 'cross partitions'): report.validate_sources(docs)

    def test_unknown_or_modified_labels_and_future_text_break_source_hash(self):
        for change in ('unknown','flipped','future'):
            with self.subTest(change=change):
                docs = deepcopy(self.documents); row = docs['source-records.local.json']['records'][0]
                if change == 'unknown': row['labels']['move.probing'] = None
                elif change == 'flipped': row['labels']['move.probing'] = 1-row['labels']['move.probing']
                else: row['events'][-1]['text'] += ' FUTURE ANSWER KEY'
                with self.assertRaisesRegex(ValueError, 'source hash'): report.validate_sources(docs)

    def test_manifest_anchor_detects_resealed_local_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); specs = {}
            for name, value in self.documents.items():
                path = root/name; path.parent.mkdir(parents=True, exist_ok=True)
                body = core.canonical(value).encode(); path.write_bytes(body)
                specs[name] = {'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
            manifest = worker.seal({'files':specs}, 'manifest_sha256')
            (root/'FILES.json').write_text(core.canonical(manifest))
            self.assertEqual(len(report.load_prepared(root, manifest['manifest_sha256'])['records']),40)
            path = root/'source-records.local.json'; path.write_bytes(path.read_bytes()+b'\n')
            with self.assertRaisesRegex(ValueError, 'bytes changed'): report.load_prepared(root, manifest['manifest_sha256'])
            specs['source-records.local.json'] = {'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            changed = worker.seal({'files':specs},'manifest_sha256'); (root/'FILES.json').write_text(core.canonical(changed))
            with self.assertRaisesRegex(ValueError, 'pin mismatch'): report.load_prepared(root, manifest['manifest_sha256'])

    def test_complete_import_proves_all_40_times_4_times_2_without_mutation(self):
        ctx = context_fixture(self.documents); before = core.digest(self.documents)
        imported, matrices = report.validate_archive(ctx, export_fixture(self.documents,self.bodies))
        self.assertTrue(imported['complete']); self.assertEqual(len(matrices),8)
        expected = {r['record_id'] for r in ctx['records']}
        for rows in matrices.values():
            self.assertEqual({r['record_id'] for r in rows},expected)
            self.assertEqual(len(rows),40)
            self.assertTrue(all('labels' in r and 'SECRET_FUTURE' not in r['text'] for r in rows))
        self.assertEqual(core.digest(self.documents),before)

    def test_partial_evidence_is_preserved_but_never_fit(self):
        ctx = context_fixture(self.documents)
        body = export_fixture(self.documents,self.bodies,partial=True)
        with self.assertRaisesRegex(ValueError, 'Incomplete archive: 3/160'):
            report.validate_archive(ctx,body)
        self.assertFalse(worker.import_outputs(ctx['job'],ctx['join'],body)['fit_eligible'])

    def test_missing_pooling_duplicate_trial_and_temporal_tampering_reject(self):
        changes = {
            'pooling': lambda v: v['rows'][0]['measurements'].pop(),
            'duplicate': lambda v: v['rows'].__setitem__(1,deepcopy(v['rows'][0])),
            'future': lambda v: v['rows'][0].__setitem__('latest_allowed_event_id','future-key'),
            'source': lambda v: v['rows'][0].__setitem__('source_record_sha256','0'*64),
        }
        for name, change in changes.items():
            with self.subTest(change=name), self.assertRaises(ValueError):
                report.validate_archive(context_fixture(self.documents),export_fixture(self.documents,self.bodies,change))

    def test_dependency_import_does_not_load_model_stack(self):
        code = 'import sys;import observer_experiment_report;assert not {"torch","transformers","sklearn","matplotlib"}.intersection(sys.modules)'
        value = subprocess.run([sys.executable,'-c',code],cwd=Path(__file__).parent,capture_output=True)
        self.assertEqual(value.returncode,0,value.stderr)

    def test_strict_json_and_output_boundary(self):
        for body in ('{"x":1,"x":2}', '{"x":NaN}'):
            with self.assertRaises(ValueError): report.parse_json(body)
        root = Path(__file__).resolve().parents[2]
        with self.assertRaisesRegex(ValueError,'outside frozen'):
            report.ignored_new_path(root/'.keating/native-learning/four-layer-readout-v1/new.json',root/'.keating/native-learning/four-layer-readout-v1')
        with self.assertRaisesRegex(ValueError,'.keating'):
            report.ignored_new_path(root/'docs/NOT-AN-OUTPUT.json',root/'.keating/frozen')


class FittingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.documents,_ = source_fixture(); cls.context = context_fixture(cls.documents)
        cls.protocol = report.declare_protocol(cls.context)
        cls.rows = []
        for i, row in enumerate(cls.context['records']):
            label = row['labels']['move.probing']
            cls.rows.append({**row, 'text': f'{row["split"]}onlytoken ' + ('ask why ' if label else 'tell answer '),
                'raw':[float(i),float(label),1.], 'sae': {'0':float(i),'1':float(label)},'sae_width':65536})

    def test_all_modes_fit_with_train_only_preprocessing_and_reloadable_json(self):
        import numpy as np
        from observer_probes import predict_probe
        for mode in ('text','raw','sae'):
            with self.subTest(mode=mode):
                fitted_rows = []
                original = report.preprocessor
                def audited(which):
                    transformer = original(which); actual = transformer.fit_transform
                    def fit(data, *args, **kwargs):
                        fitted_rows.append(data)
                        return actual(data,*args,**kwargs)
                    transformer.fit_transform = fit
                    return transformer
                with patch.object(report,'preprocessor',side_effect=audited):
                    run = report.fit_one(self.rows,mode,'move.probing',self.protocol)
                self.assertEqual([len(x) if mode == 'text' else x.shape[0] for x in fitted_rows][-1],26)
                self.assertEqual(len(fitted_rows),4)  # three CV folds and final train fit
                if mode == 'text':
                    for data in fitted_rows: self.assertTrue(all(x.startswith('trainonlytoken') for x in data))
                    self.assertNotIn('testonlytoken',run['model']['preprocessing']['vocabulary'])
                elif mode == 'raw':
                    self.assertTrue(all(float(x[:,0].max()) < 26 for x in fitted_rows))
                    self.assertAlmostEqual(run['model']['preprocessing']['mean'][0],12.5)
                else: self.assertTrue(all(float(x[:,0].max()) < 26 for x in fitted_rows))
                test = [r for r in self.rows if r['split']=='test']
                self.assertTrue(np.allclose(predict_probe(run['model'],test,mode,width=65536),[r['calibrated'] for r in run['predictions']]))
                self.assertEqual(run['uncalibrated_test']['n'],10)
                self.assertEqual(len(run['cv']),4)

    def test_test_labels_cannot_change_model_or_selected_C(self):
        first = report.fit_one(self.rows,'raw','move.probing',self.protocol)
        changed = deepcopy(self.rows)
        for row in changed:
            if row['split']=='test': row['labels']['move.probing'] = 1-row['labels']['move.probing']
        second = report.fit_one(changed,'raw','move.probing',self.protocol)
        self.assertEqual(first['model'],second['model'])
        self.assertEqual(first['cv'],second['cv']); self.assertEqual(first['selected_C'],second['selected_C'])
        self.assertNotEqual(first['uncalibrated_test']['brier'],second['uncalibrated_test']['brier'])

    def test_fold_cannot_include_calibration_or_test(self):
        changed = deepcopy(self.protocol)
        changed['validation_folds'][0][0] = next(r['record_id'] for r in self.rows if r['split']=='test')
        with self.assertRaisesRegex(ValueError,'Training-only fold'):
            report.fit_one(self.rows,'raw','move.probing',changed)


if __name__ == '__main__':
    unittest.main()
