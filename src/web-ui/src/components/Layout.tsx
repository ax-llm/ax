import { type PropsWithChildren } from 'react';

import { Nav } from './Nav.js';
import { Toaster } from './ui/toaster.js';
import { TooltipProvider } from './ui/tooltip.js';

export const Layout = ({ children }: Readonly<PropsWithChildren>) => {
  return (
    <div className="w-full p-2 pt-0 min-h-[100vh]">
      <TooltipProvider>
        <Nav />
        <main>
          {children}
          <Toaster />
        </main>
      </TooltipProvider>
    </div>
  );
};
