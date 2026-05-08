/** Opções enviadas ao POST `/api/server-room/bulk-batteries` (lógica só no servidor). */
export type BatteryRigSortMode = 'slot_asc' | 'hashrate_desc';

export type BulkRoomBatteryRunOptions = {
  smartFill?: boolean;
  rigSort?: BatteryRigSortMode;
};
