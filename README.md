# ZIS Solar

Контекст за продолжување: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md). Последна проверка на зачуваните прогностички податоци: [forecast-persistence-audit.json](docs/forecast-persistence-audit.json).

Приватна веб-платформа на македонски за производство, испорака, MEMO DAM цени и приход. Next.js 16 на Vercel, PostgreSQL архива во Neon (Frankfurt).

## Пристап и архива

- Самостојна најава со корисничко име и лозинка; нема јавна регистрација. Лозинките се salted scrypt хешови. Сесиите се случајни 256-bit токени со HTTP-only, Secure, SameSite=Lax cookies и рок од 7 дена; во базата се чуваат само нивните SHA-256 хешови.
- Сите податоци бараат најава. Сите запишувања бараат ист Origin. Старите Sites заглавија не даваат пристап. Обидите за најава се ограничени во базата. Промена на лозинка ги поништува другите сесии.
- Преглед по час, ден, месец и година, графикони и CSV извоз со производство и испорака во MWh. Енергијата се претвора само при приказ/извоз (1.000 kWh = 1 MWh), а изворните API мерења, рачниот внес и CSV увозот остануваат во kWh. Часовни мерења, ревизии, цени и ревизии на цените остануваат во Neon.
- Рачен внес и CSV со проверка пред зачувување, до 1.000 редови/500 KB. PostgreSQL трансакција ги запишува сите мерења и ревизии атомски. Повторен час ја заменува актуелната вредност без удвојување на збирот.

## Корисници и улоги

- `admin` има целосен пристап и мени **Корисници**: создавање сметки, промена на улога, ресетирање лозинка и деактивирање. Оригиналната сопственичка сметка е заштитена од деактивирање/промена на улога; сопствената лозинка се менува во **Мој профил**.
- `viewer` има само преглед, MEMO, архива и CSV извоз. Нема **Мојата централа**, **Корисници**, синхронизација или внес. Серверот враќа 403 за сите барања за промени, вклучително и менување лозинка; администраторот ја ресетира.
- `users.plant_owner` го одредува пристапот до истата централа. Клиентот не може да избере друга централа или да си ја промени улогата. Улогата и активниот статус се читаат од базата при секое барање. Секоја администраторска измена ги поништува постојните сесии на целната сметка.
- Миграцијата `002_user_roles.sql` го зачувува постојниот сопственик како администратор. `scripts/migrate.mjs` ги применува нумерираните миграции и проверува контролни суми.
- Интеграциска проверка: `TEST_BASE_URL=http://localhost:3001 node --env-file=<private-env-file> --experimental-strip-types tests/roles-integration.mjs`. Создава изолирани тест-корисници/централи и ги отстранува по тестот.

## Договорна пресметка

Според доставените извадоци, точка 10А, по локален датум на испорака во Ресен (`Europe/Skopje`):

- До 30.09.2026: `Продажна цена (EUR/MWh) = MEMO DAM(h) × 0,94 − 2,20`.
- Од 01.10.2026: `Продажна цена (EUR/MWh) = MEMO DAM(h) × 0,94 − 2,50`.

`Приход (EUR) = испорачана енергија (kWh) / 1000 × продажна цена`

Формулата важи понеделник–недела. Балансирањето е вклучено, нема двојно одземање или измислен минимум за негативни цени. Миграцијата `007_contract_versions.sql` ги чува двете верзии во `contract_versions`; претходната има непознат почетен датум, новата е `excerpt-10A-20261001-94pct-2.5`. Runtime улогата има само SELECT врз договорите и ревизиската евиденција. Примени ги миграцијата и новите grants од `db/runtime-permissions.sql` пред објавување на кодот.

Секој часовен приход, календарски збир, архива, CSV, прогноза и дневен push извештај го користи договорот што важи за часот. За период со повеќе договори нема единствен надомест за целиот период. Договорите се заеднички кеширани седум дена; кешот треба да се верзионира/обнови при следна договорна измена, заедно со dashboard snapshots. Нема нов polling. Октомвриската исправка и дневните суми пред/по неа се зачувани во `contract_recalculations` и [october-contract-recalculation.json](docs/october-contract-recalculation.json). Изворните мерења, цени и старите `forecast_runs` остануваат неизменети; приказот на приходот од старите прогнози се коригира со означување, а новите прогнози го зачувуваат важечкиот распоред во payload и inputs.

Приходот се собира час по час, не производство × просечна цена. Кога нема испорака од броило, вредноста на производството е посебна проценка. Непознати мерења/цени остануваат непознати. Приходот е делумен додека не се пополни архивата и не е исплатена фактура или добивка по даноци и сите трошоци. UTC складирање, Europe/Skopje приказ, 23/25 часови на DST денови; двосмислени MEMO табели се одбиваат.

## Huawei и автоматско собирање

Официјалниот Northbound API е проверен на 08.09.2026: `https://eu5.fusionsolar.huawei.com`, `NE=252974614`, 8 инвертери. API лозинката е серверска тајна; API сесијата е AES-GCM шифрирана во Neon. Човечки browser cookies не се користат за интеграцијата.

Vercel Cron повикува `GET /api/solar-sync` еднаш дневно во 04:15 UTC, и кога страницата е затворена. Бара `Authorization: Bearer CRON_SECRET`; неавторизиран повик враќа 401. Најавениот интерфејс исто така може да побара освежување. Заеднички database lock и зачувани rolling ограничувања спречуваат паралелни најави/пречекорување на Huawei лимитите. Статусите на задачите се чуваат во `collector_runs` 30 дена. Целниот тим веќе е Pro.

Тековни мерења: `active_power` во kW од сите 8 инвертери, `day_power` и `day_on_grid_energy`. Активниот интерфејс бара освежување 310 секунди по завршувањето на претходното, мирува кога е скриен или неактивен 10 минути и продолжува при враќање. Заедничките API ограничувања се 305 секунди по растение и по тип уреди. Часовните извештаи `PVYield`/`ongrid_power` се проверуваат на еден час. Позитивни завршени часови се користат веднаш; незавршен час и неодамнешни нулти placeholders не се архивираат. Недостасувачко производство останува NULL, дури и при измерена нулта испорака.

Huawei realtime одговорот нема време на последното мерење. Приказот е означен со време на преземање и застареност по 15 минути без успешно преземање. Дневните/месечните извештаи го дополнуваат производството; приходот секогаш бара часовна испорака и часовна цена.

Уредската историја `/thirdData/getDevHistoryKpi` ги дополнува само празните вредности од вчера и денес. Цел час бара вистински бројачи на двете часовни граници, сите инвертери и отсуство на ресетирање. За оваа централа испораката е `active_cap` на броилото (потврдено со официјалните 14/96 kWh на 09.09.2026), производството е разликата на `total_cap`. Насоката на броилото не е универзална. Нема интерполација и нема претворање NULL во нула.

Историјата има заеднички лимит 26 повици во 24 часа: најмногу 13 за броило и 13 за инвертери, по еден batch на освежување, со најмалку една минута меѓу повици. Од 06–21 часот се избира серијата со постара проверка, најмногу еднаш на час за секој тип. Двете серии добиваат часовна граница без претходното намерно двочасовно доцнење на производството. Кога Huawei квотата е потрошена или границата недостига, вредноста останува непозната; realtime моќноста и дневните суми продолжуваат преку одделните API повици. Дневната задача прво го проверува вчерашниот извештај; постарата архива се пополнува кога има преостаната квота.

Тековниот час се пресметува од точната почетна состојба и најновиот бројач. Се чува само привремено во `fusion_state.liveHour`, важи само за истиот час и е означен со ≈. Не се запишува во часовната архива и не се извезува во CSV. Бројот недостасувачки часови ги брои само завршените часови (вклучително 23/25 часа при DST).

## Околина и објавување

Vercel проект: `ilijas-projects-526973e6/zissolar`. Главна адреса: https://zissolar.vercel.app/login — бесплатен Vercel поддомен, без купување домен. Претходната адреса `zis-solar.vercel.app` исто така останува поврзана со проектот. Посебна Neon база `zis-solar`, постоен Launch план со наплата според користење. Претходната Sites верзија останува одделна со старата архива; нејзината API лозинка е отстранета за да не создава паралелни Huawei сесии. Конфигурацијата за тој runtime е архивирана во `legacy/sites` и претходната git гранка.

Потребни серверски променливи:

- `DATABASE_URL` — Neon конекција, автоматски поврзана преку Vercel Marketplace.
- `FUSIONSOLAR_USERNAME`, `FUSIONSOLAR_PASSWORD`, `FUSIONSOLAR_OWNER` — API најава и стабилен сопственик на архивата.
- `CRON_SECRET` — случајна независна тајна за автоматската задача.

Не користете `NEXT_PUBLIC_` за тајни. API тајните се Sensitive променливи во Vercel Production. Preview околината не е поврзана со продукциската база. Локалната датотека за конекција и податоците за најава се надвор од проектот/OneDrive. `.vercelignore` исклучува приватни датотеки, стари артефакти и тестови од објавувањето.

`npm ci`, `npm run dev`, `npm run build`, `npm start`.

`node --env-file=<private-env-file> scripts/migrate.mjs` ја применува верзионираната PostgreSQL шема атомски со checksum. `scripts/seed-admin.mjs` создава почетна сметка `admin` само ако не постои; бара `ADMIN_PASSWORD` и не заменува постојна лозинка. Нови SQL промени треба да бидат нови миграции.

`vercel --prod --yes --scope ilijas-projects-526973e6` објавува и го поставува Cron од `vercel.json`. Сите идни објавувања мора прво да поминат build и соодветните проверки.

## Проверки

- `npm test`: договор/негативни цени, DST, периоди, Huawei сопственост и типови на мерења, лозинки и проверка на серверската тајна.
- `node --env-file=<private-env-file> tests/neon-integration.mjs`: бара локално активна апликација и мигрирана Neon база; создава изолирана тест-сметка и ја брише во finally. Проверува најава, CSRF, forged header, архивирање, приход, PostgreSQL rollback, промена на лозинка, поништување сесии и одјава. Реалната архива не се менува.
- При миграцијата се пренесени 14 сопственички часовни мерења со ревизии, 168 MEMO часовни цени со ревизии, Huawei извештаи и зачуван статус. Не се внесени демонстрациски мерења во реалната централа.
- Продукциска проверка на 08.09.2026: успешна најава, 401 за неовластен пристап и заштитен cron, вистинско Huawei/MEMO освежување. Независното закажано Vercel Cron извршување е потврдено во Neon во 13:36 UTC.
- Клиентските артефакти се проверени за присуство на API лозинка, DB URL, cron тајна и лозинка за најава: нема совпаѓања.

## CSV

```csv
start,production_kwh,export_kwh
2026-09-01T10:00:00+02:00,45.5,44.2
```

Илустрација на формат, не реално мерење. Празна испорака значи непознато, 0 значи измерена нула. Внесете инкрементална kWh енергија за часот, не kW или дневен вкупен бројач.

## Извори

- MEMO: https://dam-data.memo.mk/index.php?action=auction-by-hour&lang=en
- Huawei API: https://support.huawei.com/enterprise/en/doc/EDOC1100569196/9676f1cf/authentication-api
- Huawei извештаи: https://support.huawei.com/enterprise/en/doc/EDOC1100569196/f8115f07/report
- Huawei лимити: https://support.huawei.com/enterprise/en/doc/EDOC1100569196/b71c4d05/flow-control-using-the-api-account
- Vercel Cron: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Neon driver: https://neon.com/docs/serverless/serverless-driver

Транспарентното лого од сопственикот е во `public/zis-solar-logo-transparent.png`. Во најавата и страничното мени се прикажува целосно, во оригиналните пропорции, без отсекување или бела подлога. Истата датотека се користи и како икона на страницата.

### Проверка на целосноста на историјата

Почетокот 03.04.2026 е потврден од сопственикот на 08.09.2026. Панелот „Целосност на архивата“ ги брои сите очекувани часови до крајот на вчера според Europe/Skopje (вклучува 23/25-часовни денови), одделно од тековниот ден. Нулите се валидни мерења; null и отсутни записи не се заменуваат со нули.

Колекторот автоматски ги презема недостасувачките месечни пакети со дневни податоци, старите часовни извештаи и недостасувачките MEMO цени. За часовите се задржани ограничувањата од 24 API повици во подвижни 24 часа и најмногу 10 повици за стари денови, со најмалку 30 минути меѓу нив. Ова се конзервативните ограничувања конфигурирани во апликацијата, не гаранција за квотата на секоја Huawei сметка.

Непреземените денови имаат предност. Нецелосните извештаи и старите маркери `complete` без `version:2` повторно се проверуваат по 7 дена, за еден ден со трајни null вредности да не ја блокира целата редица. Комплетноста се пресметува од зачуваните мерења и цени, а не само од API статусот на одговорот. Повторувањето не гарантира дека Huawei ќе врати податок што недостасува кај изворот.

Освежување при активен корисник: POST /api/solar-refresh е достапен за најавени администратори и viewers; нема параметри за промена на податоци. Проверува Origin, има ограничување по корисник и заеднички lock/cooldown по централа. UI освежува на 310 секунди додека е видлив и имало активност во последните 10 минути. Нема минутно polling на базата. Дневниот collector ги прескокнува тековните часови за да преземе недостасувачки историски ден. Лимитот до 10 стари денови дневно е максимум, не гарантиран број; без активни корисници дневниот повик обработува најмногу еден стар ден.


## Shared cache and batched archiving

Production uses the private Upstash Redis resource `zis-solar-cache` in Frankfurt, Free plan, with automatic upgrades and eviction disabled. Server-only `KV_REST_API_URL` and `KV_REST_API_TOKEN` are supplied by the Vercel integration. No browser receives a Redis credential, Huawei token, or a publicly cacheable financial response.

Authenticated dashboard reads build day/month/year views from one snapshot per plant. Huawei telemetry is refreshed at most once per 310 seconds across all users. API reservations, encrypted Huawei sessions, live counters and pending completed-hour readings are durable in Redis. Incomplete intervals remain incomplete; only confirmed counter boundaries become hourly rows.

The first active visit after a 10-minute gap flushes pending readings, fetches available Huawei reports, and refreshes the database snapshot. Continuous activity flushes at most hourly; simultaneous visitors share a 260-second plant lease. A database transaction is acknowledged in Redis only after success, and fill-only upserts permit replay without duplicate readings or revisions. The daily collector and the existing 21:00 push pass also flush the queue. The cache adds no background polling timer. A cold cache or actual login/admin action can still wake Neon. The separate daily MEMO price job is described below.

Cached sessions retain their original expiry. Logout uses a tombstone, while role/password changes fence all of a user's cached sessions with a revocation version before updating the database. Cache fills revalidate within a stable version. Missing cache configuration uses the original database path; a configured but unavailable cache fails closed instead of silently bypassing revocations or discarding queued readings. Focus/visit events inside the existing 30-minute visit window update Redis only.

For manual imports outside the application's API, call `rebuildSnapshot(owner)` from `lib/solar-cache.ts` after the transaction. API imports and scheduled synchronizations update it automatically. `X-ZIS-Database-Queries` on dashboard/refresh responses counts SQL statements including authentication, so a warm cache response can be verified as zero.

### MEMO prices for tomorrow

`/api/memo-sync` fetches the next **Europe/Skopje calendar day**, independently of Huawei. It runs at 11:05 local time, with a 12:05 fallback if the download or cache publication failed. MEMO's [Operational Rules, Annex 1](https://dam.memo.mk/wp-content/uploads/2023/04/2_Operational-Rules-_ENG.pdf) specify publication starting at 10:45; exceptional delays remain possible. The UTC expression covers both seasons, and the unused hour exits before Redis or SQL access.

The collector validates every expected hourly slot (23/24/25), saves the prices and rebuilds the shared dashboard under the existing plant lease. Only then does it mark the delivery date complete in Redis, so duplicate invocations and the successful day's fallback perform no SQL. This adds one scheduled database wake for prices, plus a retry only if needed; it does not poll Neon. Missing or incomplete source prices stay missing. Attempts/errors remain in `sync_runs`. The existing solar and push schedules continue separately. GET and manual recovery POST require `CRON_SECRET`; manual POST skips only the clock gate, never authentication or completeness checks.

### Forecast module (experimental)

`/?view=forecast` shows seven future Skopje delivery days. Authenticated users can read their assigned plant's saved forecast; only freshly authorized administrators can change settings or calculate. No client-supplied owner is accepted. Forecasts never replace measured readings or official prices.

The initial price model is a reproducible benchmark, not a trained regional market model: 50% of the latest available same-hour delivery-day price plus 50% of the latest same-weekday price available at the issue-day cutoff. Each 1–7-day horizon uses that cutoff, so a long-range forecast cannot read intervening future labels. Official MEMO prices fetched before issuance override predictions. Daily means are duration-weighted through actual UTC slots, including 23/25-hour days; export-weighted capture prices are shown separately. No price clipping or assumed ban on negative prices is applied.

Production in `weather-solar-v3.0` requires weather for every delivery hour. **There is no repeated historical-profile fallback.** Missing weather/parameters/calibration leave production and revenue unavailable. Up to 14 complete production days within the preceding 45 days inform the empirical response; at least seven are required. Incomplete days are excluded, not zero-filled. Export uses the median daily export/production ratio from at least seven paired complete days (plausible ratios 0–1.1, capped at 1). Revenue is a scenario: `sum(export_kWh / 1000 * salePrice(MEMO_EUR_MWh, delivery_hour, effective_contracts))`; it is not a calibrated expected value of a joint probability distribution. Missing components make the daily result unavailable rather than a misleading partial sum.

The default source is **MET Norway Locationforecast (global ECMWF)** at the configured GPS coordinates. Its complete endpoint supplies total and layered cloud cover, fog where available, air temperature, humidity, wind and precipitation; it does **not** supply solar irradiance. Its 1h/6h instant samples are interpolated to hourly midpoints without extrapolation or bridging gaps longer than six hours. Source resolution is retained per hour. The server identifies the app, rounds coordinates to four decimals, shares raw responses in Redis, respects `Expires`, and revalidates with the original `Last-Modified`. Forecasts issued more than 24 hours ago are rejected. CC BY 4.0 attribution and our modifications are shown in the UI. No paid API key is needed for this path.

Version 3 adds free **FMI SILAM** total/dust aerosol optical depth, a relative Simplified Solis irradiance correction, a cloud/fog overlap proxy, and a wind adjustment to panel cooling. Missing or out-of-range aerosol data falls back to the reference atmosphere with visible coverage; it does not silently imply zero dust. The existing cron frequency and warm Redis read behavior are unchanged. See [weather research, equations, assumptions and limitations](docs/forecast-weather-research.md) for source comparisons and validation details. These effects remain experimental until evaluated against future Huawei measurements.

**Empirical weather model, not a calibrated physical plant twin:** Haurwitz clear-sky horizontal irradiance `Gclear = 1098 sin(elevation) exp(-0.059/sin(elevation))` is integrated at six 10-minute midpoint samples per hour, using SunCalc 2 angles in degrees. Nighttime irradiance is zero. Kasten–Czeplak attenuation estimates `GHI = Gclear * (1 - 0.75*(cover/100)^3.4)`, with `cover = max(total cloud, available fog)`; aerosol correction is then applied where valid. This empirical relationship cannot determine cloud optical thickness or measured fog/snow losses. In each solar-hour bin, the 90th percentile of measured production normalized by clear-sky irradiance and reference thermal correction estimates the plant response; at least five observations per bin and five supported bins are needed. Solar-noon alignment avoids DST shifting the learned profile. Between bins the coefficient is interpolated; at daylight edges the nearest coefficient is used. Historical weather is not available, so calibration assumes **20°C reference air temperature** and can be biased if the history lacks clear days. Forecast temperature uses the editable NOCT/gamma approximation with a generic Faiman heat-transfer ratio when wind is available. Coefficients already absorb AC conversion, orientation and losses, so those losses are not applied twice. These effective coefficients are not nameplate DC kWp. Output is clipped to the configured AC model cap. Hourly kWh and average kW are numerically equal for our one-hour UTC slots; the shown peak is the highest hourly mean, not an instantaneous peak. No claim of measured irradiance or validated accuracy is made.

ZIS Solar coordinates were verified in the Huawei device export (2026-09-09). The initial **875 kW model cap** is the sum of nominal AC ratings of three SUN2000-100KTL-M2 and five SUN2000-115KTL-M2 in that inventory, a conservative model assumption rather than a verified grid export limit or future availability. DC kWp, tilt and azimuth remain unconfirmed. Adjust the cap if a lower operating/export limit applies. The model does not forecast faults, snow cover, shutdowns, curtailment or changing shading.

If `OPEN_METEO_API_KEY` (commercial customer API) and confirmed latitude, longitude, DC kWp, AC kW, tilt and azimuth are available, the higher-detail GTI path takes precedence. A provider failure falls back to the explicitly identified MET empirical path when calibration is available. Admin settings use south 0°, east −90°, west +90°. The adapter stores the retrieved response, validates UTC timestamps/units, and shifts preceding-hour GTI to interval start. It computes `Tcell = Tair + (NOCT-20)*GTI/800`, `Pdc = DC_kWp * GTI/1000 * max(0,1+gamma*(Tcell-25))`, then applies system losses, inverter efficiency and AC clipping. The initial 14% losses, −0.004/°C coefficient, NOCT 45°C and efficiency .96 are explicit, editable assumptions. Estimated horizontal GHI is never passed off as GTI in this physical model. No provider key is sent to the browser.

The cron `/api/forecast-sync` runs at **08:20, 12:20 and 18:20 Europe/Skopje**, using a UTC schedule covering both seasons and a local-time gate before database/cache access. It uses the archive populated by existing MEMO/Huawei collectors; it does not independently poll those APIs or control the plant. It adds up to three scheduled Neon wakes daily. Visitors read the shared seven-day Redis snapshot, with a database fallback on a cold cache, and do not trigger model generation. A per-plant lease plus SQL `(owner,run_key)` uniqueness deduplicates 30-minute retries; configuration changes produce a new key. Model/configuration/input snapshots are append-only in `forecast_runs`. Failed publication remains retryable. Archived runs retain the contract and source versions used at issuance.

The UI reports fixed-model chronological price backtests over the latest 56 days (MAE, RMSE, bias stored, daily-mean MAE), separately for each horizon. These use current revised historical prices and are **not** revision-aware or weather backtests. Forward evaluation compares the first frozen price prediction per UTC hour with subsequently available MEMO prices; it does not substitute an improved later run. Production is now evaluated separately: first frozen prediction from this model version versus later completed Huawei hourly readings, reporting kWh MAE and storing bias. Hours where both forecast and actual are zero are excluded to avoid diluting errors with night hours. This initial score mixes lead times and is not a claim of day-ahead-only skill; historical measurements may be revised. No retrospective weather accuracy is claimed because MET does not provide historical issued forecasts for this location. No synthetic confidence percentage or summed hourly quantile is displayed. **Local plant weather changes production and revenue, not the MEMO price benchmark.** Regional weather-conditioned price fitting, ENTSO-E fundamentals, ensembles and calibrated intervals remain future work.

Deployment: test migration `006` on an isolated Neon branch, run the migration runner with a maintenance connection, and grant the runtime role SELECT/INSERT/UPDATE on `forecast_settings` and SELECT/INSERT on `forecast_runs` as in `db/runtime-permissions.sql`. Keep maintenance credentials out of Vercel. Seed only verified plant coordinates; do not infer DC capacity from inverter AC nameplates. `npm run test:forecast` covers cutoffs, DST, missing readings, official prices, units, contract losses, weather timestamps, authorization, owner isolation, cache reads and retry behavior. An API outage leaves saved estimates readable with their issuance time; forecasts older than 24 hours or with changed settings are marked stale.

Sources: [MEMO hourly prices](https://dam-data.memo.mk/index.php?action=auction-by-hour&lang=en), [MET Norway variables and sources](https://docs.api.met.no/doc/locationforecast/datamodel.html), [MET terms](https://docs.api.met.no/doc/TermsOfService), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [Haurwitz](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.clearsky.haurwitz.html), [Kasten–Czeplak cloud relationship and its limitations](https://journals.ametsoc.org/view/journals/apme/63/2/JAMC-D-23-0078.1.xml), [Open-Meteo API](https://open-meteo.com/en/docs), [commercial access](https://open-meteo.com/en/pricing), [PVWatts DC equation](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.pvsystem.pvwatts_dc.html). Weather-source attribution remains required when displaying results.
