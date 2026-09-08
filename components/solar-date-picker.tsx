'use client';

import {useState} from 'react';
import {format, subDays} from 'date-fns';
import {mk} from 'date-fns/locale/mk';
import {CalendarDays, ChevronDown, Check} from 'lucide-react';
import {Calendar} from '@/components/ui/calendar';
import {Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger} from '@/components/ui/popover';
import {localDate} from '@/lib/energy';

// Calendar dates are local civil dates; parsing an ISO UTC instant can shift the day.
function calendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function SolarDatePicker({value, onChange, max, label = 'Датум за преглед'}: {
  value: string;
  onChange: (value: string) => void;
  max?: string;
  label?: string;
}) {
  const selected = calendarDate(value);
  const today = calendarDate(localDate());
  const yesterday = subDays(today, 1);
  const latest = max ? calendarDate(max) : undefined;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(selected);
  const choose = (date: Date) => {
    if (latest && date > latest) return;
    onChange(format(date, 'yyyy-MM-dd'));
    setOpen(false);
  };

  return <Popover open={open} onOpenChange={next => {
    if (next) setMonth(selected);
    setOpen(next);
  }}>
    <PopoverTrigger className="solar-date-trigger" aria-label={`${label}: ${format(selected, 'd MMMM yyyy', {locale: mk})}`}>
      <span className="solar-date-icon"><CalendarDays size={17}/></span>
      <span>{format(selected, 'dd MMM yyyy', {locale: mk})}</span>
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
        startMonth={new Date(2023, 0, 1)}
        endMonth={latest ?? new Date(Math.max(today.getFullYear(), selected.getFullYear()) + 1, 11, 31)}
        disabled={latest ? {after: latest} : undefined}
        labels={{
          labelPrevious: () => 'Претходен месец',
          labelNext: () => 'Следен месец',
          labelMonthDropdown: () => 'Избери месец',
          labelYearDropdown: () => 'Избери година',
          labelGrid: date => format(date, 'MMMM yyyy', {locale: mk}),
          labelDayButton: (date, modifiers) => `${format(date, 'EEEE, d MMMM yyyy', {locale: mk})}${modifiers.today ? ', денес' : ''}${modifiers.selected ? ', избран датум' : ''}`,
        }}
        formatters={{
          formatMonthDropdown: date => format(date, 'MMMM', {locale: mk}),
          formatWeekdayName: date => ['Нед', 'Пон', 'Вто', 'Сре', 'Чет', 'Пет', 'Саб'][date.getDay()],
        }}
      />
      <div className="solar-date-footer"><span className="solar-today-marker"/>Денес<span>Изборот се применува веднаш</span></div>
    </PopoverContent>
  </Popover>;
}
