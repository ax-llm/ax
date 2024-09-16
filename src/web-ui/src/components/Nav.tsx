import { /*Bot, SquareTerminal,*/ Tent } from 'lucide-react';
import { Link } from 'wouter';

import { Button } from './ui/button.js';
import { CurrentUserHoverCard } from './users/UserHoverCard.js';
// import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js';

//className="inset-y fixed left-0 z-20 flex h-full flex-col"
export function Nav() {
  return (
    <aside className="flex items-center justify-between p-4 gap-4 shadow mb-2 rounded-b-xl w-full bg-background/30">
      <div>
        <div className="flex items-center text-md text-indigo-900 gap-1 font-medium">
          <Button
            aria-label="Home"
            asChild
            className="hover:bg-transparent"
            size="icon"
            variant="ghost"
          >
            <Link to="/">
              <Tent
                className="stroke-indigo-500 hover:stroke-indigo-600"
                size={25}
              />
            </Link>
          </Button>
          <Link to="/">
            <span className="font-extrabold">Rome</span>
          </Link>
          <span>| Chat workspace for humans and agents</span>
        </div>
      </div>

      <CurrentUserHoverCard />

      {/* <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Playground"
            className="rounded-lg bg-muted"
            size="icon"
            variant="ghost"
          >
            <SquareTerminal />
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
            <Bot />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={5}>
          Models
        </TooltipContent>
      </Tooltip> */}
    </aside>
  );
}
