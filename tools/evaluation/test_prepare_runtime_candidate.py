"""Synthetic source-alias regression; no reference-song contents are used."""
import copy
from fractions import Fraction
import unittest

from prepare_runtime_candidate import prepare
from recognition_eval import compare_scores, normalize_candidate, normalize_reference


class RuntimeSourceAliasTests(unittest.TestCase):
    def test_resolved_alias_avoids_a_phantom_page_without_changing_music(self):
        job = {'status': 'failed', 'partial': True, 'draft': {
            'bpm': 90, 'key': 'D', 'timeSignature': [3, 4],
            'notes': [{'id': 'n', 'degree': 5, 'octave': -1, 'duration': 0.75,
                       'lyric': '甲', 'sourceId': 'page-a', 'sourcePage': 'asset-z',
                       'measureId': 'm', 'beat': 0, 'uncertain': True}],
            'measures': [{'id': 'm', 'sourceId': 'page-a', 'sourcePage': 'asset-z',
                          'duration': 0.75, 'startBeat': 0, 'row': 1}],
            'phrases': [{'id': 'p', 'label': 'synthetic'}]},
            'sourcePackage': {'sources': [{'id': 'page-a'}], 'measures': []}}
        original = copy.deepcopy(job)
        reference = normalize_reference({'rows': [{'page': 1, 'row': 1, 'notes': [
            {'x': 10, 'pitch': '5', 'octave': -1, 'beams': 1, 'dotted': True, 'lyric': '甲'}]}]})
        before = normalize_candidate(job)
        prepared = prepare(job)
        after = normalize_candidate(prepared)
        self.assertEqual(job, original, 'prepare must not mutate its input')
        self.assertEqual(before.page_order, ['page-a', 'asset-z'])
        self.assertEqual(after.page_order, ['asset-z'])
        self.assertEqual(prepared['draft']['notes'], original['draft']['notes'])
        self.assertEqual(prepared['sourcePackage'], original['sourcePackage'])
        self.assertEqual(after.notes[0].duration, Fraction(3, 4))
        metrics = compare_scores(reference, after)['metrics']
        self.assertEqual(metrics['note_precision'], 1)
        self.assertEqual(metrics['note_recall'], 1)
        self.assertEqual(metrics['rhythm_exact'], 1)
        restored = copy.deepcopy(prepared)
        restored['draft']['measures'][0]['sourceId'] = 'page-a'
        self.assertEqual(restored, original, 'the alias must be the only changed field')

    def test_unresolved_portable_source_is_retained(self):
        job = {'draft': {'measures': [{'id': 'm', 'sourceId': 'page-a'}], 'notes': []}}
        self.assertEqual(prepare(job), job)

    def test_standalone_portable_package_is_retained(self):
        package = {'format': 'shengjian.score', 'measures': [
            {'id': 'm', 'sourceId': 'page-a', 'notes': []}]}
        self.assertEqual(prepare(package), package)


if __name__ == '__main__':
    unittest.main()
