"""Publish all fixed candidates, including failures; no model fitting or selection."""
import json, pathlib
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
data=json.loads(pathlib.Path('docs/site-learning-evaluation.json').read_text())
inputs=json.loads(pathlib.Path('work/forecast-research/site-learning/inputs.json').read_text())
root=pathlib.Path('outputs');root.mkdir(exist_ok=True)
chosen=data['selected']; names={'v32':'v3.2','nativePhysics':'Hourly GFS + old response','catboost':'CatBoost','ridge':'Quadratic ridge','analog':'Weather analogues'}
keys=list(names)
fig,axes=plt.subplots(3,1,figsize=(12,12),layout='constrained')
colors=['#86d9be','#a2b2c7','#eb968d','#d7b962','#9e95d7']
x=np.arange(len(keys)); width=.36
axes[0].bar(x-width/2,[data['scores']['selection'][k]['wape'] for k in keys],width,label='21-30 September: selection',color='#89aace')
axes[0].bar(x+width/2,[data['scores']['october'][k]['wape'] for k in keys],width,label='1-11 October: later validation',color='#86d9be')
axes[0].set_xticks(x,[names[k] for k in keys]);axes[0].set_ylabel('Hourly WAPE (%) - lower is better');axes[0].legend()
days=data['daily'];xx=np.arange(len(days))
for k,c in [('v32',colors[0]),(chosen,colors[keys.index(chosen)])]:axes[1].plot(xx,[d['scores'][k]['wape'] for d in days],marker='o',color=c,label=names[k])
axes[1].set_xticks(xx,[d['date'][5:] for d in days],rotation=45);axes[1].set_ylabel('Daily hourly WAPE (%)');axes[1].legend();axes[1].axvline(9.5,color='gray',ls=':')
rows=[r for r in data['rows'] if r['date']=='2026-10-11']
hours=[int(r['start'][11:13])+2 for r in rows]
for k,label,c,ls in [('actualKwh','Measured','#171e2e','-'),('v32','v3.2','#86bba9','-'),(chosen,names[chosen],'#d87970','--')]:axes[2].plot(hours,[r[k]/1000 for r in rows],color=c,ls=ls,label=label,marker='.')
axes[2].set_xlabel('11 October - local hour in Resen');axes[2].set_ylabel('MWh per hour');axes[2].legend()
for ax in axes:ax.grid(axis='y',alpha=.2);ax.spines[['top','right']].set_visible(False)
fig.suptitle('ZIS Solar | native-hourly weather and learned plant response\nExploratory retrospective test, not guaranteed future accuracy',fontsize=15)
fig.savefig(root/'site-learning-comparison.png',dpi=150);fig.savefig(root/'site-learning-comparison.pdf');plt.close(fig)

# Paired day bootstrap describes uncertainty, not a promotion gate or refit.
rng=np.random.default_rng(42); differences=[]
octdays=[d for d in days if d['date']>='2026-10-01']
for _ in range(5000):
    sample=[octdays[i] for i in rng.integers(0,len(octdays),len(octdays))]
    denominator=sum(d['scores']['v32']['actualMwh'] for d in sample)
    differences.append(sum((d['scores'][chosen]['wape']-d['scores']['v32']['wape'])*d['scores']['v32']['actualMwh'] for d in sample)/denominator)
interval=np.percentile(differences,[2.5,97.5]).tolist()
regimes={d['date']:d['regime'] for d in inputs['days']}
regime_scores={}
for regime in sorted(set(v for v in regimes.values() if v)):
    rs=[r for r in data['rows'] if regimes[r['date']]==regime]
    regime_scores[regime]={'days':len(set(r['date'] for r in rs)),'hours':len(rs),'wape':{k:100*sum(abs(r[k]-r['actualKwh']) for r in rs)/sum(r['actualKwh'] for r in rs) for k in keys}}
wins=sum(d['scores'][chosen]['wape']<d['scores']['v32']['wape'] for d in days)
diagnostic={'octoberPairedDayBootstrapDifferencePp95':interval,'dailyWins':wins,'days':len(days),'regimes':regime_scores,'seed':42,'replicates':5000}
pathlib.Path('docs/site-learning-diagnostics.json').write_text(json.dumps(diagnostic,indent=2))
lines=['# ZIS Solar: learned plant-response results','',f"Selected on September only: **{names[chosen]}**. Fixed settings; no October retuning.",'','| Model | WAPE 21-30 Sep | WAPE 1-11 Oct | WAPE all21days |','|---|---:|---:|---:|']
for k in keys:lines.append(f"| {names[k]} | {data['scores']['selection'][k]['wape']:.2f}% | {data['scores']['october'][k]['wape']:.2f}% | {data['scores']['all'][k]['wape']:.2f}% |")
s=data['scores']['all'][chosen];d=days[-1]['scores']
lines += ['',f"Common comparison: {s['hours']}hourly intervals, {s['actualMwh']:.5f}MWh actual. Selected model MAE{s['maeKwh']:.2f}kWh, RMSE{s['rmseKwh']:.2f}kWh, signed error{s['biasMwh']:+.3f}MWh. Daily wins: {wins}/{len(days)}.",'',f"11October: measured{d['v32']['actualMwh']:.5f}MWh; v3.2 predicts{d['v32']['predictedMwh']:.5f}MWh/WAPE{d['v32']['wape']:.2f}%; selected model predicts{d[chosen]['predictedMwh']:.5f}MWh/WAPE{d[chosen]['wape']:.2f}%.",'',f"October paired-day bootstrap95% interval for selected-minus-v3.2 WAPE difference: {interval[0]:+.2f} to {interval[1]:+.2f}percentage points (5000resamples, seed42). This small, already inspected historical period is not independent prospective evidence.",'','## Limits and release decision','','- The original hourly GFS archive spans57days. Training uses available prior revisions only, rolling45days. Target outcomes are not fitting inputs. Missing daylight training labels are excluded; valid measured zeros remain.','- Three candidates were fixed before their scores. September chooses the algorithm; all October candidates and every daily score are retained. Dates had previously been explored with different methods.','- GFS has0.25degree spatial resolution. Hourly radiation helps temporal detail but cannot reveal individual cloud-shadow motion.','- The native-weather ablation retains the old plant response and its original calibration gain.','- The selected model is deployed as a separate seven-day frozen challenger, with its own issued forecasts and matched prospective WAPE. It does not replace v3.2 or overwrite old chart forecasts.','- Live GFS cycles may differ from the12UTC retrospective inputs. Live outcomes are independently scored; retrospective percentages are never displayed as live accuracy.','- The existing ICON/GFS/ARPEGE and satellite/Huawei trials continue. No new paid service or keep-alive polling.','','Full reproducible sources: `solar-learning-plan.md`, `site-learning-frozen.json`, `site-learning-evaluation.json`, `site-learning-verification.json`, and the SQL research receipt.']
pathlib.Path('docs/site-learning-results.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(diagnostic))
