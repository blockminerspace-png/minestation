import type { Server } from 'socket.io';

let stackIo: Server | null = null;

export function setStackIo(io: Server | null): void {
  stackIo = io;
}

export function getStackIo(): Server | null {
  return stackIo;
}
