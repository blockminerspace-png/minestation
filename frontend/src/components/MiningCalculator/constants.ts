import { HashUnit } from './types';

export const UNIT_MULTIPLIERS: Record<HashUnit, number> = {
    [HashUnit.H_S]: 1,
    [HashUnit.KH_S]: 1e3,
    [HashUnit.MH_S]: 1e6,
    [HashUnit.GH_S]: 1e9,
    [HashUnit.TH_S]: 1e12,
    [HashUnit.PH_S]: 1e15,
};
