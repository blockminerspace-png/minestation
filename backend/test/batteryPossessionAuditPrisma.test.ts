import { describe, expect, it } from 'vitest';
import { listWorkshopBatteryInstancesForRow } from '../lib/batteryPossessionAuditPrisma.js';

const UUID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UUID_B = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('listWorkshopBatteryInstancesForRow', () => {
  it('lista instâncias UUID com catálogo e carga por slot', () => {
    const internal = JSON.stringify({ slot0: UUID_A, slot1: UUID_B, legacy: 'not-a-uuid' });
    const sid = JSON.stringify({ slot0: 'cat-a', slot1: 'cat-b' });
    const chg = JSON.stringify({ slot0: 10, slot1: '20.5' });
    const refs = listWorkshopBatteryInstancesForRow(2, internal, sid, chg);
    expect(refs).toHaveLength(2);
    const byKey = new Map(refs.map((r) => [r.slotKey, r]));
    expect(byKey.get('slot0')).toMatchObject({
      slotIndex: 2,
      instanceId: UUID_A,
      catalogItemId: 'cat-a',
      charge: 10
    });
    expect(byKey.get('slot1')).toMatchObject({
      slotIndex: 2,
      instanceId: UUID_B,
      catalogItemId: 'cat-b',
      charge: 20.5
    });
  });

  it('retorna vazio para JSON inválido ou sem objeto', () => {
    expect(listWorkshopBatteryInstancesForRow(0, '', null, null)).toEqual([]);
    expect(listWorkshopBatteryInstancesForRow(0, '[]', null, null)).toEqual([]);
  });
});
