// storage inputs shared with the target-mode optimizer pass

@group(0) @binding(0) var<storage, read> echoStats: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> setConstLut: array<f32>;
@group(0) @binding(2) var<storage, read> echoSets: array<f32>;
@group(0) @binding(3) var<storage, read> comboIndexMap: array<i32>;
@group(0) @binding(5) var<storage, read> echoCosts: array<f32>;
@group(0) @binding(6) var<storage, read> mainEchoBuffs: array<f32>;
@group(0) @binding(8) var<storage, read> echoKindIds: array<i32>;
@group(0) @binding(10) var<storage, read> comboBinom: array<u32>;

struct StatConstraints {
    // min/max windows for each tracked stat
    atkRange      : vec2<f32>,
    hpRange       : vec2<f32>,
    defRange      : vec2<f32>,
    critRateRange : vec2<f32>,
    critDmgRange  : vec2<f32>,
    erRange       : vec2<f32>,
    dmgBonusRange : vec2<f32>,
    dmgRange      : vec2<f32>,
};

@group(0) @binding(7)
var<uniform> statConstraints : StatConstraints;

struct Candidate {
  // best damage found by one thread/workgroup slot
  dmg : f32,

  // packed local combo rank plus chosen main position
  idx : u32,
};

@group(0) @binding(9) var<storage, read_write> candidates: array<Candidate>;

const REDUCE_K: u32 = 8u;
const NEG_INF: f32 = -1.0e30;
const INV_100: f32 = 0.01;  // reused for percent-to-ratio conversion

// skill type bit masks packed into skillId
const SKILL_BASIC:      u32 = 1u << 0u;
const SKILL_HEAVY:      u32 = 1u << 1u;
const SKILL_SKILL:      u32 = 1u << 2u;
const SKILL_LIB:        u32 = 1u << 3u;
const SKILL_OUTRO:      u32 = 1u << 4u;
const SKILL_INTRO:      u32 = 1u << 5u;
const SKILL_ECHO_SKILL: u32 = 1u << 6u;
const SKILL_COORD:      u32 = 1u << 7u;

// archetype ids must stay aligned with ts constants
const ARCHETYPE_DAMAGE: u32 = 0u;
const ARCHETYPE_TUNE_RUPTURE: u32 = 3u;
const ARCHETYPE_SPECTRO_FRAZZLE: u32 = 4u;
const ARCHETYPE_AERO_EROSION: u32 = 5u;
const ARCHETYPE_FUSION_BURST: u32 = 6u;
const ARCHETYPE_ELECTRO_FLARE: u32 = 7u;
const ARCHETYPE_GLACIO_CHAFE: u32 = 8u;

struct Params {
    // packed target context, already precomputed on the cpu
    baseAtk:      f32,
    baseHp:       f32,
    baseDef:      f32,
    baseER:       f32,

    finalAtk:     f32,
    finalHp:      f32,
    finalDef:     f32,
    _padStats:    f32,

    scalingAtk:   f32,
    scalingHp:    f32,
    scalingDef:   f32,
    scalingER:    f32,

    multiplier:   f32,
    flatDmg:      f32,

    resMult:      f32,
    defMult:      f32,

    dmgReductionTotal: f32,
    dmgBonus:     f32,
    dmgAmplify:   f32,
    special:      f32,

    critRate:     f32,
    critDmg:      f32,
    toggles:      f32,

    // packed metadata fields
    skillId:      u32,
    meta0:        u32,
    meta1:        u32,
    lockedPacked: u32,
    comboBaseIndex: u32,

    setRuntimeMask: u32,
    dispatchWorkgroupBase: u32,
    comboN: u32,
    aux0: f32,
    archetype: f32,
    _pad5: f32,
    _pad6: f32,
    _pad7: f32,
};

@group(0) @binding(4)
var<uniform> params : Params;

// encoded layout constants
const STATS_VEC4S_PER_ECHO : u32 = 5u;
const ECHOS_PER_COMBO: u32 = 5u;
const BUFFS_PER_ECHO : u32 = 15u;
const SET_SLOTS : u32 = 32u; // supports set ids 0..31 inclusive
const SET_CONST_LUT_BUCKETS: u32 = 4u;
const SET_CONST_LUT_ROW_STRIDE: u32 = 23u;

// runtime-controlled conditional set toggles
const SET_RUNTIME_TOGGLE_SET14_FIVE: u32 = 1u << 0u;
const SET_RUNTIME_TOGGLE_SET22_P1: u32 = 1u << 1u;
const SET_RUNTIME_TOGGLE_SET22_P2: u32 = 1u << 2u;
const SET_RUNTIME_TOGGLE_SET29_FIVE: u32 = 1u << 3u;

// each thread processes this many consecutive combos before reduction
override CYCLES_PER_INVOCATION : u32 = 32u;

// metadata unpack helpers
fn decodeCharId(p: Params) -> f32 { return f32(p.meta0 & 0xfffu); }
fn decodeSequence(p: Params) -> f32 { return f32((p.meta0 >> 12u) & 0xfu); }
fn decodeComboMode(p: Params) -> u32 { return (p.meta0 >> 16u) & 0x3u; }
fn decodeComboK(p: Params) -> u32 { return (p.meta0 >> 18u) & 0x7u; }
fn decodeComboMaxCost(p: Params) -> f32 { return f32((p.meta0 >> 21u) & 0x3fu); }
fn decodeComboCount(p: Params) -> u32 { return p.meta1; }
fn decodeComboN(p: Params) -> u32 { return p.comboN; }
fn decodeLockedIndex(p: Params) -> i32 { return i32(p.lockedPacked) - 1; }
fn comboBaseIndex(p: Params) -> u32 { return p.comboBaseIndex; }
fn decodeSetRuntimeMask(p: Params) -> u32 { return p.setRuntimeMask; }
fn decodeDispatchWorkgroupBase(p: Params) -> u32 { return p.dispatchWorkgroupBase; }

// read one toggle bit from the packed toggle float
fn toggleValue(toggles: f32, bit: u32) -> f32 {
    let mask = 1u << (bit & 31u);
    return f32((bitcast<u32>(toggles) & mask) != 0u);
}

// range check with support for disabled constraints
fn in_range(val: f32, range: vec2<f32>) -> bool {
    // disabled when min > max
    let disabled = range.x > range.y;
    let inBounds = val >= range.x && val <= range.y;
    return disabled || inBounds;
}

// full post-evaluation constraint check
fn passes_constraints(
    finalAtk: f32,
    finalHp:  f32,
    finalDef: f32,
    critRate: f32,
    critDmg:  f32,
    finalER:  f32,
    dmgBonus: f32,
    damage:   f32,
) -> bool {
    // fast path when every constraint is disabled
    let allDisabled =
        statConstraints.atkRange.x > statConstraints.atkRange.y &&
        statConstraints.hpRange.x > statConstraints.hpRange.y &&
        statConstraints.defRange.x > statConstraints.defRange.y &&
        statConstraints.critRateRange.x > statConstraints.critRateRange.y &&
        statConstraints.critDmgRange.x > statConstraints.critDmgRange.y &&
        statConstraints.erRange.x > statConstraints.erRange.y &&
        statConstraints.dmgBonusRange.x > statConstraints.dmgBonusRange.y &&
        statConstraints.dmgRange.x > statConstraints.dmgRange.y;
    if (allDisabled) { return true; }

    if (!in_range(finalAtk,  statConstraints.atkRange))      { return false; }
    if (!in_range(finalHp,   statConstraints.hpRange))       { return false; }
    if (!in_range(finalDef,  statConstraints.defRange))      { return false; }
    if (!in_range(critRate,  statConstraints.critRateRange)) { return false; }
    if (!in_range(critDmg,   statConstraints.critDmgRange))  { return false; }
    if (!in_range(finalER,   statConstraints.erRange))       { return false; }
    if (!in_range(dmgBonus,  statConstraints.dmgBonusRange)) { return false; }
    if (!in_range(damage,    statConstraints.dmgRange))      { return false; }

    return true;
}

fn hasSkill(mask: u32, flag: u32) -> bool {
    return (mask & flag) != 0u;
}

fn unpackSkillIdFromParams() -> u32 {
    return params.skillId;
}

fn skillMaskFromSkillId(skillId: u32) -> u32 {
    return skillId & 0x7fffu;
}

fn elementFromSkillId(skillId: u32) -> u32 {
    return (skillId >> 15u) & 0x7u;
}

// threshold helpers used by set logic
fn has2(count: u32) -> f32 { return f32(min(1u, count >> 1u)); }
fn has3(count: u32) -> f32 { return f32(min(1u, count / 3u)); }
fn has5(count: u32) -> f32 { return f32(min(1u, count / 5u)); }

struct ComboEval {
    // best damage for this combo
    dmg: f32,

    // which combo position was chosen as main
    mainPos: u32,
};

// unrank one combinadic rank into sorted combo-local positions
fn buildComboIndices(index: u32) -> array<u32, 5> {
    var out: array<u32, 5>;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        out[i] = 0u;
    }

    let comboN = decodeComboN(params);
    let comboK = decodeComboK(params);
    let binomStride = 6u;

    var remainingK = comboK;
    var start: u32 = 0u;
    var rank: u32 = index;

    for (var pos: u32 = 0u; pos < comboK; pos = pos + 1u) {
        let remainingN = comboN - start;
        let total = comboBinom[remainingN * binomStride + remainingK];
        var low: u32 = 0u;
        var high: u32 = remainingN - remainingK + 1u;

        // binary search the next chosen element
        loop {
            if (low >= high) { break; }
            let mid = (low + high) / 2u;
            let right = comboBinom[(remainingN - mid) * binomStride + remainingK];
            let left = total - right;
            if (rank < left) {
                high = mid;
            } else {
                low = mid + 1u;
            }
        }

        let t = select(0u, low - 1u, low > 0u);
        let right = comboBinom[(remainingN - t) * binomStride + remainingK];
        let prefix = total - right;
        rank = rank - prefix;

        let i = start + t;
        out[pos] = i;
        remainingK = remainingK - 1u;
        start = i + 1u;
    }

    return out;
}

// map combo-local indices into actual echo ids
fn comboIndicesToEchoIds(combo: array<u32, 5>) -> array<i32, 5> {
    var out: array<i32, 5>;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        out[i] = -1;
    }

    let comboK = decodeComboK(params);
    for (var pos: u32 = 0u; pos < comboK; pos = pos + 1u) {
        out[pos] = comboIndexMap[combo[pos]];
    }

    // when a main echo is locked, it is appended into the final slot
    let lockedIndex = decodeLockedIndex(params);
    if (lockedIndex >= 0 && comboK < 5u) {
        out[4] = lockedIndex;
    }

    return out;
}

fn buildEchoIds(index: u32) -> array<i32, 5> {
    let combo = buildComboIndices(index);
    return comboIndicesToEchoIds(combo);
}

// shared echo + set + damage core
struct EchoBase {
    // raw combo state before set effects
    totalCost: f32,

    atkP: f32, atkF: f32,
    hpP:  f32, hpF:  f32,
    defP: f32, defF: f32,

    critRate: f32,
    critDmg:  f32,
    er:       f32,

    basic: f32,
    heavy: f32,
    skill: f32,
    lib:   f32,

    aero:    f32,
    spectro: f32,
    fusion:  f32,
    glacio:  f32,
    havoc:   f32,
    electro: f32,

    echoSkill: f32,
    coord:     f32,

    // unique-kind set counts inside the combo
    setCount: array<u32, SET_SLOTS>,
};

// aggregate all stats and set counts for one 5-echo combo
fn buildEchoBase(echoIds: array<i32, 5>) -> EchoBase {
    var out: EchoBase;

    out.totalCost = 0.0;

    out.atkP = 0.0; out.atkF = 0.0;
    out.hpP  = 0.0; out.hpF  = 0.0;
    out.defP = 0.0; out.defF = 0.0;

    out.critRate = 0.0;
    out.critDmg  = 0.0;
    out.er       = 0.0;

    out.basic = 0.0;
    out.heavy = 0.0;
    out.skill = 0.0;
    out.lib   = 0.0;

    out.aero    = 0.0;
    out.spectro = 0.0;
    out.fusion  = 0.0;
    out.glacio  = 0.0;
    out.havoc   = 0.0;
    out.electro = 0.0;

    out.echoSkill = 0.0;
    out.coord     = 0.0;

    for (var s: u32 = 0u; s < SET_SLOTS; s = s + 1u) {
        out.setCount[s] = 0u;
    }

    // sum raw echo stats and cost
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        let id = echoIds[i];
        if (id < 0) { continue; }

        out.totalCost += echoCosts[u32(id)];

        let o4 = u32(id) * STATS_VEC4S_PER_ECHO;
        let v0 = echoStats[o4 + 0u];
        let v1 = echoStats[o4 + 1u];
        let v2 = echoStats[o4 + 2u];
        let v3 = echoStats[o4 + 3u];
        let v4 = echoStats[o4 + 4u];

        out.atkP += v0.x;
        out.atkF += v0.y;
        out.hpP  += v0.z;
        out.hpF  += v0.w;

        out.defP += v1.x;
        out.defF += v1.y;
        out.critRate += v1.z;
        out.critDmg  += v1.w;

        out.er    += v2.x;
        out.basic += v2.z;
        out.heavy += v2.w;

        out.skill += v3.x;
        out.lib   += v3.y;

        out.aero    += v3.z;
        out.spectro += v3.w;

        out.fusion  += v4.x;
        out.glacio  += v4.y;
        out.havoc   += v4.z;
        out.electro += v4.w;
    }

    // count unique echo kinds per set so duplicates do not inflate set counts
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        let idx = echoIds[i];
        if (idx < 0) { continue; }

        let echoIndex: u32 = u32(idx);
        let setIdF = echoSets[echoIndex];
        if (setIdF < 0.0) { continue; }

        let setId = u32(setIdF);
        if (setId >= SET_SLOTS) { continue; }

        let kindId: i32 = echoKindIds[echoIndex];

        var seen: bool = false;
        for (var j: u32 = 0u; j < i; j = j + 1u) {
            let idx2 = echoIds[j];
            if (idx2 < 0) { continue; }

            let echoIndex2: u32 = u32(idx2);
            let setIdF2 = echoSets[echoIndex2];
            if (setIdF2 < 0.0) { continue; }

            let setId2 = u32(setIdF2);
            if (setId2 != setId) { continue; }

            let kindId2: i32 = echoKindIds[echoIndex2];
            if (kindId2 == kindId) {
                seen = true;
                break;
            }
        }

        if (!seen) {
            out.setCount[setId] = out.setCount[setId] + 1u;
        }
    }

    return out;
}

struct SetApplied {
    // raw stats plus unconditional/max set bonuses
    atkP: f32, atkF: f32,
    hpP:  f32, hpF:  f32,
    defP: f32, defF: f32,

    critRate: f32,
    critDmg:  f32,
    er:       f32,

    basic: f32,
    heavy: f32,
    skill: f32,
    lib:   f32,

    aero:    f32,
    spectro: f32,
    fusion:  f32,
    glacio:  f32,
    havoc:   f32,
    electro: f32,

    echoSkill: f32,
    coord:     f32,

    bonusBase:  f32,
    erSetBonus: f32,
};

// apply only the lookup-table set rows implied by piece counts
fn applySetEffectsBase(base: EchoBase) -> SetApplied {
    var s: SetApplied;

    s.atkP = base.atkP; s.atkF = base.atkF;
    s.hpP  = base.hpP;  s.hpF  = base.hpF;
    s.defP = base.defP; s.defF = base.defF;

    s.critRate = base.critRate;
    s.critDmg  = base.critDmg;
    s.er       = base.er;

    s.basic = base.basic;
    s.heavy = base.heavy;
    s.skill = base.skill;
    s.lib   = base.lib;

    s.aero    = base.aero;
    s.spectro = base.spectro;
    s.fusion  = base.fusion;
    s.glacio  = base.glacio;
    s.havoc   = base.havoc;
    s.electro = base.electro;

    s.echoSkill = base.echoSkill;
    s.coord     = base.coord;

    s.bonusBase  = 0.0;
    s.erSetBonus = 0.0;

    for (var setId: u32 = 0u; setId < SET_SLOTS; setId = setId + 1u) {
        let count = base.setCount[setId];
        if (count < 2u) { continue; }

        let bucket =
            u32(count >= 2u) +
            u32(count >= 3u) +
            u32(count >= 5u);
        if (bucket == 0u) { continue; }

        let row = ((setId * SET_CONST_LUT_BUCKETS + bucket) * SET_CONST_LUT_ROW_STRIDE);

        s.atkP      += setConstLut[row + 0u];
        s.atkF      += setConstLut[row + 1u];
        s.hpP       += setConstLut[row + 2u];
        s.hpF       += setConstLut[row + 3u];
        s.defP      += setConstLut[row + 4u];
        s.defF      += setConstLut[row + 5u];
        s.critRate  += setConstLut[row + 6u];
        s.critDmg   += setConstLut[row + 7u];
        s.er        += setConstLut[row + 8u];
        s.basic     += setConstLut[row + 9u];
        s.heavy     += setConstLut[row + 10u];
        s.skill     += setConstLut[row + 11u];
        s.lib       += setConstLut[row + 12u];
        s.aero      += setConstLut[row + 13u];
        s.spectro   += setConstLut[row + 14u];
        s.fusion    += setConstLut[row + 15u];
        s.glacio    += setConstLut[row + 16u];
        s.havoc     += setConstLut[row + 17u];
        s.electro   += setConstLut[row + 18u];
        s.echoSkill += setConstLut[row + 19u];
        s.coord     += setConstLut[row + 20u];
        s.bonusBase += setConstLut[row + 21u];
        s.erSetBonus += setConstLut[row + 22u];
    }

    return s;
}

// apply runtime-dependent conditional set effects that cannot live purely in the LUT
fn applySetEffectsConditional(
    s: ptr<function, SetApplied>,
    setCount: array<u32, SET_SLOTS>,
    skillMask: u32,
    setRuntimeMask: u32,
) {
    let heavyTriggered = hasSkill(skillMask, SKILL_HEAVY);
    let echoTriggered = hasSkill(skillMask, SKILL_ECHO_SKILL);

    let set22P1Enabled = (setRuntimeMask & SET_RUNTIME_TOGGLE_SET22_P1) != 0u;
    let set22P2Enabled = (setRuntimeMask & SET_RUNTIME_TOGGLE_SET22_P2) != 0u;
    let set29Enabled = (setRuntimeMask & SET_RUNTIME_TOGGLE_SET29_FIVE) != 0u;

    let set22EnabledForSkill =
        (heavyTriggered && set22P1Enabled) ||
        (echoTriggered && set22P2Enabled);
    let set22Cond = has3(setCount[22u]) * f32(u32(set22EnabledForSkill));
    let set29Cond = has3(setCount[29u]) * f32(u32(echoTriggered && set29Enabled));

    (*s).critRate += 20.0 * set22Cond + 20.0 * set29Cond;
}

fn applySetEffects(base: EchoBase, skillMask: u32, setRuntimeMask: u32) -> SetApplied {
    var s = applySetEffectsBase(base);
    applySetEffectsConditional(&s, base.setCount, skillMask, setRuntimeMask);
    return s;
}

struct PreMain {
    // values shared across all possible main positions for one combo
    finalHpBase:  f32,
    finalDefBase: f32,

    atkBaseTerm:  f32,

    critRateTotal: f32,
    critDmgTotal:  f32,

    scaledBase: f32,
    baseMul:    f32,
    resDefAmp:  f32,
    dmgReductionTotal: f32,

    finalERBase: f32,

    bonusBaseTotal: f32,

    dmgBonusBase: f32,

    baseAtk:  f32,
    charId:   f32,

    elementId: f32,
    skillMask: f32,

    scalingAtk: f32,
    scalingER:  f32,

    multiplier: f32,
    flatDmg:    f32,
    toggles:    f32,
    aux0:       f32,
    archetype:  f32,
    packedCritRate: f32,
    packedCritDmg: f32,
    packedDmgBonus: f32,
};

// build all combo-level terms that do not depend on which echo becomes main
fn buildPreMain(p: Params, s: SetApplied, skillMask: u32, elementId: u32) -> PreMain {
    var pre: PreMain;

    let baseHp  = p.baseHp;
    let baseDef = p.baseDef;
    let baseAtk = p.baseAtk;

    pre.finalHpBase  = baseHp  * s.hpP  * INV_100 + s.hpF  + p.finalHp;
    pre.finalDefBase = baseDef * s.defP * INV_100 + s.defF + p.finalDef;

    pre.atkBaseTerm  = baseAtk * s.atkP * INV_100 + s.atkF + p.finalAtk;

    pre.critRateTotal = p.critRate + s.critRate * INV_100;
    pre.critDmgTotal  = p.critDmg  + s.critDmg  * INV_100;

    let charId = decodeCharId(p);
    let sequence = decodeSequence(p);
    pre.charId = charId;

    // 1306 crit conversion
    if (pre.charId == 1306.0) {
        var bonusCd: f32 = 0.0;
        if (sequence >= 2.0 && pre.critRateTotal >= 1.0) {
            let excess = pre.critRateTotal - 1.0;
            bonusCd += min(excess * 2.0, 1.0);
        }
        if (sequence >= 6.0 && pre.critRateTotal >= 1.5) {
            let excess2 = pre.critRateTotal - 1.5;
            bonusCd += min(excess2 * 2.0, 0.5);
        }
        pre.critDmgTotal += bonusCd;
    }

    pre.scaledBase =
        pre.finalHpBase  * p.scalingHp +
        pre.finalDefBase * p.scalingDef;

    let resDefAmp =
        p.resMult *
        p.defMult *
        p.dmgAmplify *
        p.aux0;

    pre.resDefAmp = resDefAmp;
    pre.dmgReductionTotal = p.dmgReductionTotal;
    pre.baseMul = resDefAmp * p.dmgReductionTotal;

    pre.finalERBase = p.baseER + s.er + s.erSetBonus;

    pre.elementId = f32(elementId);
    pre.skillMask = f32(skillMask);

    pre.dmgBonusBase = p.dmgBonus;

    // accumulate the base dmg bonus pool from set + element + matching skill type
    var bonus: f32 = s.bonusBase;

    let elemBonuses = array<f32, 6>(s.aero, s.glacio, s.fusion, s.spectro, s.havoc, s.electro);
    let elemIdx = u32(clamp(pre.elementId, 0.0, 5.0));
    bonus += elemBonuses[elemIdx];

    bonus += s.basic     * f32((skillMask >> 0u) & 1u);
    bonus += s.heavy     * f32((skillMask >> 1u) & 1u);
    bonus += s.skill     * f32((skillMask >> 2u) & 1u);
    bonus += s.lib       * f32((skillMask >> 3u) & 1u);
    bonus += s.echoSkill * f32((skillMask >> 6u) & 1u);
    bonus += s.coord     * f32((skillMask >> 7u) & 1u);

    pre.bonusBaseTotal = bonus;

    pre.baseAtk = baseAtk;

    pre.scalingAtk = p.scalingAtk;
    pre.scalingER  = p.scalingER;

    pre.multiplier = p.multiplier;
    pre.flatDmg    = p.flatDmg;
    pre.toggles = p.toggles;
    pre.aux0 = p.aux0;
    pre.archetype = p.archetype;
    pre.packedCritRate = p.critRate;
    pre.packedCritDmg = p.critDmg;
    pre.packedDmgBonus = p.dmgBonus;

    return pre;
}

// evaluate one candidate main position
// returns NEG_INF when the result fails constraints
fn evalMainPos(
    pre: PreMain,
    setCount: array<u32, SET_SLOTS>,
    setRuntimeMask: u32,
    mainAtkPRatio: f32,
    mainAtkF: f32,
    mainER: f32,
    mainElem0: vec4<f32>,
    mainElem1: vec2<f32>,
    mainType0: vec4<f32>,
    mainType1: vec2<f32>,
) -> f32 {
    let finalER = pre.finalERBase + mainER;

    var bonus = pre.bonusBaseTotal;

    // set 14 five-piece er threshold
    let set14Enabled = (setRuntimeMask & SET_RUNTIME_TOGGLE_SET14_FIVE) != 0u;
    let s14_er_bonus = 30.0 * f32(u32(set14Enabled && setCount[14u] >= 5u && finalER >= 250.0));
    bonus += s14_er_bonus;

    // apply main-echo elemental bonus
    let mainElems = array<f32, 6>(mainElem0.x, mainElem0.y, mainElem0.z, mainElem0.w, mainElem1.x, mainElem1.y);
    let elemIdx = u32(clamp(pre.elementId, 0.0, 5.0));
    bonus += mainElems[elemIdx];

    // apply main-echo skill-type bonus
    let mask = u32(pre.skillMask);
    bonus += mainType0.x * f32((mask >> 0u) & 1u);
    bonus += mainType0.y * f32((mask >> 1u) & 1u);
    bonus += mainType0.z * f32((mask >> 2u) & 1u);
    bonus += mainType0.w * f32((mask >> 3u) & 1u);
    bonus += mainType1.x * f32((mask >> 6u) & 1u);
    bonus += mainType1.y * f32((mask >> 7u) & 1u);

    var dmgBonus = pre.dmgBonusBase + bonus * INV_100;

    var finalAtk = pre.atkBaseTerm + (pre.baseAtk * mainAtkPRatio) + mainAtkF;

    // 1206 er -> atk conversion
    if (pre.charId == 1206.0) {
        let erOver = max(0.0, finalER - 150.0);
        var extraAtk: f32 = 0.0;
        if (toggleValue(pre.toggles, 0u) == 1.0) {
            extraAtk = min(erOver * 20.0, 2600.0);
        } else {
            extraAtk = min(erOver * 12.0, 1560.0);
        }
        finalAtk += extraAtk;
    }

    // 1412 echo-skill bonus from er
    if (pre.charId == 1412.0) {
        let erOver = max((finalER - 125.0), 0);
        let extraDmgBonus = min(erOver * 2.0, 50.0);
        dmgBonus += extraDmgBonus * INV_100 * f32((mask >> 6u) & 1u);
    }

    var critRateForDmg = pre.critRateTotal;
    var critDmgForDmg = pre.critDmgTotal;
    let baseMul = pre.resDefAmp * pre.dmgReductionTotal;

    // 1209 er-based bonuses
    if (pre.charId == 1209.0) {
        let erOver = max(0.0, finalER - 100.0);
        let extraDmgBonus = min(erOver * 0.25, 40.0);
        dmgBonus += extraDmgBonus * INV_100 * toggleValue(pre.toggles, 0u);

        if (((mask >> 3u) & 1u) != 0u) {
            critRateForDmg = critRateForDmg + min(erOver * 0.5, 80.0) * INV_100;
            critDmgForDmg = critDmgForDmg + min(erOver, 160.0) * INV_100;
        }
    }

    let scaled =
        pre.scaledBase +
        finalAtk * pre.scalingAtk +
        finalER * pre.scalingER;

    let archetype = u32(pre.archetype);
    var avg: f32 = 0.0;
    var constraintCritRate = pre.critRateTotal;
    var constraintCritDmg = pre.critDmgTotal;
    var constraintDmgBonus = dmgBonus;

    // archetype-specific average damage logic
    if (archetype == ARCHETYPE_TUNE_RUPTURE) {
        let normal =
            pre.multiplier *
            params.resMult *
            params.defMult *
            params.dmgReductionTotal *
            params.dmgBonus *
            params.dmgAmplify *
            pre.aux0;
        let cr = clamp(pre.packedCritRate, 0.0, 1.0);
        let critHit = normal * pre.packedCritDmg;
        avg = cr * critHit + (1.0 - cr) * normal;
        constraintCritRate = pre.packedCritRate;
        constraintCritDmg = pre.packedCritDmg;
        constraintDmgBonus = pre.packedDmgBonus;
    } else if (
        archetype == ARCHETYPE_SPECTRO_FRAZZLE ||
        archetype == ARCHETYPE_AERO_EROSION ||
        archetype == ARCHETYPE_FUSION_BURST ||
        archetype == ARCHETYPE_ELECTRO_FLARE ||
        archetype == ARCHETYPE_GLACIO_CHAFE
    ) {
        let normal = floor(
            pre.multiplier *
            params.resMult *
            params.defMult *
            params.dmgReductionTotal *
            params.dmgBonus *
            params.dmgAmplify *
            pre.aux0
        );
        let cr = clamp(pre.packedCritRate, 0.0, 1.0);
        let critHit = normal * pre.packedCritDmg;
        avg = cr * critHit + (1.0 - cr) * normal;
        constraintCritRate = pre.packedCritRate;
        constraintCritDmg = pre.packedCritDmg;
        constraintDmgBonus = pre.packedDmgBonus;
    } else {
        let base = (scaled * pre.multiplier + pre.flatDmg) * baseMul * dmgBonus;
        let critHit = base * critDmgForDmg;
        let cr = clamp(critRateForDmg, 0.0, 1.0);
        avg = cr * critHit + (1.0 - cr) * base;
    }

    if (!passes_constraints(
        finalAtk,
        pre.finalHpBase,
        pre.finalDefBase,
        constraintCritRate,
        constraintCritDmg,
        finalER,
        constraintDmgBonus,
        avg
    )) {
        return NEG_INF;
    }

    return avg;
}

// evaluate one exact 5-echo combo and choose its best valid main position
fn computeDamageForEchoIds(echoIds: array<i32, 5>) -> ComboEval {
    let skillId: u32 = unpackSkillIdFromParams();
    let skillMask: u32 = skillMaskFromSkillId(skillId);
    let elementId: u32 = elementFromSkillId(skillId);
    let setRuntimeMask: u32 = decodeSetRuntimeMask(params);
    let lockedIndex: i32 = decodeLockedIndex(params);

    let base = buildEchoBase(echoIds);
    if (base.totalCost > decodeComboMaxCost(params)) {
        return ComboEval(0.0, 0u);
    }

    let sonata = applySetEffects(base, skillMask, setRuntimeMask);
    let pre = buildPreMain(params, sonata, skillMask, elementId);

    var best: f32 = 0.0;
    var bestMain: u32 = 0u;

    for (var mainPos: u32 = 0u; mainPos < 5u; mainPos = mainPos + 1u) {
        let mainId = echoIds[mainPos];
        if (mainId < 0) { continue; }
        if (lockedIndex >= 0 && mainId != lockedIndex) { continue; }

        let b = u32(mainId) * BUFFS_PER_ECHO;

        // decode the main-echo bonus row for this chosen main
        let mainAtkP = mainEchoBuffs[b + 0u];
        let mainAtkF = mainEchoBuffs[b + 1u];
        let mainType0 = vec4<f32>(
            mainEchoBuffs[b + 2u],
            mainEchoBuffs[b + 3u],
            mainEchoBuffs[b + 4u],
            mainEchoBuffs[b + 5u]
        );

        let mainElem0 = vec4<f32>(
            mainEchoBuffs[b + 6u],
            mainEchoBuffs[b + 7u],
            mainEchoBuffs[b + 8u],
            mainEchoBuffs[b + 9u]
        );

        let mainElem1 = vec2<f32>(
            mainEchoBuffs[b + 10u],
            mainEchoBuffs[b + 11u]
        );
        let mainER = mainEchoBuffs[b + 12u];
        let mainType1 = vec2<f32>(
            mainEchoBuffs[b + 13u],
            mainEchoBuffs[b + 14u]
        );

        let avg = evalMainPos(
            pre,
            base.setCount,
            setRuntimeMask,
            mainAtkP / 100.0, mainAtkF, mainER,
            mainElem0, mainElem1,
            mainType0, mainType1
        );

        if (avg > best) {
            best = avg;
            bestMain = mainPos;
        }
    }

    return ComboEval(best, bestMain);
}

fn computeDamageForCombo(index: u32) -> ComboEval {
    let comboCount = decodeComboCount(params);
    if (index >= comboCount) {
        return ComboEval(0.0, 0u);
    }

    let comboIndex = comboBaseIndex(params) + index;
    let echoIds = buildEchoIds(comboIndex);
    return computeDamageForEchoIds(echoIds);
}

// workgroup-local storage for keeping each thread's local best candidate
var<workgroup> origScore: array<f32, 512>;
var<workgroup> origIdx: array<u32, 512>;
var<workgroup> origMain: array<u32, 512>;
var<workgroup> blocked: array<u32, 512>;

var<workgroup> tmpScore: array<f32, 512>;
var<workgroup> tmpIdx: array<u32, 512>;
var<workgroup> tmpThread: array<u32, 512>;

var<workgroup> winThread: u32;
var<workgroup> winScore: f32;

@compute @workgroup_size(512)
fn main(
    @builtin(workgroup_id) wg: vec3<u32>,
    @builtin(local_invocation_id) lid3: vec3<u32>
) {
    let lid = lid3.x;
    let comboCount = decodeComboCount(params);

    // dispatchWorkgroupBase lets the cpu split one big job into several submits
    let globalWorkgroup = decodeDispatchWorkgroupBase(params) + wg.x;
    let baseIndex = (globalWorkgroup * 512u + lid) * CYCLES_PER_INVOCATION;
    let comboN = decodeComboN(params);
    let comboK = decodeComboK(params);

    // keep only this thread's best candidate across its mini-batch
    var best: f32 = NEG_INF;
    var bestIndex: u32 = 0u;
    var bestMain: u32 = 0u;

    if (baseIndex < comboCount) {
        var idx: u32 = baseIndex;
        var combo = buildComboIndices(comboBaseIndex(params) + idx);

        for (var j: u32 = 0u; j < CYCLES_PER_INVOCATION; j = j + 1u) {
            if (idx >= comboCount) { break; }

            let echoIds = comboIndicesToEchoIds(combo);
            let eval = computeDamageForEchoIds(echoIds);
            if (eval.dmg > best) {
                best = eval.dmg;
                bestIndex = idx;
                bestMain = eval.mainPos;
            }

            idx = idx + 1u;
            if (j + 1u >= CYCLES_PER_INVOCATION || idx >= comboCount) { break; }

            // advance to the next lexicographic combination without re-unranking
            var advanced: bool = false;
            var i: i32 = i32(comboK) - 1;
            loop {
                if (i < 0) { break; }
                let ui = u32(i);
                let maxVal = comboN - comboK + ui;
                if (combo[ui] < maxVal) {
                    combo[ui] = combo[ui] + 1u;
                    for (var t: u32 = ui + 1u; t < comboK; t = t + 1u) {
                        combo[t] = combo[t - 1u] + 1u;
                    }
                    advanced = true;
                    break;
                }
                i = i - 1;
            }

            if (!advanced) { break; }
        }
    }

    // write local best into shared memory for reduction
    origScore[lid] = best;
    origIdx[lid] = bestIndex;
    origMain[lid] = bestMain;
    blocked[lid] = 0u;

    workgroupBarrier();

    // repeatedly pick the top REDUCE_K winners from this workgroup
    var k: u32 = 0u;
    loop {
        if (k >= REDUCE_K) { break; }

        let allowed = (blocked[lid] == 0u);
        tmpScore[lid] = select(NEG_INF, origScore[lid], allowed);
        tmpIdx[lid] = origIdx[lid];
        tmpThread[lid] = lid;

        workgroupBarrier();

        // tree reduction to the max remaining score
        var stride: u32 = 256u;
        loop {
            if (stride == 0u) { break; }

            if (lid < stride) {
                let other = lid + stride;
                if (tmpScore[other] > tmpScore[lid]) {
                    tmpScore[lid] = tmpScore[other];
                    tmpIdx[lid] = tmpIdx[other];
                    tmpThread[lid] = tmpThread[other];
                }
            }

            stride = stride / 2u;
            workgroupBarrier();
        }

        // lane 0 writes this pick into the global candidate output buffer
        if (lid == 0u) {
            winThread = tmpThread[0];
            winScore  = tmpScore[0];

            if (winScore <= 0.0) {
                candidates[globalWorkgroup * REDUCE_K + k] = Candidate(0.0, 0u);
            } else {
                let mainPos = origMain[winThread] & 7u;
                let packedIdx = (mainPos << 29u) | tmpIdx[0];
                candidates[globalWorkgroup * REDUCE_K + k] = Candidate(winScore, packedIdx);
            }
        }

        workgroupBarrier();

        // block the winning lane so the next iteration finds the next best one
        if (winScore > 0.0 && lid == winThread) {
            blocked[lid] = 1u;
        }

        workgroupBarrier();
        k = k + 1u;
    }
}
