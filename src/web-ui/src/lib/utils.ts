import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const timeSince = (dateValue: Date): string => {
  const date = new Date(dateValue);
  const now = new Date();
  const secondsPast = (now.getTime() - date.getTime()) / 1000;

  if (secondsPast < 0) {
    return 'in the future';
  } else if (secondsPast < 60) {
    return `${Math.round(secondsPast)} seconds ago`;
  } else if (secondsPast < 3600) {
    return `${Math.round(secondsPast / 60)} minutes ago`;
  } else if (secondsPast < 86400) {
    return `${Math.round(secondsPast / 3600)} hours ago`;
  } else if (secondsPast >= 86400) {
    const days = Math.round(secondsPast / 86400);
    return `${days} days ago`;
  }

  // As a fallback, in case of any unexpected result.
  return 'some time ago';
};

export const debounce = <T extends (...args: any[]) => unknown>(
  func: T,
  waitFor: number
) => {
  let timeout: number | undefined;

  return (...args: Parameters<T>): void => {
    const later = () => {
      clearTimeout(timeout);
      timeout = undefined;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = window.setTimeout(later, waitFor);
  };
};

export const simpleHash = (obj: Record<string, unknown>) => {
  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};
