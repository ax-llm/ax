import { Avatar } from '@/components/ui/avatar.js';
import { AvatarFallback, AvatarImage } from '@/components/ui/avatar.js';
import { GetUserRes } from '@/types/users.js';

interface UserAvatarProps {
  user: GetUserRes;
}
export const UserAvatar = ({ user }: UserAvatarProps) => (
  <Avatar>
    <AvatarImage alt={user.name} className="grayscale" src={user.picture} />
    <AvatarFallback>{user.name?.slice(0, 2)}</AvatarFallback>
  </Avatar>
);
