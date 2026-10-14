'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_WEEKLY_RESET, type WeeklySchedule } from '@/lib/charts/quotaOverTime';

const STORAGE_KEY = 'claude-usage.weekly-reset';

/** Monday first, as the rest of the dashboard counts the week. The values are `Date.getDay`'s. */
const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `HH:MM`, the shape a time input reads and writes. */
function timeOf(schedule: WeeklySchedule): string {
  return `${pad(schedule.hour)}:${pad(schedule.minute)}`;
}

function parseTime(text: string): Pick<WeeklySchedule, 'hour' | 'minute'> | null {
  const match = /^(\d\d):(\d\d)$/.exec(text);
  if (match === null) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** Stored as the weekday digit and the time, `2 01:00`. */
function parseSchedule(text: string | null): WeeklySchedule | null {
  const match = text === null ? null : /^([0-6]) (\d\d:\d\d)$/.exec(text);
  const time = match === null ? null : parseTime(match[2]);
  if (match === null || time === null) {
    return null;
  }
  return { weekday: Number(match[1]), ...time };
}

/** The weekly reset this browser was last told, or the one observed in the quota history. */
export function useWeeklyReset(): [WeeklySchedule, (schedule: WeeklySchedule) => void] {
  const [schedule, setSchedule] = useState(DEFAULT_WEEKLY_RESET);

  useEffect(() => {
    try {
      const stored = parseSchedule(window.localStorage.getItem(STORAGE_KEY));
      if (stored !== null) {
        setSchedule(stored);
      }
    } catch {
      // A remembered reset is a convenience; losing it must never break the panel.
    }
  }, []);

  const choose = (next: WeeklySchedule): void => {
    setSchedule(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, `${next.weekday} ${timeOf(next)}`);
    } catch {
      // As above.
    }
  };
  return [schedule, choose];
}

export function WeeklyResetInput({
  schedule,
  onChange,
}: {
  schedule: WeeklySchedule;
  onChange: (schedule: WeeklySchedule) => void;
}) {
  return (
    <div className="reset-at" role="group" aria-label="weekly reset">
      <span>7d reset</span>
      <select
        className="seg stamp"
        aria-label="weekday"
        value={schedule.weekday}
        onChange={(event) => {
          onChange({ ...schedule, weekday: Number(event.target.value) });
        }}
      >
        {DAYS.map((day) => (
          <option key={day.value} value={day.value}>
            {day.label}
          </option>
        ))}
      </select>
      <input
        type="time"
        className="seg stamp"
        aria-label="time"
        value={timeOf(schedule)}
        onChange={(event) => {
          const time = parseTime(event.target.value);
          if (time !== null) {
            onChange({ ...schedule, ...time });
          }
        }}
      />
    </div>
  );
}
