import type { HandlerContext } from '@/util';

import { EncryptJWT, jwtDecrypt } from 'jose';

export const encryptData = async (
  hc: Readonly<HandlerContext>,
  apiKey: string,
  audience: string
) => {
  return await new EncryptJWT()
    .setProtectedHeader({ alg: 'dir', enc: 'A128CBC-HS256', typ: 'JWT' })
    .setIssuer('ax:data')
    .setAudience(audience)
    .setSubject(apiKey)
    .setIssuedAt()
    .encrypt(hc.dataSecret);
};

export const decryptData = async (
  hc: Readonly<HandlerContext>,
  apiKey: string,
  audience: string
) => {
  return await jwtDecrypt(apiKey, hc.dataSecret, {
    audience,
    issuer: 'ax:data'
  });
};
