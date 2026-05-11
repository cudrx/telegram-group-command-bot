import { localizationConfig } from '../config/runtime/index.js';

const MOSCOW_TIME_ZONE = localizationConfig.moscowTimeZone;

export function formatMoscowCurrentDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hourCycle: 'h23'
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return `${byType.get('weekday')}, ${byType.get('day')} ${byType.get('month')} ${byType.get('year')}, ${byType.get('hour')}:${byType.get('minute')} Moscow time`;
}
