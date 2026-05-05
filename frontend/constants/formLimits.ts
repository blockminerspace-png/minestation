/** Alinhado com `supportTicketController` (`slice` no servidor). */
export const SUPPORT_TICKET_SUBJECT_MAX = 180;
export const SUPPORT_TICKET_MESSAGE_MAX = 8000;

/** Alinhado com `server.ts` → `POST /api/player-news/submit` (truncagem no servidor). */
export const PLAYER_NEWS_TEXT_MAX = 500;
export const PLAYER_NEWS_LINK_MAX = 2048;

/** Alinhado com `partnerYoutubeController` e `partnerYoutubeHelpers`. */
export const PARTNER_VIDEO_TITLE_MAX = 200;
export const PARTNER_VIDEO_YOUTUBE_URL_MAX = 500;
export const PARTNER_VIDEO_DESCRIPTION_MAX = 2000;
export const PARTNER_CHANNEL_URL_MAX = 500;
export const PARTNER_AVATAR_URL_MAX = 800;
/** Motivo ao recusar envio (`partnerYoutubeController`). */
export const PARTNER_REJECT_REASON_MAX = 500;

/** Alinhado com `POST/PUT /api/admin/transparency` em `server.ts`. */
export const TRANSPARENCY_TITLE_MAX = 300;
export const TRANSPARENCY_BODY_MAX = 8000;
export const TRANSPARENCY_LINK_MAX = 2048;
