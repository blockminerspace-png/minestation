import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';

type StackSocketState = {
  socket: Socket | null;
  connected: boolean;
  lastMiningTickAt: number | null;
  connect: (baseUrl: string) => void;
  disconnect: () => void;
};

export const useStackSocketStore = create<StackSocketState>((set, get) => ({
  socket: null,
  connected: false,
  lastMiningTickAt: null,

  connect: (baseUrl: string) => {
    if (get().socket) return;
    const url = baseUrl.replace(/\/$/, '');
    const socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false }));
    socket.on('mining:tick', () => set({ lastMiningTickAt: Date.now() }));
    set({ socket });
  },

  disconnect: () => {
    const s = get().socket;
    if (s) {
      s.removeAllListeners();
      s.disconnect();
    }
    set({ socket: null, connected: false });
  },
}));
