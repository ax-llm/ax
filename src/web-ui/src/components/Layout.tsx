import { type PropsWithChildren } from 'react'

import { Nav } from './Nav.js'
import { Toaster } from './ui/toaster.js'
import { TooltipProvider,  } from './ui/tooltip.js'


export const Layout = ({ children }: Readonly<PropsWithChildren>) => {
  return (
    <div className="bg-muted/40 grid h-screen w-full pl-[56px]">
    <TooltipProvider>
    <Nav />
    <main>
    {children}
    <Toaster />
    </main>
    </TooltipProvider>
  </div>
  )
}
