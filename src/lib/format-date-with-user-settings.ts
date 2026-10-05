import { format } from 'date-fns';

function convertToDateFnsFormat(userFormat: string): string {
  return userFormat
    .replace(/YYYY/g, 'yyyy')
    .replace(/DD/g, 'dd')
    .replace(/AM/g, 'a')
    .replace(/PM/g, 'a');
}

export function formatDateWithUserSettings(
  date: Date | string,
  userTimeFormat?: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  const userFormat = userTimeFormat || 'MM-DD-YYYY HH:mm';
  const dateFnsFormat = convertToDateFnsFormat(userFormat);

  try {
    return format(dateObj, dateFnsFormat);
  } catch (error) {
    console.error('Date formatting error:', error);
    return dateObj.toISOString();
  }
}

export function formatDateOnlyWithUserSettings(
  date: Date | string,
  userTimeFormat?: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  const userFormat = userTimeFormat || 'MM-DD-YYYY HH:mm';
  const dateOnlyFormat = userFormat.split(' ')[0] || 'MM-DD-YYYY';
  const dateFnsFormat = convertToDateFnsFormat(dateOnlyFormat);

  try {
    return format(dateObj, dateFnsFormat);
  } catch (error) {
    console.error('Date formatting error:', error);
    return dateObj.toISOString().split('T')[0];
  }
}

export function formatTimeOnlyWithUserSettings(
  date: Date | string,
  userTimeFormat?: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  const userFormat = userTimeFormat || 'MM-DD-YYYY HH:mm';
  const timeParts = userFormat.split(' ').slice(1);
  const timeOnlyFormat = timeParts.length > 0 ? timeParts.join(' ') : 'HH:mm';
  const dateFnsFormat = convertToDateFnsFormat(timeOnlyFormat);

  try {
    return format(dateObj, dateFnsFormat);
  } catch (error) {
    console.error('Time formatting error:', error);
    return dateObj.toTimeString().split(' ')[0];
  }
}
