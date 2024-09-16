import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal
} from '@/components/ui/dialog';
import { type PropsWithChildren, useEffect, useState } from 'react';
import { SWRConfig } from 'swr';
import { useSearch } from 'wouter';

import { Banner } from './Banner.js';
import { Button } from './ui/button.js';

const SigninDialog = ({
  onOpenChange,
  open
}: {
  onOpenChange: (arg0: boolean) => void;
  open: boolean;
  token?: string;
}) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogOverlay className="bg-indigo-500/70" />
    <DialogContent
      className="p-6 bg-white sm:rounded-xl border border-primary shadow-xl w-full"
      hideClose={true}
    >
      <Banner />

      <Button asChild className="bg-primary rounded-xl" size="xl">
        <a href="/api/p/auth/google">Sign-In with Google</a>
      </Button>
    </DialogContent>
  </Dialog>
);

export const Protected = ({
  children
}: PropsWithChildren<{ apiOnly?: boolean }>) => {
  const query = useSearch();

  const qs = new URLSearchParams(query);

  const [open, setOpen] = useState(false);
  const [token] = useState<string | undefined>(qs.get('token') ?? undefined);

  useEffect(() => {
    window.history.pushState({}, '', window.location.pathname);
    if (token) {
      setOpen(true);
    }
  }, [token]);

  const onDone = async (teamId?: string) => {
    if (teamId) {
      window.location.href = `/teams/${teamId}` + window.location.pathname;
    } else {
      window.history.pushState({}, '', window.location.pathname);
    }
    setOpen(false);
  };

  return (
    <SWRConfig
      value={{
        onError: (error) => {
          if (error.status === 401 || error.status === 403) {
            setOpen(true);
          }
        }
      }}
    >
      <SigninDialog onOpenChange={setOpen} open={open} token={token} />
      {children}
    </SWRConfig>
  );
};
