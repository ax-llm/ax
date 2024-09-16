import { GetMeRes } from '@/types/users';
import useSWR from 'swr';

export const useUserShow = (userId: null | string) => {
  const { data, isLoading } = useSWR<GetMeRes>(
    userId ? `/a/agents/${userId}` : null
  );

  return {
    isLoading,
    user: data
  };
};

export const useCurrentUser = (showAuth?: boolean) => {
  const { data, error, isLoading } = useSWR<GetMeRes>('/a/me', {
    errorRetryCount: 0,
    refreshInterval: 900000,
    revalidateOnFocus: false,
    ...(showAuth === true ? {} : { onError: () => {} })
  });

  return {
    isError: error !== undefined,
    isLoading,
    user: data
  };
};
