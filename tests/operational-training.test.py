import importlib.util
import unittest

spec = importlib.util.spec_from_file_location('operational_training', 'scripts/evaluate-operational-training.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def sample(minute, code=768, power=0, hour=10, device=1, receipt='2026-10-12T15:00:00.000Z'):
    return {'deviceId': device, 'measuredAt': f'2026-09-11T{hour:02d}:{minute:02d}:00.000Z',
        'receivedAt': receipt, 'stateCode': code, 'powerKw': power}

class OperationalTrainingSafety(unittest.TestCase):
    def test_zero_standby_night_unknown_and_missing_power_do_not_mean_shutdown(self):
        for code, power in [(512, 0), (40960, 0), (0, 0), (None, 0), (768, None), (768, 10), (513, -1)]:
            self.assertEqual(module.device_mask([sample(0, code, power), sample(5, code, power)]), {})

    def test_needs_adjacent_same_device_samples_within_same_hour(self):
        self.assertEqual(module.device_mask([sample(0), sample(10)]), {})
        self.assertEqual(module.device_mask([sample(0), sample(5, device=2)]), {})
        self.assertEqual(module.device_mask([sample(55), sample(0, hour=11)]), {})
        with self.assertRaises(AssertionError):
            module.device_mask([sample(0), sample(0), sample(5)])

    def test_explicit_limitation_and_derating_are_not_zero_heuristics(self):
        mask = module.device_mask([sample(0, 513, 300), sample(5, 514, 250)])
        self.assertEqual(mask['2026-09-11T10:00:00.000Z']['witnessIndices'], [0, 1])

    def test_both_witnesses_must_have_arrived_before_origin(self):
        mask = module.device_mask([sample(0, receipt='2026-10-11T15:00:00.000Z'), sample(5)])
        rows = [{'date': '2026-09-11', 'start': '2026-09-11T10:00:00.000Z', 'value': 0},
                {'date': '2026-09-11', 'start': '2026-09-11T11:00:00.000Z', 'value': 0}]
        for cutoff in ['2026-10-11T18:00:00.000Z', '2026-10-12T15:00:00.000Z']:
            self.assertEqual(module.filter_training(rows, 'deviceFiltered', 'receiptCausal', cutoff, mask, cutoff), (rows, []))
        self.assertEqual(module.filter_training(rows, 'deviceFiltered', 'receiptCausal', '2026-10-12T15:01:00.000Z', mask, ''), ([rows[1]], [rows[0]]))
        self.assertEqual(module.filter_training(rows, 'deviceFiltered', 'archiveReconstruction', '2026-09-20T18:00:00.000Z', mask, ''), ([rows[1]], [rows[0]]))
        self.assertEqual(rows[0]['value'], 0)

    def test_broad_sensitivity_requires_explicit_availability_and_never_spreads_device_evidence(self):
        rows = [{'date': '2026-07-01', 'start': '2026-07-01T10:00:00.000Z'},
                {'date': '2026-08-01', 'start': '2026-08-01T10:00:00.000Z'}]
        args = ('2026-09-10T18:00:00Z', {}, '2026-10-12T15:00:00Z')
        self.assertEqual(module.filter_training(rows, 'broadConfirmationSensitivity', 'receiptCausal', *args), (rows, []))
        self.assertEqual(module.filter_training(rows, 'broadConfirmationSensitivity', 'archiveReconstruction', *args), ([rows[1]], [rows[0]]))
        self.assertEqual(module.filter_training(rows, 'deviceFiltered', 'archiveReconstruction', *args), (rows, []))

if __name__ == '__main__':
    unittest.main()
