"""Render measured experiment results; no changes to model inputs or scoring."""
import json
from pathlib import Path
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

d = json.loads(Path('work/forecast-research/timesfm/evaluation.json').read_text())
bg, panel, fg, muted = '#151e30', '#202d43', '#edf4fc', '#a9bfd8'
colors = ['#83d9c1', '#e9a0a5', '#8dbef7', '#c7b0f2']
keys = ['baselineKwh', 'timesfmKwh', 'timesfmWeatherKwh', 'blendKwh']
labels = ['v3.2 · GFS реплеј', 'TimesFM', 'TimesFM + време', '50% TimesFM + време / 50% v3.2']
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'text.color': fg, 'axes.labelcolor': muted, 'xtick.color': muted, 'ytick.color': muted, 'axes.edgecolor': '#3b4b66', 'axes.facecolor': panel, 'figure.facecolor': bg})
fig, axs = plt.subplots(2, 1, figsize=(13, 10), gridspec_kw={'height_ratios': [1, 1.3]})
fig.subplots_adjust(top=.80, bottom=.15, hspace=.55, left=.08, right=.97)
fig.text(.08, .95, 'ZIS Solar / TimesFM 2.5 — реален локален тест', fontsize=20, weight='bold')
fig.text(.08, .91, '21 септември–11 октомври 2026 · 21 ден · ист претходен пресек за сите модели', fontsize=11, color=muted)
x = np.arange(2)
for i, (k, label, color) in enumerate(zip(keys, labels, colors)):
    vals = [d['totals'][k]['wapePercent'], d['months']['2026-10'][k]['wapePercent']]
    bars = axs[0].bar(x + (i - 1.5) * .18, vals, .16, label=label, color=color)
    axs[0].bar_label(bars, labels=[f'{v:.1f}%' for v in vals], padding=4, color=fg, fontsize=10)
axs[0].set_xticks(x, ['Сите 21 ден', '1–11 октомври'])
axs[0].set_ylabel('Часовна WAPE (%) · помало е подобро')
axs[0].set_ylim(0, max(d['totals'][k]['wapePercent'] for k in keys) * 1.4)
axs[0].grid(axis='y', alpha=.1)
axs[0].set_axisbelow(True)
handles, legend_labels = axs[0].get_legend_handles_labels()
fig.legend(handles, legend_labels, ncol=2, frameon=False, labelcolor=fg, loc='upper left', bbox_to_anchor=(.075, .875), fontsize=10)
rows = [r for r in d['rows'] if r['date'] == '2026-10-11']
hours = [(datetime.fromisoformat(r['start'].replace('Z', '+00:00')).hour + 2) % 24 for r in rows]
axs[1].plot(hours, [r['actualKwh'] / 1000 for r in rows], label='Реално производство', color=fg, linewidth=2.6)
for k, label, color in zip(keys[:3], labels[:3], colors[:3]):
    axs[1].plot(hours, [r[k] / 1000 for r in rows], label=label, color=color, linewidth=1.8, linestyle='--')
axs[1].set_title('11 октомври — споредба по час', loc='left', color=fg, pad=14, weight='bold')
axs[1].set_ylabel('Производство (MWh за час)')
axs[1].set_xlabel('Локален час во Ресен')
axs[1].set_xticks(hours[::2], [f'{h:02d}:00' for h in hours[::2]])
axs[1].grid(alpha=.1)
axs[1].legend(frameon=False, labelcolor=fg, fontsize=9)
fig.text(.08, .045, 'Историски тест, не независна идна валидација. Пропуштените реални мерења не се пополнети.\nTimesFM не е активиран како официјален модел. Извор: зачувани Huawei мерења и оригинални GFS прогнози.', fontsize=9, color=muted, linespacing=1.6)
Path('outputs').mkdir(exist_ok=True)
fig.savefig('outputs/timesfm-comparison.png', dpi=150, facecolor=bg)
fig.savefig('outputs/timesfm-comparison.pdf', facecolor=bg)
print('Saved outputs/timesfm-comparison.png and .pdf')
