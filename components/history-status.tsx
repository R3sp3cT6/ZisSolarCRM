'use client';
import {t} from '@/lib/language';
import {useLanguage} from '@/components/language-switch';
import type {summarizeHistory} from '@/lib/history-coverage';
type Coverage=ReturnType<typeof summarizeHistory>;
const date=(value:string)=>value.split('-').reverse().join('.');
export function HistoryStatus({history}:{history:Coverage}){useLanguage();
 return <section className="panel history-status" aria-label={t("Целосност на архивата")}>
  <div className="panel-heading"><h2>{t(history.complete?t("Историјата е целосно проверена"):t("Историјата сè уште се пополнува"))}</h2><span className="small-pill">{t(history.hours)} / {t(history.expectedHours)}{t(" часа")}</span></div>
  <p>{t("Конфигуриран почеток: ")}{t(date(history.from))}{t(" · Проверка до ")}{t(date(history.through))}{t(". Тековниот ден се обработува одделно.")}</p>
  <progress aria-label={t("Преземени часови")} value={history.hours} max={history.expectedHours||1}/>
  <div className="history-counts"><span>{t("Дневни податоци ")}<strong>{t(history.dailyDays)} / {t(history.totalDays)}{t(" дена")}</strong></span><span>{t("Часови со производство ")}<strong>{t(history.production)} / {t(history.expectedHours)}</strong></span><span>{t("Часови со испорака и цена ")}<strong>{t(history.priced)} / {t(history.expectedHours)}</strong></span></div>
  {t(!history.complete&&<p className="fine-print">{t("Празнините не се сметаат за нулто производство. Серверот презема до 10 претходни денови во 24 часа, а нецелосните API извештаи ги проверува повторно. Приходот за целата историја останува делумен додека недостасуваат мерења или MEMO цени.")}</p>)}
  {t(!!history.missingDays.length&&<details><summary>{t("Денови со недостасувачки часовни податоци (")}{t(history.missingDays.length)})</summary><p className="history-missing">{t(history.missingDays.map(date).join(' · '))}</p></details>)}
 </section>;
}
