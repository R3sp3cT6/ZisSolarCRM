import json,pathlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

read=lambda p:json.loads(pathlib.Path(p).read_text())
r=read('docs/local-mos-evaluation.json'); verification=read('docs/local-mos-verification.json')
assert verification['status']=='passed'
labels={'september':'18–30 September','october':'1–11 October','all':'All 24 days'}
fig,axes=plt.subplots(2,1,figsize=(11,8),layout='constrained')
x=np.arange(3)
for offset,key,label,color in [(-.18,'v32','v3.2','#69b59c'),(.18,'mos','Bounded local correction','#c87772')]:
    values=[r['scores'][p][key]['wape'] for p in labels]
    bars=axes[0].bar(x+offset,values,.36,color=color,label=label)
    axes[0].bar_label(bars,fmt='%.2f%%',padding=3)
axes[0].set_xticks(x,list(labels.values()));axes[0].set_ylabel('Hourly WAPE (%) — lower is better');axes[0].legend();axes[0].set_ylim(0,31)
days=r['daily'];deltas=[d['mos']['wape']-d['v32']['wape'] for d in days]
axes[1].bar(range(len(days)),deltas,color=['#69b59c' if v<0 else '#c87772' for v in deltas])
axes[1].set_xticks(range(len(days)),[d['date'][5:] for d in days],rotation=60);axes[1].axhline(0,color='#333',lw=.8)
axes[1].set_ylabel('Change in WAPE (percentage points)\nBelow zero = improvement')
for ax in axes:ax.spines[['top','right']].set_visible(False);ax.grid(axis='y',alpha=.15)
fig.suptitle('ZIS Solar | Small residual corrections to v3.2\nRetrospective experiment — live activation gate NOT passed',fontsize=14)
pathlib.Path('outputs').mkdir(exist_ok=True)
fig.savefig('outputs/local-mos-comparison.png',dpi=150);fig.savefig('outputs/local-mos-comparison.pdf');plt.close(fig)
lines=['# Ограничена часовна корекција на v3.2','', 'Направен е нов кандидат `solar-local-mos-v1`. Тој ја коригира основната прогноза според грешките во претходни слични часови: сончева положба и прогнозирано зрачење. Корекцијата е ограничена на ±15%, со силна предност за непроменета прогноза кога нема убедливи податоци.','', '| Период | Часови | v3.2 WAPE | Кандидат WAPE |', '|---|---:|---:|---:|']
for p,label in labels.items():
    s=r['scores'][p];lines.append(f"| {label} | {s['v32']['hours']} | {s['v32']['wape']:.4f}% | {s['mos']['wape']:.4f}% |")
o=r['scores']['october'];interval=verification['bootstrap']['october']['pairedDayDeltaPp95']
lines += ['',f"Октомври: реално {o['v32']['actualMwh']:.5f} MWh на истите 142 часа. WAPE се намалува за {o['v32']['wape']-o['mos']['wape']:.4f} процентни поени ({100*(1-o['mos']['wape']/o['v32']['wape']):.2f}% релативно). Скала 100−WAPE: {100-o['v32']['wape']:.2f}% → {100-o['mos']['wape']:.2f}%. Ова е историски резултат, не нова измерена точност во живо.",'',f"9/11 октомвриски дена се подобри; 10 октомври се влошува за 0,5195 процентни поени, а 11 октомври за 0,0163. MAE {o['v32']['maeKwh']:.3f} → {o['mos']['maeKwh']:.3f} kWh; RMSE {o['v32']['rmseKwh']:.3f} → {o['mos']['rmseKwh']:.3f} kWh. Преценувањето на збирот се намалува од +{o['v32']['biasMwh']:.6f} на +{o['mos']['biasMwh']:.6f} MWh.",'',f"Дневен bootstrap: разлика WAPE кандидат−v3.2, 95% интервал {interval[0]:+.3f} до {interval[1]:+.3f} процентни поени. Ова не ја отстранува пристрасноста од претходно разгледуваните датуми.",'','## Одлука','', '**Не е активиран во CRM.** Во септември подобрувањето е само 0,0042 процентни поени, под однапред зададениот праг од 2% релативно подобрување во двата периода. Главниот v3.2, Ridge пробата и постојните ICON/Huawei/LSA проби остануваат како претходно. Не го менуваме прагот по добиениот резултат.','', 'Оваа мала корекција помага претежно на повторливото преценување во сончеви часови. Таа не го решава главниот проблем со часот на пристигнување на облаците: 11 октомври WAPE останува околу 40,8%. За следна промоција потребни се нови, однапред издадени и потоа измерени резултати од постојните независни часовни временски извори. Не се додаваат произволни тежини и не се ретјунира истиот октомври.','',f"Независна Python проверка: {verification['origins']} издавања, {verification['trainingRevisionChecks']} ревизии за обука, {verification['predictionChecks']} предвидувања; максимална нумеричка разлика {verification['maxIndependentErrorKwh']:.3g} kWh. Истиот архивиран v3.2 benchmark е потврден. Нема користење идни мерења, ноќни измислени цели или ретроактивно отстранување на прекини.",'','[Протокол и извор IEA PVPS](forecast-local-mos-plan.md). [Сите резултати по ден](local-mos-evaluation.json). [Проверка](local-mos-verification.json).']
pathlib.Path('docs/local-mos-results.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
