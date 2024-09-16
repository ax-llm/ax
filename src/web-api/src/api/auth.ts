import type { HandlerContext } from '@/util';
import type { Context, MiddlewareHandler } from 'hono';

import { setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { sign } from 'hono/jwt';
import { ObjectId } from 'mongodb';

import type { User } from './types.js';

export const googleOAuthHandler =
  (hc: Readonly<HandlerContext>) => async (c: Context) => {
    const googleUser = c.get('user-google');

    if (!googleUser) {
      throw new Error('Google user not found');
    }

    const user = await hc.db.collection<User>('users').findOneAndUpdate(
      { email: googleUser.email },
      {
        $set: {
          emailVerified: googleUser.verified_email,
          name: googleUser.name,
          picture: googleUser.picture,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date(),
          email: googleUser.email
        }
      },
      {
        returnDocument: 'after',
        upsert: true
      }
    );

    if (!user) {
      throw new Error('User not found or created');
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

declare module 'hono' {
  interface ContextVariableMap {
    userId: ObjectId;
  }
}

// auth middleware
export const auth = (): MiddlewareHandler => async (c, next) => {
  const payload = c.get('jwtPayload');

  if (!payload || typeof payload.sub !== 'string') {
    throw new HTTPException(401, {
      cause: new Error('no auth token found'),
      message: 'unauthorized'
    });
  }

  c.set('userId', new ObjectId(payload.sub as string));
  await next();
};
