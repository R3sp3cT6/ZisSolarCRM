"""Exercise the real replay selectors without executing downloads or model fitting."""
import ast
import datetime as dt
import pathlib
import unittest
import numpy as np

tree=ast.parse(pathlib.Path('scripts/evaluate-full-history.py').read_text(encoding='utf-8'))
functions=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('stamp','training','metric')],type_ignores=[])

class HistorySafety(unittest.TestCase):
    def setUp(self):
        self.scope={'dt':dt,'np':np,'AC':875}
        exec(compile(functions,'scripts/evaluate-full-history.py','exec'),self.scope)
        actual=[{'start':s,'productionKwh':v} for s,v in [('2026-04-04T10:00:00Z',100),('2026-09-29T10:00:00Z',0),('2026-09-30T10:00:00Z',500),('2026-10-01T10:00:00Z',800)]]
        self.scope['data']={'actual':actual}
        self.scope['features']={r['start']:({'date':r['start'][:10],'originAt':(dt.datetime.fromisoformat(r['start'].replace('Z','+00:00'))-dt.timedelta(days=1)).isoformat()},{'clearSky':400,'values':[1]}) for r in actual}
        self.day={'date':'2026-10-01','originAt':'2026-09-30T18:00:00Z'}

    def test_expanding_keeps_old_history_and_zero_but_never_origin_or_target_days(self):
        train=self.scope['training']('archiveReconstruction',self.day)
        self.assertEqual([r['index'] for r in train['All']],[0,1])
        self.assertEqual([r['index'] for r in train['45']],[1])
        self.assertEqual(train['45'][0]['value'],0)
        self.scope['data']['actual'][2]['productionKwh']=999999
        self.scope['data']['actual'][3]['productionKwh']=999999
        self.assertEqual(self.scope['training']('archiveReconstruction',self.day),train)

    def test_causal_receipts_reject_future_revision_and_incomplete_hour(self):
        start='2026-09-29T10:00:00Z'
        self.scope['revisions']=list(enumerate([
            {'start':start,'productionKwh':50,'observedAt':'2026-09-29T10:30:00Z'},
            {'start':start,'productionKwh':100,'observedAt':'2026-09-29T11:30:00Z'},
            {'start':start,'productionKwh':200,'observedAt':'2026-09-30T19:00:00Z'},
        ]))
        train=self.scope['training']('receiptCausal',self.day)
        self.assertEqual([r['index'] for r in train['All']],[1])
        self.assertEqual(train['All'][0]['value'],100/875)

    def test_wape_uses_sum_of_hourly_absolute_error_and_zero_denominator_is_unknown(self):
        rows=[{'date':'2026-05-01','actualKwh':100,'p':0},{'date':'2026-05-02','actualKwh':900,'p':900}]
        result=self.scope['metric'](rows,'p')
        self.assertEqual(result['wape'],10)
        self.assertEqual(result['displayAccuracy'],90)
        zeros=self.scope['metric']([{'date':'2026-07-01','actualKwh':0,'p':100}],'p')
        self.assertIsNone(zeros['wape']);self.assertIsNone(zeros['displayAccuracy'])

if __name__=='__main__':unittest.main()
