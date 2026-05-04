import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: number;
    auth?: { kind: 'jwt' | 'session'; jti?: string; exp?: number };
  }
}
