const MOSCOW_TIME_ZONE = 'Europe/Moscow';

export function formatMoscowCurrentDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset'
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return [
    `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`,
    `T${byType.get('hour')}:${byType.get('minute')}:${byType.get('second')}`,
    formatOffset(byType.get('timeZoneName') ?? 'GMT+3')
  ].join('');
}

function formatOffset(value: string): string {
  if (value === 'GMT') return '+00:00';

  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(value);

  if (!match) return '+03:00';

  const sign = match[1] ?? '+';
  const hours = match[2] ?? '03';
  const minutes = match[3] ?? '00';

  return `${sign}${hours.padStart(2, '0')}:${minutes}`;
}
