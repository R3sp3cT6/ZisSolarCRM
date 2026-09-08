'use client';
import {t} from '@/lib/language';
import {useLanguage} from '@/components/language-switch';


import {useState} from 'react';
import {addDays, addMonths, addYears, format, subDays} from 'date-fns';
import {mk} from 'date-fns/locale/mk';
import {enGB} from 'date-fns/locale/en-GB';
import {CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Check} from 'lucide-react';
import {Calendar} from '@/components/ui/calendar';
import {Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger} from '@/components/ui/popover';
import {localDate} from '@/lib/energy';

// Calendar dates are local civil dates; parsing an ISO UTC instant can shift the day.
function calendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function SolarDatePicker({value, onChange, max, productionDays, step = 'day', label = t("Датум за преглед")}: {
  value: string;
  onChange: (value: string) => void;
  max?: string;
  productionDays?: string[];
  step?: 'day' | 'month' | 'year';
  label?: string;
}) {const language=useLanguage();
  const calendarLocale=language==='en'?enGB:mk;
  const selected = calendarDate(value);
  const today = calendarDate(localDate());
  const yesterday = subDays(today, 1);
  const earliest = calendarDate('2023-01-01');
  const latest = calendarDate(max ?? '2099-12-31');
  const moveDate = step === 'year' ? addYears : step === 'month' ? addMonths : addDays;
  const previous = moveDate(selected, -1);
  const next = moveDate(selected, 1);
  const previousLabel = step === 'year' ? t("Претходна година") : step === 'month' ? t("Претходен месец") : t("Претходен ден");
  const nextLabel = step === 'year' ? t("Следна година") : step === 'month' ? t("Следен месец") : t("Следен ден");
  const displayFormat = step === 'year' ? 'yyyy' : step === 'month' ? 'MMM yyyy' : 'dd MMM yyyy';
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(selected);
  const choose = (date: Date) => {
    if (date < earliest || date > latest) return;
    onChange(format(date, 'yyyy-MM-dd'));
    setOpen(false);
  };

  return <span className="solar-date-navigation" role="group" aria-label={label}>
    <button type="button" className="solar-date-step" aria-label={previousLabel} title={previousLabel}
      disabled={previous < earliest} onClick={() => choose(previous)}><ChevronLeft size={18}/></button>
    <Popover open={open} onOpenChange={next => {
    if (next) setMonth(selected);
    setOpen(next);
  }}>
    <PopoverTrigger className="solar-date-trigger" aria-label={`${label}: ${format(selected, 'd MMMM yyyy', {locale: calendarLocale})}`}>
      <span className="solar-date-icon"><CalendarDays size={17}/></span>
      <span className="solar-date-value" aria-live="polite" aria-atomic="true">{t(format(selected, displayFormat, {locale: calendarLocale}))}</span>
      <ChevronDown className="solar-date-chevron" size={15}/>
    </PopoverTrigger>
    <PopoverContent className="solar-date-popover" align="end" sideOffset={8}>
      <div className="solar-date-heading">
        <PopoverTitle>{t("Изберете датум")}</PopoverTitle>
        <PopoverDescription>{t(format(selected, 'EEEE, d MMMM yyyy', {locale: calendarLocale}))}</PopoverDescription>
      </div>
      <div className="solar-date-shortcuts">
        {t([{date: today, title: 'Денес'}, {date: yesterday, title: 'Вчера'}].map(item =>
          <button key={item.title} type="button" disabled={!!latest && item.date > latest}
            data-selected={value === format(item.date, 'yyyy-MM-dd')}
            onClick={() => choose(item.date)}>
            {t(value === format(item.date, 'yyyy-MM-dd') && <Check size={14}/>)}{t(item.title)}
          </button>
        ))}
      </div>
      <Calendar
        className="solar-calendar"
        mode="single"
        required
        modifiers={{production: (date: Date) => productionDays?.includes(format(date, 'yyyy-MM-dd')) ?? false}}
        modifiersClassNames={{production: 'solar-production-day'}}
        selected={selected}
        onSelect={choose}
        month={month}
        onMonthChange={setMonth}
        today={today}
        locale={calendarLocale}
        weekStartsOn={1}
        fixedWeeks
        autoFocus
        captionLayout="dropdown"
        startMonth={earliest}
        endMonth={max ? latest : new Date(Math.min(2099, Math.max(today.getFullYear(), selected.getFullYear()) + 1), 11, 31)}
        disabled={{before: earliest, after: latest}}
        labels={{
          labelPrevious: () => t("Претходен месец"),
          labelNext: () => t("Следен месец"),
          labelMonthDropdown: () => t("Избери месец"),
          labelYearDropdown: () => t("Избери година"),
          labelGrid: date => format(date, 'MMMM yyyy', {locale: calendarLocale}),
          labelDayButton: (date, modifiers) => `${format(date, 'EEEE, d MMMM yyyy', {locale: calendarLocale})}${modifiers.production ? t(", има забележано производство") : ''}${modifiers.today ? t(", денес") : ''}${modifiers.selected ? t(", избран датум") : ''}`,
        }}
        formatters={{
          formatMonthDropdown: date => format(date, 'MMMM', {locale: calendarLocale}),
          formatWeekdayName: date => [t("Нед"), t("Пон"), t("Вто"), t("Сре"), t("Чет"), t("Пет"), t("Саб")][date.getDay()],
        }}
      />
      <div className="solar-date-footer"><span className="solar-today-marker"/>{t("Денес")}{t(productionDays !== undefined && <><i className="solar-production-marker"/>{t("Производство")}</>)}</div>{t(productionDays !== undefined && <p className="solar-calendar-note">{t("Без ознака: нема потврдено производство во преземените податоци.")}</p>)}
    </PopoverContent>
    </Popover>
    <button type="button" className="solar-date-step" aria-label={nextLabel} title={nextLabel}
      disabled={next > latest} onClick={() => choose(next)}><ChevronRight size={18}/></button>
  </span>;
}
