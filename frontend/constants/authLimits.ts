/**
 * Cadastro e login: mesmo teto que `SIGNUP_EMAIL_MAX_TOTAL` / `EMAIL_ADDRESS_MAX_LENGTH` no servidor.
 */
export const AUTH_SIGNUP_EMAIL_MAX = 35;
export const AUTH_LOGIN_RECOVERY_EMAIL_MAX = 35;
export const AUTH_PASSWORD_MIN = 8;
/** Igual a `PASSWORD_MAX` em `registrationValidation.ts` (servidor). */
export const AUTH_PASSWORD_MAX = 10;
export const AUTH_USERNAME_MIN = 3;
/** Igual a `USERNAME_MAX` no servidor. */
export const AUTH_USERNAME_MAX = 35;
/** Igual a `REFERRAL_CODE_MAX` no servidor. */
export const AUTH_REFERRAL_MAX = 40;
