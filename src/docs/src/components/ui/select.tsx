import * as React from 'react';
import { ChevronDownIcon } from 'lucide-react';

import { cn } from '../../lib/utils';

const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      className={cn(
        'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none',
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
    <ChevronDownIcon className="absolute right-3 top-3 h-4 w-4 opacity-50 pointer-events-none" />
  </div>
));
Select.displayName = 'Select';

export { Select };
