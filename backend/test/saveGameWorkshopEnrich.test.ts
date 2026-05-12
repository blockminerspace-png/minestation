import { describe, it, expect, vi } from 'vitest';
import { enrichWorkshopSlotsSlotItemIdsFromChargingHistory } from '../lib/saveGameEconomyValidate.js';

describe('enrichWorkshopSlotsSlotItemIdsFromChargingHistory', () => {
  it('preenche slotItemIds a partir do histórico de carga', async () => {
    const inst = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ battery_instance_id: inst, battery_item_id: 'battery_test_item' }]
      })
    };
    const workshopSlots: unknown[] = [
      null,
      {
        itemId: 'charger_1',
        internalSlots: { battery_0: inst },
        slotItemIds: {}
      }
    ];
    await enrichWorkshopSlotsSlotItemIdsFromChargingHistory(
      client as never,
      'player@example.com',
      workshopSlots
    );
    const ws = workshopSlots[1] as { slotItemIds: Record<string, string> };
    expect(ws.slotItemIds.battery_0).toBe('battery_test_item');
    // Função consulta `stored_batteries` primeiro e cai em `charging_history`
    // quando a instância não tem `item_id` resolvido — daí 2 queries.
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('ignora email vazio', async () => {
    const client = { query: vi.fn() };
    await enrichWorkshopSlotsSlotItemIdsFromChargingHistory(client as never, '', [null]);
    expect(client.query).not.toHaveBeenCalled();
  });
});
