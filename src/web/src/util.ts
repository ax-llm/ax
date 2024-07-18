import { format, formatDistanceToNow, parseISO } from 'date-fns';

export function formatFriendlyDate(dateInput: Readonly<string | Date>): string {
  const date = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
  const now = new Date();
  const diffDays = (now.getTime() - date.getTime()) / (1000 * 3600 * 24);

  if (diffDays < 30) {
    // Use "time ago" format for dates less than 30 days old
    return formatDistanceToNow(date, { addSuffix: true });
  } else if (now.getFullYear() === date.getFullYear()) {
    // Use "24 March" format for dates within the current year
    return format(date, 'dd MMMM');
  } else {
    // Use "24 Dec 2015" for older dates
    return format(date, 'dd MMM yyyy');
  }
}
