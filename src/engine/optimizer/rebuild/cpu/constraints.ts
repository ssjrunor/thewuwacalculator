/*
  Author: Runor Ewhro
  Description: checks whether a candidate result satisfies all configured
               optimizer min/max stat and damage constraints.
*/

// treat an inverted range as disabled
function inRange(value: number, min: number, max: number): boolean {
  if (min > max) {
    return true
  }

  return value >= min && value <= max
}

// constraints are stored as min/max pairs in this order:
// [atkMin, atkMax, hpMin, hpMax, defMin, defMax, crMin, crMax,
//  cdMin, cdMax, erMin, erMax, bonusMin, bonusMax, dmgMin, dmgMax]
export function passesConstraints(
    constraints: Float32Array,
    atk: number,
    hp: number,
    def: number,
    critRate: number,
    critDmg: number,
    er: number,
    dmgBonus: number,
    damage: number,
): boolean {
  return (
      inRange(atk, constraints[0], constraints[1]) &&
      inRange(hp, constraints[2], constraints[3]) &&
      inRange(def, constraints[4], constraints[5]) &&
      inRange(critRate, constraints[6], constraints[7]) &&
      inRange(critDmg, constraints[8], constraints[9]) &&
      inRange(er, constraints[10], constraints[11]) &&
      inRange(dmgBonus, constraints[12], constraints[13]) &&
      inRange(damage, constraints[14], constraints[15])
  )
}