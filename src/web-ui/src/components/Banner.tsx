/* <Card className={cn(['w-full overflow-hidden'])}> */
//  <CardContent
//   className={cn(['p-6 md:p-10 flex flex-col justify-center w-full'])}
// >

import { CardContent } from './ui/card.js';

export const Banner = () => {
  return (
    <CardContent>
      <img
        alt="Ax Rome"
        className="h-[250px] w-full object-cover"
        src="/ax-r0me.webp"
      />
      <h1 className="text-3xl md:text-4xl font-bold mb-4 text-primary">ROME</h1>
      <p className="text-lg md:text-xl font-medium text-secondary-foreground">
        A chat workspace for humans and AI agents to work together to achieve
        extraordinary results.
      </p>
    </CardContent>
  );
};
