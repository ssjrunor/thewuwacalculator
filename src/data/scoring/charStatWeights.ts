/*
  Author: Runor Ewhro
  Description: Defines character-specific echo scoring weights and helper
               accessors for resolving stat weight priorities by resonator id.
*/


// resonator-specific stat weights for echo scoring.
// keys are resonator IDs, values map stat keys to importance weights (0–1.25).
// stats not listed have weight 0 (no scoring contribution).
const charStatWeights: Record<string, Record<string, number>> = {
  '1506': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, heavyAtk: 0.75, spectro: 1 },
  '1107': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 1, glacio: 1 },
  '1409': { hpPercent: 1, hpFlat: 0.25, energyRegen: 1, critRate: 1, critDmg: 1, resonanceLiberation: 0.5, basicAtk: 1, aero: 1 },
  '1507': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, heavyAtk: 1, spectro: 1 },
  '1407': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 0.75, heavyAtk: 0.5, resonanceLiberation: 0.75, aero: 1 },
  '1408': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 1, aero: 1 },
  '1406': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 1, aero: 1 },
  '1102': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 0.75, heavyAtk: 0.5, resonanceLiberation: 0.75, glacio: 1 },
  '1105': { atkPercent: 1, atkFlat: 0.6, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 1, glacio: 1 },
  '1505': { hpPercent: 1, hpFlat: 0.25, energyRegen: 1, critDmg: 1, resonanceLiberation: 1, spectro: 1, healingBonus: 1 },
  '1503': { atkPercent: 1.25, atkFlat: 0.75, energyRegen: 1.25, healingBonus: 1 },
  '1603': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 1, havoc: 1 },
  '1103': { hpPercent: 1.25, hpFlat: 0.75, energyRegen: 1.25, healingBonus: 1 },
  '1104': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 0.75, resonanceSkill: 0.75, glacio: 1 },
  '1106': { atkPercent: 1.25, atkFlat: 0.75, energyRegen: 1.25, healingBonus: 1 },
  '1202': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 0.75, resonanceLiberation: 0.75, fusion: 1 },
  '1203': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 0.75, fusion: 1 },
  '1204': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, resonanceLiberation: 1, fusion: 1 },
  '1205': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 0.75, fusion: 1 },
  '1206': { atkPercent: 0.75, atkFlat: 0.25, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 1, fusion: 1 },
  '1207': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceLiberation: 0.75, fusion: 1 },
  '1301': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceLiberation: 0.75, electro: 1 },
  '1302': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 0.75, electro: 1 },
  '1303': { defPercent: 1, defFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 0.75, resonanceLiberation: 0.75, electro: 1 },
  '1304': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 1, spectro: 1 },
  '1305': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, resonanceLiberation: 1, electro: 1 },
  '1306': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, heavyAtk: 1, electro: 1 },
  '1403': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 0.75, aero: 1 },
  '1410': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, resonanceLiberation: 1, aero: 1 },
  '1405': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, heavyAtk: 0.5, resonanceLiberation: 0.25, aero: 1 },
  '1404': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, heavyAtk: 0.75, aero: 1 },
  '1402': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 0.5, resonanceLiberation: 0.25, aero: 1 },
  '1607': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 1, havoc: 1 },
  '1602': { atkPercent: 1, atkFlat: 0.75, critRate: 1, critDmg: 1, heavyAtk: 0.5, resonanceLiberation: 0.25, havoc: 1 },
  '1608': { atkPercent: 1, atkFlat: 0.75, critRate: 1, critDmg: 1, resonanceSkill: 0.75, havoc: 1 },
  '1606': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, heavyAtk: 1, havoc: 1 },
  '1604': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 0.5, resonanceSkill: 0.5, resonanceLiberation: 0.5, havoc: 1 },
  '1605': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 0.5, resonanceSkill: 0.5, resonanceLiberation: 0.5, havoc: 1 },
  '1601': { defPercent: 1, defFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 0.5, resonanceLiberation: 0.5, havoc: 1 },
  '1501': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 0.25, resonanceLiberation: 0.75, spectro: 1 },
  '1502': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, resonanceSkill: 0.25, resonanceLiberation: 0.75, spectro: 1 },
  '1411': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, heavyAtk: 1, aero: 1 },
  '1208': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, heavyAtk: 0.75, fusion: 1 },
  '1508': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, resonanceLiberation: 1, havoc: 1 },
  '1307': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, heavyAtk: 0.25, resonanceLiberation: 0.75, electro: 1 },
  '1509': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 1, spectro: 1 },
  '1209': { defPercent: 1, defFlat: 0.25, energyRegen: 1, critDmg: 1, critRate: 0.5, resonanceLiberation: 1, fusion: 1, healingBonus: 1 },
  '1510': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, basicAtk: 1, spectro: 1 },
  '1210': { atkPercent: 1, atkFlat: 0.5, energyRegen: 1, critRate: 1, critDmg: 1, resonanceLiberation: 1, fusion: 1 },
  '1412': { atkPercent: 1, atkFlat: 0.75, energyRegen: 1, critRate: 1, critDmg: 1, aero: 1 },
}

// get the weight of a single stat key for a given character
export function getWeight(charId: string, key: string): number {
  return charStatWeights[charId]?.[key] ?? 0
}

// get the full stat-weight object for a given character
export function getWeightObj(charId: string): Record<string, number> {
  return charStatWeights[charId] ?? {}
}