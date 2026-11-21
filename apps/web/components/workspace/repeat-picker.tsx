'use client';
import * as React from 'react';
import { Repeat } from 'lucide-react';
import {
  describeRecurrence,
  MAX_SERIES_OCCURRENCES,
  type RecurrenceInput,
} from '@sampledge/contracts';
import { Field, Input, cn } from '@sampledge/ui';

const DAYS = [
  { d: 1, label: 'M', name: 'Monday' },
  { d: 2, label: 'T', name: 'Tuesday' },
  { d: 3, label: 'W', name: 'Wednesday' },
  { d: 4, label: 'T', name: 'Thursday' },
  { d: 5, label: 'F', name: 'Friday' },
  { d: 6, label: 'S', name: 'Saturday' },
  { d: 0, label: 'S', name: 'Sunday' },
];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const select =
  'h-10 w-full rounded-md border border-border bg-surface-sunken px-2 text-body text-text';

type Preset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'custom';

function presetOf(r: RecurrenceInput | null, weekday: number): Preset {
  if (!r) return 'none';
  const interval = r.interval ?? 1;
  const days = r.weekdays ?? [];
  if (r.frequency === 'daily' && interval === 1) return 'daily';
  if (r.frequency === 'monthly' && interval === 1) return 'monthly';
  if (r.frequency === 'weekly') {
    const only = days.length === 0 || (days.length === 1 && days[0] === weekday);
    if (interval === 1 && days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)))
      return 'weekdays';
    if (only && interval === 1) return 'weekly';
    if (only && interval === 2) return 'biweekly';
  }
  return 'custom';
}

/**
 * "Repeat" for a meeting: common choices in one menu, a custom rule (every N days, weeks on
 * chosen days, or months), and when the series ends. Shows the rule in words.
 */
export function RepeatPicker({
  start,
  timeZone,
  value,
  onChange,
}: {
  /** The first meeting's start (its weekday and day of month shape the choices). */
  start: Date;
  timeZone: string;
  value: RecurrenceInput | null;
  onChange: (r: RecurrenceInput | null) => void;
}) {
  const valid = !Number.isNaN(start.getTime());
  const weekday = valid ? start.getDay() : 1;
  const dom = valid ? start.getDate() : 1;
  const preset = presetOf(value, weekday);
  const [custom, setCustom] = React.useState(preset === 'custom');
  const shown: Preset = custom && value ? 'custom' : preset;
  const ends = value?.endsAfter ? 'after' : value?.endsOn ? 'on' : 'never';
  const keepEnd = (r: RecurrenceInput): RecurrenceInput => ({
    ...r,
    ...(value?.endsAfter ? { endsAfter: value.endsAfter } : {}),
    ...(value?.endsOn ? { endsOn: value.endsOn } : {}),
  });

  const pick = (p: Preset) => {
    setCustom(p === 'custom');
    if (p === 'none') return onChange(null);
    if (p === 'custom')
      return onChange(keepEnd({ frequency: 'weekly', interval: 1, weekdays: [weekday] }));
    const map: Record<Exclude<Preset, 'none' | 'custom'>, RecurrenceInput> = {
      daily: { frequency: 'daily', interval: 1 },
      weekdays: { frequency: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] },
      weekly: { frequency: 'weekly', interval: 1 },
      biweekly: { frequency: 'weekly', interval: 2 },
      monthly: { frequency: 'monthly', interval: 1 },
    };
    onChange(keepEnd(map[p]));
  };

  const inThreeMonths = () => {
    const d = new Date(valid ? start : Date.now());
    d.setMonth(d.getMonth() + 3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const setEnd = (kind: 'never' | 'after' | 'on') => {
    if (!value) return;
    const { endsAfter: _a, endsOn: _o, ...rest } = value;
    onChange(
      kind === 'after'
        ? { ...rest, endsAfter: 10 }
        : kind === 'on'
          ? { ...rest, endsOn: inThreeMonths() }
          : rest,
    );
  };

  return (
    <div className="space-y-3" data-testid="repeat-picker">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Repeat" htmlFor="mt-repeat">
          <select
            id="mt-repeat"
            className={select}
            value={shown}
            onChange={(e) => pick(e.target.value as Preset)}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday (Mon–Fri)</option>
            <option value="weekly">Weekly on {DAY_NAMES[weekday]}</option>
            <option value="biweekly">Every 2 weeks on {DAY_NAMES[weekday]}</option>
            <option value="monthly">Monthly on day {dom}</option>
            <option value="custom">Custom…</option>
          </select>
        </Field>
        {value ? (
          <Field label="Ends" htmlFor="mt-ends">
            <div className="flex gap-2">
              <select
                id="mt-ends"
                className={select}
                value={ends}
                onChange={(e) => setEnd(e.target.value as 'never' | 'after' | 'on')}
              >
                <option value="never">Never</option>
                <option value="on">On date</option>
                <option value="after">After</option>
              </select>
              {ends === 'on' ? (
                <Input
                  type="date"
                  aria-label="Last date"
                  value={value.endsOn ?? ''}
                  onChange={(e) => onChange({ ...value, endsOn: e.target.value || undefined })}
                />
              ) : ends === 'after' ? (
                <Input
                  type="number"
                  aria-label="Number of meetings"
                  min={2}
                  max={MAX_SERIES_OCCURRENCES}
                  value={value.endsAfter ?? 10}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      endsAfter: Math.min(
                        MAX_SERIES_OCCURRENCES,
                        Math.max(2, Number(e.target.value) || 2),
                      ),
                    })
                  }
                />
              ) : null}
            </div>
          </Field>
        ) : null}
      </div>

      {value && shown === 'custom' ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-sunken/60 p-3">
          <Field label="Every" htmlFor="mt-interval">
            <Input
              id="mt-interval"
              type="number"
              min={1}
              max={30}
              className="w-20"
              value={value.interval ?? 1}
              onChange={(e) =>
                onChange({
                  ...value,
                  interval: Math.min(30, Math.max(1, Number(e.target.value) || 1)),
                })
              }
            />
          </Field>
          <Field label="Unit" htmlFor="mt-freq">
            <select
              id="mt-freq"
              className={cn(select, 'w-32')}
              value={value.frequency}
              onChange={(e) => {
                const frequency = e.target.value as RecurrenceInput['frequency'];
                onChange({
                  ...value,
                  frequency,
                  weekdays: frequency === 'weekly' ? (value.weekdays ?? [weekday]) : undefined,
                });
              }}
            >
              <option value="daily">days</option>
              <option value="weekly">weeks</option>
              <option value="monthly">months</option>
            </select>
          </Field>
          {value.frequency === 'weekly' ? (
            <div role="group" aria-label="On these days" className="flex gap-1">
              {DAYS.map((x) => {
                const days = value.weekdays?.length ? value.weekdays : [weekday];
                const on = days.includes(x.d);
                return (
                  <button
                    key={x.d}
                    type="button"
                    aria-label={x.name}
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? days.filter((d) => d !== x.d) : [...days, x.d];
                      if (next.length) onChange({ ...value, weekdays: next });
                    }}
                    className={cn(
                      'size-9 rounded-full border text-meta font-semibold transition-colors',
                      on
                        ? 'border-accent bg-accent text-accent-fg'
                        : 'border-border bg-surface text-text-muted hover:border-accent',
                    )}
                  >
                    {x.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {value && valid ? (
        <p
          className="flex items-center gap-1.5 text-meta text-text-muted"
          data-testid="repeat-summary"
        >
          <Repeat className="size-3.5" />
          {describeRecurrence(value, start.toISOString(), timeZone)}
        </p>
      ) : null}
    </div>
  );
}
