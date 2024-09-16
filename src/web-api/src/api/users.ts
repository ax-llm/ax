import type { GetMeRes, GetUserRes } from '@/types/users';
import type { HandlerContext } from '@/util';
import type { Context } from 'hono';

import { HTTPException } from 'hono/http-exception';
import { ObjectId } from 'mongodb';

import type { User } from './types.js';

export const getUser = async (
  hc: Readonly<HandlerContext>,
  c: Readonly<Context>
) => {
  const userId = c.get('userId');

  const user = await hc.db.collection<User>('users').findOne({
    _id: userId
  });

  if (!user) {
    throw new HTTPException(401, {
      cause: new Error('user not found'),
      message: 'unauthorized'
    });
  }
  return user;
};

export const getMeHandler =
  (hc: Readonly<HandlerContext>) => async (c: Context) => {
    const userId = c.get('userId');

    const user = await hc.db.collection<User>('users').findOne<GetMeRes>(
      {
        _id: userId
      },
      {
        projection: {
          _id: 0,
          id: '$_id',
          name: 1,
          picture: 1
        }
      }
    );

    if (!user) {
      throw new HTTPException(401, {
        cause: new Error('user not found'),
        message: 'unauthorized'
      });
    }

    return c.json<GetMeRes>(user);
  };

export const getUserHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    const { userId } = c.req.param();

    const user = await hc.db.collection<User>('users').findOne<GetUserRes>(
      { _id: new ObjectId(userId) },
      {
        projection: {
          _id: 0,
          id: '$_id',
          name: 1,
          picture: 1
        }
      }
    );

    if (!user) {
      throw new Error('User not found: ' + userId);
    }

    return c.json(user);
  };
