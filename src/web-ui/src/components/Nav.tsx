import { Bot, SquareTerminal, Tent } from 'lucide-react'
import { Link } from 'wouter'

import { Button } from './ui/button.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js'

export function Nav() {
  return (
      <aside className="inset-y fixed left-0 z-20 flex h-full flex-col">
      <div className="p-2">
        <Button aria-label="Home" asChild size="icon" variant="outline">
            <Link to="/">
            <Tent className="size-5 fill-foreground" />
            </Link>
        </Button>
      </div>
      <nav className="grid gap-1 p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Playground"
              className="rounded-lg bg-muted"
              size="icon"
              variant="ghost"
            >
              <SquareTerminal className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={5}>
            Playground
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Models"
              className="rounded-lg"
              size="icon"
              variant="ghost"
            >
              <Bot className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={5}>
            Models
          </TooltipContent>
        </Tooltip>
      </nav>
    </aside>
  )
}

