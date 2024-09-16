import { useCurrentUser } from '@/components/hooks/useUser.js';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from '@/components/ui/hover-card';

import { UserAvatar } from './UserCard.js';

export const CurrentUserHoverCard = () => {
  const { user } = useCurrentUser();

  if (!user) return null;
  return <UserHoverCard user={user} />;
};

interface UserHoverCardProps {
  user: GetUserRes;
}

export function UserHoverCard({ user }: UserHoverCardProps) {
  return (
    <HoverCard openDelay={100}>
      <HoverCardTrigger asChild>
        <div className="cursor-pointer">
          <UserAvatar user={user} />
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-60 space-y-2 p-0 bg-white mx-4">
        <UserInfo user={user} />
      </HoverCardContent>
    </HoverCard>
  );
}

type GetUserRes = {
  id: string;
  name: string;
  picture?: string;
};

export const UserInfo = ({ user }: { user: GetUserRes }) => {
  return (
    <div className="w-full max-w-md border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 p-4 flex items-center gap-2">
        <UserAvatar user={user} />
        <h4 className="text-md font-semibold">{user.name}</h4>
      </div>
    </div>
  );
};
