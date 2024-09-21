import { Dialog, DialogContent, DialogOverlay } from '@/components/ui/dialog';
import { DialogTitle } from '@radix-ui/react-dialog';
import { type PropsWithChildren, useState } from 'react';
import { SWRConfig } from 'swr';

import { Banner } from './Banner.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';

const SigninDialog = ({
  emailOnly,
  onOpenChange,
  open
}: {
  emailOnly?: boolean;
  noAuth?: boolean;
  onOpenChange: (arg0: boolean) => void;
  open: boolean;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogOverlay className="bg-indigo-500/70" />
    <DialogContent
      className="p-6 bg-white sm:rounded-xl border border-primary shadow-xl w-full"
      hideClose={true}
    >
      <DialogTitle>
        <Banner />
      </DialogTitle>

      {emailOnly ? (
        <form
          action="/api/p/auth/email"
          className="space-y-4 w-full"
          method="post"
        >
          <Input
            className="text-xl w-full"
            name="email"
            placeholder="Enter your email"
            type="email"
          />
          <Button
            className="bg-primary rounded-xl w-full"
            size="xl"
            type="submit"
          >
            Sign-In with Email
          </Button>
        </form>
      ) : (
        <Button asChild className="bg-primary rounded-xl" size="xl">
          <a href="/api/p/auth/google">Sign-In with Google</a>
        </Button>
      )}
    </DialogContent>
  </Dialog>
);

export const Protected = ({
  children
}: PropsWithChildren<{ apiOnly?: boolean }>) => {
  const [open, setOpen] = useState(false);
  const [emailOnly, setEmailOnly] = useState(false);

  return (
    <SWRConfig
      value={{
        onError: (error) => {
          if (error.status === 401 || error.status === 403) {
            if (error.info === 'no-auth') {
              setEmailOnly(true);
            }
            setOpen(true);
          }
        }
      }}
    >
      <SigninDialog emailOnly={emailOnly} onOpenChange={setOpen} open={open} />
      {children}
    </SWRConfig>
  );
};
