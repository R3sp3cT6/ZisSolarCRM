import type {summarizeHistory} from '@/lib/history-coverage';
type Coverage=ReturnType<typeof summarizeHistory>;
const date=(value:string)=>value.split('-').reverse().join('.');
export function HistoryStatus({history}:{history:Coverage}){
 return <section className="panel history-status" aria-label="Целосност на архивата">
  <div className="panel-heading"><h2>{history.complete?'Историјата е целосно проверена':'Историјата сè уште се пополнува'}</h2><span className="small-pill">{history.hours} / {history.expectedHours} часа</span></div>
  <p>Конфигуриран почеток: {date(history.from)} · Проверка до {date(history.through)}. Тековниот ден се обработува одделно.</p>
  <progress aria-label="Преземени часови" value={history.hours} max={history.expectedHours||1}/>
  <div className="history-counts"><span>Дневни податоци <strong>{history.dailyDays} / {history.totalDays} дена</strong></span><span>Часови со производство <strong>{history.production} / {history.expectedHours}</strong></span><span>Часови со испорака и цена <strong>{history.priced} / {history.expectedHours}</strong></span></div>
  {!history.complete&&<p className="fine-print">Празнините не се сметаат за нулто производство. Серверот презема до 10 претходни денови во 24 часа, а нецелосните API извештаи ги проверува повторно. Приходот за целата историја останува делумен додека недостасуваат мерења или MEMO цени.</p>}
  {!!history.missingDays.length&&<details><summary>Денови со недостасувачки часовни податоци ({history.missingDays.length})</summary><p className="history-missing">{history.missingDays.map(date).join(' · ')}</p></details>}
 </section>;
}
