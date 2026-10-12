import json,pathlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
e=json.loads(pathlib.Path('docs/full-history-evaluation.json').read_text(encoding='utf-8'))
coverage=json.loads(pathlib.Path('docs/full-history-coverage.json').read_text(encoding='utf-8'))
methods=e['methods'];labels={'ridge45':'Ridge · 45 дена','ridgeAll':'Ridge · цела историја','catboost45':'CatBoost · 45 дена','catboostAll':'CatBoost · цела историја'}
def n(x,d=2):return '—' if x is None else f'{x:,.{d}f}'.replace(',',' ').replace('.',',')
lines=['# Проверка на целата историја на ЗИС Солар','',f"Опфат: **{e['first']} – {e['last']}**. Ова се ретроспективни симулации; не се прогнози што CRM ги издал во тие месеци. Не е активиран нов официјален модел.",'',
'Четири однапред фиксни варијанти: Ridge и CatBoost, со последните 45 дена или целата претходна историја. За секој ден се обучуваат повторно исклучиво со постари завршени денови. Тековниот и идните денови не влегуваат во обуката.','',
'## Покриеност на мерењата','', '| Месец | Часови со мерења / очекувани | Дневни часови со мерења / очекувани | Измерени MWh |','|---|---:|---:|---:|']
for m in coverage['months']:lines.append(f"| {m['month']} | {m['measuredHours']} / {m['expectedHours']} | {m['measuredDaylightHours']} / {m['daylightHours']} | {n(m['actualMwh'],3)} |")
lines+=['','Празнините не се претворени во нули. Деновите без доволна претходна историја не добиваат измислена прогноза. Потврдениот јулски прекин останува во главните оценки.','']
for key,title in [('archiveReconstruction','Историска симулација со сегашната архива'),('receiptCausal','Симулација само со тогаш пристигнати мерења')]:
    t=e['tracks'][key]
    lines+=['## '+title,'']
    lines.append('За постарите месеци претпоставува дека мерењата од претходните денови биле достапни, иако во CRM се внесени подоцна. Подоцнежните исправки може да влијаат на резултатот.' if key=='archiveReconstruction' else 'Ги почитува вистинските датуми на прием на секоја ревизија. Пред септември нема таков запис во CRM, па не се прикажува процент за тие месеци.')
    lines+=['','**Часовен WAPE — помало е подобро.**','', '| Месец | Часови | Ridge 45д. | Ridge сите | CatBoost 45д. | CatBoost сите |','|---|---:|---:|---:|---:|---:|']
    for m in t['monthly']:
        s=m['scores'];first=s[methods[0]];lines.append('| '+m['month']+' | '+str(first['hours'] if first else 0)+' | '+' | '.join(n(s[x]['wape'])+'%' if s[x] and s[x]['wape'] is not None else '—' for x in methods)+' |')
    lines+=['| **Вкупно** | '+str(t['scores'][methods[0]]['hours'])+' | '+' | '.join(n(t['scores'][x]['wape'])+'%' for x in methods)+' |','', '| Модел | Скала 100−WAPE | Реални MWh | Предвидени MWh | MAE kWh | RMSE kWh |','|---|---:|---:|---:|---:|---:|']
    for m in methods:
        s=t['scores'][m];lines.append('| '+labels[m]+' | '+n(s['displayAccuracy'])+'% | '+n(s['actualMwh'],3)+' | '+n(s['predictedMwh'],3)+' | '+n(s['maeKwh'])+' | '+n(s['rmseKwh'])+' |')
    lines+=['','Дополнителна чувствителност без целиот јули и 11–12 септември: '+', '.join(labels[m]+' '+n(t['withoutConfirmedPeriods'][m]['wape'])+'% WAPE' for m in methods)+'. Исклучувањето е широко, бидејќи точните часови на прекин не се познати; ова не ја заменува главната оценка.','']
lines+=['## Споредба со v3.2 на истите октомвриски часови','', '| Модел | WAPE | Скала 100−WAPE | Часови |','|---|---:|---:|---:|']
for m,s in e['tracks']['receiptCausal']['v32MatchedOctober'].items():lines.append('| '+labels.get(m,m)+' | '+n(s['wape'])+'% | '+n(s['displayAccuracy'])+'% | '+str(s['hours'])+' |')
lines+=['','v3.2 е зачуваниот контролен модел од претходните тестови; оваа споредба има потесен опсег. Не го пренесувај неговиот октомвриски процент на целите седум месеци.','',
'WAPE = збир на апсолутните часовни грешки / збир на вистинското производство. Месечниот WAPE не е просек на дневните проценти. Скала 100−WAPE е ограничена на 0–100 и не е веројатност на точна прогноза. При речиси нулто месечно производство, како во јули, WAPE може да биде многу над 100%; затоа се дадени и MWh/MAE/RMSE.','',
'За целиот период се користат истите сегашни координати во Ресен и граница од 875 kW AC. Евентуални историски промени во моќноста или распоредот на панелите не се потврдени.','',
'[Протокол](full-history-plan.md) · [Сите резултати](full-history-evaluation.json) · [Независна проверка](full-history-verification.json).']
pathlib.Path('docs/full-history-results.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
fig,axes=plt.subplots(2,1,figsize=(12,8.5),constrained_layout=True)
for ax,(key,title) in zip(axes,[('archiveReconstruction','Historical reconstruction · current archive'),('receiptCausal','Receipt-causal reconstruction')]):
    months=e['tracks'][key]['monthly'];x=np.arange(len(months));width=.19
    for i,method in enumerate(methods):
        vals=[m['scores'][method]['displayAccuracy'] if m['scores'][method] else np.nan for m in months]
        ax.bar(x+(i-1.5)*width,vals,width,label=method)
    ax.set_xticks(x,[m['month'] for m in months]);ax.set_ylim(0,105);ax.set_ylabel('100 − hourly WAPE (%)');ax.set_title(title);ax.axhline(95,color='darkred',linestyle='--',linewidth=1,label='95% target');ax.grid(axis='y',alpha=.2);ax.set_axisbelow(True)
axes[0].legend(ncol=5,loc='upper center',fontsize=8)
axes[0].text(3,10,'July interruption\nWAPE >100%; score clipped to 0',ha='center',fontsize=8,color='#555555')
axes[1].axvspan(-.5,4.5,color='#eeeeee',zorder=0)
axes[1].text(2,48,'Not measurable from receipt history\nCRM receipt records begin 8 September',ha='center',fontsize=10,color='#666666')
fig.suptitle('ZIS Solar · 3 April–11 October 2026\nRetrospective tests; valid outage zeros retained',fontsize=14)
pathlib.Path('outputs').mkdir(exist_ok=True)
fig.savefig('outputs/full-history-comparison.png',dpi=170);fig.savefig('outputs/full-history-comparison.pdf');plt.close(fig)
print('Wrote docs/full-history-results.md and outputs/full-history-comparison.png/.pdf')
