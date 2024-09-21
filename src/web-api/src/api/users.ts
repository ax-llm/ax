import type { GetMeRes, GetUserRes } from '@/types/users';
import type { HandlerContext } from '@/util';
import type { Context } from 'hono';

import { setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { sign } from 'hono/jwt';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

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
      message: Boolean(process.env.NO_AUTH) ? 'no-auth' : 'unauthenticated'
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
        message: Boolean(process.env.NO_AUTH) ? 'no-auth' : 'unauthenticated'
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

export const createUserHandler =
  (hc: Readonly<HandlerContext>) => async (c: Context) => {
    const form = await c.req.formData();
    const email = form.get('email') as string;

    z.string().email().parse(email);

    const user = await hc.db.collection<User>('users').findOneAndUpdate(
      { email },
      {
        $set: {
          createdAt: new Date(),
          email,
          emailVerified: false,
          name: email.substring(0, email.indexOf('@')),
          picture: ''
        }
      },
      { returnDocument: 'after', upsert: true }
    );

    if (!user) {
      throw new Error('User not found: ' + email);
    }

    const oneMonthSeconds = 60 * 60 * 24 * 30;
    const token = await sign(
      {
        aud: 'ax:llm:auth',
        exp: Math.floor(Date.now() / 1000) + oneMonthSeconds,
        sub: user._id.toHexString()
      },
      process.env.APP_SECRET
    );

    const isProd = process.env.NODE_ENV === 'production';

    setCookie(c, 'ax', token, {
      httpOnly: true,
      maxAge: oneMonthSeconds,
      path: '/api',
      secure: !!isProd
    });

    return c.redirect(process.env.PUBLIC_URL);
  };
