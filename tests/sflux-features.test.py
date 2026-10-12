import importlib.util
import unittest

spec = importlib.util.spec_from_file_location('sflux', 'scripts/sflux-features.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def field(a, b, value, variable='DSWRF'):
    return {'variable': variable, 'startLead': a, 'endLead': b, 'value': value,
            'units': 'W m**-2', 'stepType': 'avg'}

class SfluxSafety(unittest.TestCase):
    def test_overlapping_averages_are_differenced_not_interpolated(self):
        result = module.hourly([field(6, 7, 100), field(6, 8, 150), field(6, 9, 120)], 'DSWRF')
        self.assertEqual(result, {6: 100, 7: 200, 8: 60})
        self.assertEqual(sum(result.values()), 3 * 120)

    def test_missing_predecessor_and_reset_do_not_fabricate_hour(self):
        result = module.hourly([field(6, 8, 150), field(6, 9, 120), field(12, 13, 400)], 'DSWRF')
        self.assertEqual(result, {8: 60, 12: 400})

    def test_unit_duplicate_and_impossible_negative_energy_are_rejected(self):
        a = field(6, 7, 100)
        for fields in [[a, a], [dict(a, units='J m**-2')], [a, field(6, 8, 10)]]:
            with self.assertRaises(AssertionError):
                module.hourly(fields, 'DSWRF')

    def test_only_requested_spectral_component_is_used(self):
        fields = [field(6, 7, 100), field(6, 7, 30, 'VDDSF'), field(6, 7, 20, 'NDDSF')]
        self.assertEqual(module.hourly(fields, 'VDDSF'), {6: 30})
        self.assertEqual(module.hourly(fields, 'NDDSF'), {6: 20})

    def fixture(self):
        fields = []
        for end in range(18, 22):
            fields.extend([field(17, end, 400), field(17, end, 100, 'VDDSF'), field(17, end, 50, 'NDDSF')])
        fields.extend({'variable': 'TMP', 'startLead': i, 'endLead': i, 'value': 273.15 + i,
                       'units': 'K', 'stepType': 'instant'} for i in range(17, 22))
        fields = [dict(f, distanceKm=5) for f in fields]
        source = {'date': '2026-04-03', 'runAt': '2026-04-02T12:00:00.000Z',
                  'originAt': '2026-04-02T18:00:00.000Z', 'fields': fields}
        day = {k: source[k] for k in ('date', 'runAt', 'originAt')}
        day['hours'] = [{'start': f'2026-04-03T0{hour}:00:00.000Z', 'clearSky': 500,
                         'values': list(range(14)), 'actualKwh': 999999} for hour in (6, 7)]
        return source, day

    def test_hour_midpoint_temperature_components_and_geometry(self):
        source, day = self.fixture()
        result = module.prepare(source, day)
        h = result['hours'][0]
        self.assertAlmostEqual(h['temperature'], 18.5)
        self.assertEqual(h['ghi'], 400)
        self.assertEqual(h['diffuse'], 150)
        self.assertEqual(h['beamHorizontal'], 250)
        self.assertEqual(len(h['nativePartitionTemperature']), 18)
        self.assertEqual(h['nativePartitionTemperature'][14:17], [.15, .25, .375])
        for i in (3, 5, 6, 7, 8, 9, 10, 11):
            self.assertEqual(h['nativeGhi'][i], day['hours'][0]['values'][i])
        day['hours'][0]['actualKwh'] = -123456
        self.assertEqual(module.prepare(source, day), result)

    def test_impossible_partition_missing_temperature_and_wrong_cycle_fail(self):
        source, day = self.fixture()
        source['fields'][1]['value'] = 800
        with self.assertRaises(AssertionError):
            module.prepare(source, day)
        source, day = self.fixture()
        source['fields'] = [f for f in source['fields'] if not (f['variable'] == 'TMP' and f['endLead'] == 19)]
        with self.assertRaises((AssertionError, KeyError)):
            module.prepare(source, day)
        source, day = self.fixture()
        source['runAt'] = '2026-04-02T00:00:00.000Z'
        with self.assertRaises(AssertionError):
            module.prepare(source, day)

if __name__ == '__main__':
    unittest.main()
