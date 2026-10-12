"""Hourly surface irradiance components from original GFS averaging intervals."""
import datetime as dt
import math

def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))

def iso(value):
    return value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def hourly(fields, variable):
    points = {}
    for f in fields:
        if f['variable'] != variable:
            continue
        a, b, value = f['startLead'], f['endLead'], f['value']
        assert isinstance(a, int) and isinstance(b, int) and a < b
        assert b not in points and math.isfinite(value) and value >= 0
        assert f['units'] == 'W m**-2' and f['stepType'] == 'avg'
        points[b] = f
    result = {}
    for end, f in sorted(points.items()):
        duration = end - f['startLead']
        previous = points.get(end - 1)
        if duration > 1 and (previous is None or previous['startLead'] != f['startLead']):
            continue
        value = duration * f['value'] - (duration - 1) * (previous['value'] if previous else 0)
        assert math.isfinite(value) and -.5 <= value <= 1800, (variable, end, value)
        result[end - 1] = value
    return result

def prepare(source, day):
    assert source['date'] == day['date'] and timestamp(source['runAt']) == timestamp(day['runAt'])
    assert timestamp(source['originAt']) == timestamp(day['originAt'])
    run, origin = timestamp(source['runAt']), timestamp(source['originAt'])
    assert origin - run == dt.timedelta(hours=6)
    for f in source['fields']:
        assert f['distanceKm'] < 25
    partitions = {v: hourly(source['fields'], v) for v in ('DSWRF', 'VDDSF', 'NDDSF')}
    temperatures = {}
    for f in source['fields']:
        if f['variable'] == 'TMP':
            assert f['units'] == 'K' and f['stepType'] == 'instant' and f['startLead'] == f['endLead']
            assert f['endLead'] not in temperatures and 180 < f['value'] < 340
            temperatures[f['endLead']] = f['value']
    points, adjusted = {}, []
    for start in set(partitions['DSWRF']) & set(partitions['VDDSF']) & set(partitions['NDDSF']):
        ghi_raw = partitions['DSWRF'][start]
        diffuse_raw = partitions['VDDSF'][start] + partitions['NDDSF'][start]
        assert -.5 <= diffuse_raw <= ghi_raw + .5, (source['date'], start, ghi_raw, diffuse_raw)
        ghi = max(0, ghi_raw)
        diffuse = max(0, min(ghi, diffuse_raw))
        if (ghi, diffuse) != (ghi_raw, diffuse_raw):
            adjusted.append({'startLead': start, 'rawGhi': ghi_raw, 'rawDiffuse': diffuse_raw, 'ghi': ghi, 'diffuse': diffuse})
        if start not in temperatures or start + 1 not in temperatures:
            continue
        temp = (temperatures[start] + temperatures[start + 1]) / 2 - 273.15
        points[iso(run + dt.timedelta(hours=start))] = {'ghi': ghi, 'diffuse': diffuse,
            'beamHorizontal': ghi - diffuse, 'temperature': temp}
    selected = [points[h['start']] for h in day['hours']]
    total = sum(p['ghi'] for p in selected) / 10000
    peak = max(p['ghi'] for p in selected) / 1000
    hours = []
    for h, p in zip(day['hours'], selected):
        start = timestamp(h['start'])
        previous = points.get(iso(start - dt.timedelta(hours=1)))
        following = points.get(iso(start + dt.timedelta(hours=1)))
        if h['clearSky'] > 0:
            assert previous is not None and following is not None
        base = h['values'].copy()
        base[0] = p['ghi'] / 1000
        base[1] = previous['ghi'] / 1000 if previous else 0
        base[2] = following['ghi'] / 1000 if following else 0
        base[4] = min(2, p['ghi'] / h['clearSky']) if h['clearSky'] > 20 else 0
        base[12], base[13] = total, peak
        assert len(base) == 14
        extra = [p['diffuse'] / 1000, p['beamHorizontal'] / 1000,
                 p['diffuse'] / p['ghi'] if p['ghi'] > 20 else 0, p['temperature'] / 50]
        hours.append({'start': h['start'], 'clearSky': h['clearSky'], 'coarseGhi': h['values'],
                      'nativeGhi': base, 'nativePartitionTemperature': base + extra, **p})
    return {'date': day['date'], 'runAt': source['runAt'], 'originAt': source['originAt'],
            'hours': hours, 'roundingAdjustments': adjusted}
