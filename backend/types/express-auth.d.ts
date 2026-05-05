import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: number;
    /** Definido pelo middleware `isAdmin` após `loadAdminGateContext`. */
    isSuperAdmin?: boolean;
    adminPermissions?: unknown;
    auth?: { kind: 'jwt' | 'session'; jti?: string; exp?: number };
  }
}
