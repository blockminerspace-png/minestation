import 'ws';

declare module 'ws' {
  interface WebSocket {
    /** Ping/pong do servidor (atribuído em runtime). */
    isAlive?: boolean;
  }
}
