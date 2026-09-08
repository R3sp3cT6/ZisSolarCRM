'use client';

import {useState} from 'react';
import {addDays, addMonths, addYears, format, subDays} from 'date-fns';
import {mk} from 'date-fns/locale/mk';
import {CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Check} from 'lucide-react';
import {Calendar} from '@/components/ui/calendar';
import {Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger} from '@/components/ui/popover';
import {localDate} from '@/lib/energy';

// Calendar dates are local civil dates; parsing an ISO UTC instant can shift the day.
function calendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function SolarDatePicker({value, onChange, max, productionDays, step = 'day', label = 'Датум за преглед'}: {
  value: string;
  onChange: (value: string) => void;
  max?: string;
  productionDays?: string[];
  step?: 'day' | 'month' | 'year';
  label?: string;
}) {
  const selected = calendarDate(value);
  const today = calendarDate(localDate());
  const yesterday = subDays(today, 1);
  const earliest = calendarDate('2023-01-01');
  const latest = calendarDate(max ?? '2099-12-31');
  const moveDate = step === 'year' ? addYears : step === 'month' ? addMonths : addDays;
  const previous = moveDate(selected, -1);
  const next = moveDate(selected, 1);
  const previousLabel = step === 'year' ? 'Претходна година' : step === 'month' ? 'Претходен месец' : 'Претходен ден';
  const nextLabel = step === 'year' ? 'Следна година' : step === 'month' ? 'Следен месец' : 'Следен ден';
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
    <PopoverTrigger className="solar-date-trigger" aria-label={`${label}: ${format(selected, 'd MMMM yyyy', {locale: mk})}`}>
      <span className="solar-date-icon"><CalendarDays size={17}/></span>
      <span className="solar-date-value" aria-live="polite" aria-atomic="true">{format(selected, displayFormat, {locale: mk})}</span>
      <ChevronDown className="solar-date-chevron" size={15}/>
    </PopoverTrigger>
    <PopoverContent className="solar-date-popover" align="end" sideOffset={8}>
      <div className="solar-date-heading">
        <PopoverTitle>Изберете датум</PopoverTitle>
        <PopoverDescription>{format(selected, 'EEEE, d MMMM yyyy', {locale: mk})}</PopoverDescription>
      </div>
      <div className="solar-date-shortcuts">
        {[{date: today, title: 'Денес'}, {date: yesterday, title: 'Вчера'}].map(item =>
          <button key={item.title} type="button" disabled={!!latest && item.date > latest}
            data-selected={value === format(item.date, 'yyyy-MM-dd')}
            onClick={() => choose(item.date)}>
            {value === format(item.date, 'yyyy-MM-dd') && <Check size={14}/>}{item.title}
          </button>
        )}
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
        locale={mk}
        weekStartsOn={1}
        fixedWeeks
        autoFocus
        captionLayout="dropdown"
        startMonth={earliest}
        endMonth={max ? latest : new Date(Math.min(2099, Math.max(today.getFullYear(), selected.getFullYear()) + 1), 11, 31)}
        disabled={{before: earliest, after: latest}}
        labels={{
          labelPrevious: () => 'Претходен месец',
          labelNext: () => 'Следен месец',
          labelMonthDropdown: () => 'Избери месец',
          labelYearDropdown: () => 'Избери година',
          labelGrid: date => format(date, 'MMMM yyyy', {locale: mk}),
          labelDayButton: (date, modifiers) => `${format(date, 'EEEE, d MMMM yyyy', {locale: mk})}${modifiers.production ? ', има забележано производство' : ''}${modifiers.today ? ', денес' : ''}${modifiers.selected ? ', избран датум' : ''}`,
        }}
        formatters={{
          formatMonthDropdown: date => format(date, 'MMMM', {locale: mk}),
          formatWeekdayName: date => ['Нед', 'Пон', 'Вто', 'Сре', 'Чет', 'Пет', 'Саб'][date.getDay()],
        }}
      />
      <div className="solar-date-footer"><span className="solar-today-marker"/>Денес{productionDays !== undefined && <><i className="solar-production-marker"/>Производство</>}</div>{productionDays !== undefined && <p className="solar-calendar-note">Без ознака: нема потврдено производство во преземените податоци.</p>}
    </PopoverContent>
    </Popover>
    <button type="button" className="solar-date-step" aria-label={nextLabel} title={nextLabel}
      disabled={next > latest} onClick={() => choose(next)}><ChevronRight size={18}/></button>
  </span>;
}
