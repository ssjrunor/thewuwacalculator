/*
  Author: Runor Ewhro
  description: implements scoring shared by target gpu kernels.
*/

// the per-main formula reads `params`. target.wgsl binds it directly;
// weaponSearch.wgsl rebinds it per weapon as a private overlaid copy.

// storage inputs shared with the target-mode optimizer pass

@group(0) @binding(0) var<storage, read> echoStats: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> setConstLut: array<f32>;
@group(0) @binding(2) var<storage, read> echoSets: array<f32>;
@group(0) @binding(3) var<storage, read> comboIndexMap: array<i32>;
@group(0) @binding(5) var<storage, read> echoCosts: array<f32>;
@group(0) @binding(6) var<storage, read> mainEchoBuffs: array<f32>;
@group(0) @binding(8) var<storage, read> echoKindIds: array<i32>;
@group(0) @binding(10) var<storage, read> comboBinom: array<u32>;
@group(0) @binding(11) var<storage, read> theoryData: array<i32>;

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
  // damage and packed identity of one evaluated combination
  dmg : f32,

  // packed local combo rank plus chosen main position
  idx : u32,
};

const NEG_INF: f32 = -1.0e30;
const INV_100: f32 = 0.01;  // reused for percent-to-ratio conversion
const COMBO_MODE_BATCH: u32 = 3u;

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
const ARCHETYPE_HACK: u32 = 9u;

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
    dmgVuln:      f32,

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
    // lowest damage that can still reach the run's top-k (0 keeps every candidate)
    candidateFloor: f32,
    _pad6: f32,
    _pad7: f32,
};


// encoded layout constants
const STATS_VEC4S_PER_ECHO : u32 = __OPT_ECHO_STAT_VEC4S__u;
const ECHOS_PER_COMBO: u32 = 5u;
// kept in sync with MAIN_BUFF_LEN (search/layout), used by search/encode/echoes.ts,
// target/cpu.ts, search/score/evaluate.ts, and compiler/theory.ts. slots 15-17
// encode top_stat contributions (cr/cd/dmgBonus).
const BUFFS_PER_ECHO : u32 = __OPT_MAIN_BUFF_LEN__u;
const SET_SLOTS : u32 = __OPT_SET_SLOT_COUNT__u; // supports set ids 0..38 inclusive
const SET_CONST_LUT_BUCKETS: u32 = 5u;
const SET_CONST_LUT_ROW_STRIDE: u32 = 23u;

// runtime-controlled conditional set toggles
const SET_RUNTIME_TOGGLE_SET14_FIVE: u32 = 1u << 0u;
const SET_RUNTIME_TOGGLE_SET22_P1: u32 = 1u << 1u;
const SET_RUNTIME_TOGGLE_SET22_P2: u32 = 1u << 2u;
const SET_RUNTIME_TOGGLE_SET29_FIVE: u32 = 1u << 3u;
const SET_RUNTIME_TOGGLE_SET33_CHONGMING: u32 = 1u << 4u;
const JINGRAN_FORTUNE_SHIFT: u32 = 3u;
const JINGRAN_FORTUNE_MASK: u32 = 0x3fu;
const JINGRAN_EVERFLOW_BIT: u32 = 1u << 9u;
const JINGRAN_FIRE_OF_LIFE_BIT: u32 = 1u << 10u;
const JINGRAN_LIB_LEVEL_SHIFT: u32 = 11u;
const JINGRAN_LIB_LEVEL_MASK: u32 = 0x1fu;
const JINGRAN_SOUL_RAID_SKILL_HASH: u32 = 8817u;
const JINGRAN_STARDOME_SKILL_HASH: u32 = 3177u;

// each thread processes this many consecutive combos before reduction
override CYCLES_PER_INVOCATION : u32 = __OPT_TARGET_CYCLES__u;

// the runner compiles one pipeline per resonator and archetype so the driver
// drops every branch that cannot run. the defaults keep the runtime reads.
// test resonators with isChar, never against charId directly.
override CHAR_ID : u32 = 0u;
override ARCHETYPE : u32 = 0xffffu;

// the bound pipeline scores optimistic tiles, so constraints must not reject them
override BOUND_PASS : bool = false;

fn isChar(charId: f32, id: f32) -> bool {
    if (CHAR_ID != 0u) { return f32(CHAR_ID) == id; }
    return charId == id;
}

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

fn jingranFortune(toggles: f32) -> f32 {
    return f32((bitcast<u32>(toggles) >> JINGRAN_FORTUNE_SHIFT) & JINGRAN_FORTUNE_MASK);
}

fn jingranEverflow(toggles: f32) -> bool {
    return (bitcast<u32>(toggles) & JINGRAN_EVERFLOW_BIT) != 0u;
}

fn jingranFireOfLife(toggles: f32) -> bool {
    return (bitcast<u32>(toggles) & JINGRAN_FIRE_OF_LIFE_BIT) != 0u;
}

fn jingranLiberationLevel(toggles: f32) -> u32 {
    let encoded = (bitcast<u32>(toggles) >> JINGRAN_LIB_LEVEL_SHIFT) & JINGRAN_LIB_LEVEL_MASK;
    return max(1u, min(20u, encoded));
}

fn jingranFireOfLifeRate(skillId: u32, level: u32) -> f32 {
    let skillHash = (skillId >> 18u) & 0x3fffu;
    let index = max(0u, min(19u, level - 1u));
    if (skillHash == JINGRAN_SOUL_RAID_SKILL_HASH) {
        return array<f32, 20>(
            0.0797, 0.0862, 0.0928, 0.1019, 0.1084,
            0.1159, 0.1263, 0.1367, 0.1472, 0.1582,
            0.1713, 0.1844, 0.1974, 0.2105, 0.2235,
            0.2365, 0.2496, 0.2625, 0.2757, 0.2888,
        )[index];
    }
    if (skillHash == JINGRAN_STARDOME_SKILL_HASH) {
        return array<f32, 20>(
            0.1089, 0.1179, 0.1268, 0.1394, 0.1484,
            0.1585, 0.1728, 0.187, 0.2014, 0.2165,
            0.2345, 0.2524, 0.27, 0.2879, 0.3058,
            0.3236, 0.3415, 0.3594, 0.377, 0.3949,
        )[index];
    }
    return 0.0;
}

fn jingranFireOfLifeMultiplier(charId: f32, skillId: u32, finalHp: f32, toggles: f32) -> f32 {
    if (!isChar(charId, 1212.0) || !jingranFireOfLife(toggles)) {
        return 0.0;
    }
    let rate = jingranFireOfLifeRate(skillId, jingranLiberationLevel(toggles));
    let seqBoost = select(1.0, 1.4, decodeSequence(params) >= 2.0);
    return min(max(finalHp - 25000.0, 0.0), 25000.0) * 0.001 * rate * seqBoost;
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

// CostCursor, costCursorAt and advanceCostCursor live in costCursor.wgsl

// map combo-local indices into actual echo ids
fn comboIndicesToEchoIds(combo: array<u32, 5>) -> array<i32, 5> {
    var out: array<i32, 5>;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        out[i] = -1;
    }

    let comboK = decodeComboK(params);
    for (var pos: u32 = 0u; pos < comboK; pos = pos + 1u) {
        out[pos] = comboIndexMap[combo[pos]] & 0xffff;
    }

    // when a main echo is locked, it is appended into the final slot
    let lockedIndex = decodeLockedIndex(params);
    if (lockedIndex >= 0 && comboK < 5u) {
        out[4] = lockedIndex;
    }

    return out;
}

fn buildEchoIds(index: u32) -> array<i32, 5> {
    if (decodeComboMode(params) == COMBO_MODE_BATCH) {
        var out: array<i32, 5>;
        let base = index * 5u;
        for (var pos: u32 = 0u; pos < 5u; pos = pos + 1u) {
            out[pos] = theoryData[base + pos];
        }
        return out;
    }

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

    // set id per combo position (NO_SET when the Echo has none). setCnt stores
    // the unique-kind piece count on the first position of each set, else 0.
    // fixed-size per-position arrays stay in registers, unlike a set-id
    // histogram indexed at runtime.
    setId:  array<u32, 5>,
    setCnt: array<u32, 5>,

    // piece counts of the sets with runtime-conditional effects
    count14: u32,
    count22: u32,
    count29: u32,
    count33: u32,
};

const NO_SET: u32 = 0xffffffffu;

// piece count of one set inside the combo (0 when absent)
fn setCountOf(base: EchoBase, setId: u32) -> u32 {
    var count: u32 = 0u;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        if (base.setId[i] == setId) { count = max(count, base.setCnt[i]); }
    }
    return count;
}

// aggregate all stats and set counts for one 5-echo combo
fn buildEchoBase(echoIds: array<i32, 5>) -> EchoBase {
    return buildEchoBaseFrom(echoIds, array<vec4<f32>, STATS_VEC4S_PER_ECHO>());
}

// as buildEchoBase, with extra stat rows already summed into the totals
fn buildEchoBaseFrom(echoIds: array<i32, 5>, extra: array<vec4<f32>, STATS_VEC4S_PER_ECHO>) -> EchoBase {
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

    // sum raw echo stats and cost as whole vec4 rows, then read each stat once
    var rows = extra;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        let id = echoIds[i];
        if (id < 0) { continue; }

        out.totalCost += echoCosts[u32(id)];

        let o4 = u32(id) * STATS_VEC4S_PER_ECHO;
        rows[0] += echoStats[o4];
        rows[1] += echoStats[o4 + 1u];
        rows[2] += echoStats[o4 + 2u];
        rows[3] += echoStats[o4 + 3u];
        rows[4] += echoStats[o4 + 4u];
    }

    out.atkP = rows[__OPT_ECHO_STAT_atkPercent_VECTOR__u][__OPT_ECHO_STAT_atkPercent_COMPONENT__u];
    out.atkF = rows[__OPT_ECHO_STAT_atkFlat_VECTOR__u][__OPT_ECHO_STAT_atkFlat_COMPONENT__u];
    out.hpP = rows[__OPT_ECHO_STAT_hpPercent_VECTOR__u][__OPT_ECHO_STAT_hpPercent_COMPONENT__u];
    out.hpF = rows[__OPT_ECHO_STAT_hpFlat_VECTOR__u][__OPT_ECHO_STAT_hpFlat_COMPONENT__u];
    out.defP = rows[__OPT_ECHO_STAT_defPercent_VECTOR__u][__OPT_ECHO_STAT_defPercent_COMPONENT__u];
    out.defF = rows[__OPT_ECHO_STAT_defFlat_VECTOR__u][__OPT_ECHO_STAT_defFlat_COMPONENT__u];
    out.critRate = rows[__OPT_ECHO_STAT_critRate_VECTOR__u][__OPT_ECHO_STAT_critRate_COMPONENT__u];
    out.critDmg = rows[__OPT_ECHO_STAT_critDmg_VECTOR__u][__OPT_ECHO_STAT_critDmg_COMPONENT__u];
    out.er = rows[__OPT_ECHO_STAT_energyRegen_VECTOR__u][__OPT_ECHO_STAT_energyRegen_COMPONENT__u];
    out.basic = rows[__OPT_ECHO_STAT_basicAtk_VECTOR__u][__OPT_ECHO_STAT_basicAtk_COMPONENT__u];
    out.heavy = rows[__OPT_ECHO_STAT_heavyAtk_VECTOR__u][__OPT_ECHO_STAT_heavyAtk_COMPONENT__u];
    out.skill = rows[__OPT_ECHO_STAT_resonanceSkill_VECTOR__u][__OPT_ECHO_STAT_resonanceSkill_COMPONENT__u];
    out.lib = rows[__OPT_ECHO_STAT_resonanceLiberation_VECTOR__u][__OPT_ECHO_STAT_resonanceLiberation_COMPONENT__u];
    out.aero = rows[__OPT_ECHO_STAT_aero_VECTOR__u][__OPT_ECHO_STAT_aero_COMPONENT__u];
    out.spectro = rows[__OPT_ECHO_STAT_spectro_VECTOR__u][__OPT_ECHO_STAT_spectro_COMPONENT__u];
    out.fusion = rows[__OPT_ECHO_STAT_fusion_VECTOR__u][__OPT_ECHO_STAT_fusion_COMPONENT__u];
    out.glacio = rows[__OPT_ECHO_STAT_glacio_VECTOR__u][__OPT_ECHO_STAT_glacio_COMPONENT__u];
    out.havoc = rows[__OPT_ECHO_STAT_havoc_VECTOR__u][__OPT_ECHO_STAT_havoc_COMPONENT__u];
    out.electro = rows[__OPT_ECHO_STAT_electro_VECTOR__u][__OPT_ECHO_STAT_electro_COMPONENT__u];

    // count distinct echo kinds in each set
    var kinds: array<i32, 5>;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        out.setId[i] = NO_SET;
        kinds[i] = -1;
        let idx = echoIds[i];
        if (idx < 0) { continue; }

        let setIdF = echoSets[u32(idx)];
        if (setIdF < 0.0 || u32(setIdF) >= SET_SLOTS) { continue; }

        out.setId[i] = u32(setIdF);
        kinds[i] = echoKindIds[u32(idx)];
    }

    // a position counts when no earlier position repeats its set and kind
    var fresh: array<bool, 5>;
    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        var unique = out.setId[i] != NO_SET;
        for (var j: u32 = 0u; j < i; j = j + 1u) {
            if (out.setId[j] == out.setId[i] && kinds[j] == kinds[i]) { unique = false; }
        }
        fresh[i] = unique;
    }

    for (var i: u32 = 0u; i < 5u; i = i + 1u) {
        var first = out.setId[i] != NO_SET;
        for (var j: u32 = 0u; j < i; j = j + 1u) {
            if (out.setId[j] == out.setId[i]) { first = false; }
        }

        var count: u32 = 0u;
        for (var j: u32 = 0u; j < 5u; j = j + 1u) {
            if (fresh[j] && out.setId[j] == out.setId[i]) { count = count + 1u; }
        }
        out.setCnt[i] = select(0u, count, first);
    }

    out.count14 = setCountOf(out, 14u);
    out.count22 = setCountOf(out, 22u);
    out.count29 = setCountOf(out, 29u);
    out.count33 = setCountOf(out, 33u);

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

    for (var pos: u32 = 0u; pos < 5u; pos = pos + 1u) {
        let count = base.setCnt[pos];
        if (count < 1u) { continue; }
        let setId = base.setId[pos];

        let bucket =
            u32(count >= 1u) +
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

// apply runtime-dependent conditional set effects that cannot live purely in the lut
fn applySetEffectsConditional(
    s: ptr<function, SetApplied>,
    count22: u32,
    count29: u32,
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
    let set22Cond = has3(count22) * f32(u32(set22EnabledForSkill));
    let set29Cond = has3(count29) * f32(u32(echoTriggered && set29Enabled));

    (*s).critRate += 20.0 * set22Cond + 20.0 * set29Cond;
}

fn applySetEffects(base: EchoBase, skillMask: u32, setRuntimeMask: u32) -> SetApplied {
    var s = applySetEffectsBase(base);
    applySetEffectsConditional(&s, base.count22, base.count29, skillMask, setRuntimeMask);
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
    skillId: u32,

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
    if (isChar(pre.charId, 1212.0)) {
        pre.finalDefBase = 0.0;
    }

    // 1306 crit conversion
    if (isChar(pre.charId, 1306.0)) {
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
    pre.skillId = p.skillId;

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
    count14: u32,
    count33: u32,
    setRuntimeMask: u32,
    mainAtkPRatio: f32,
    mainAtkF: f32,
    mainER: f32,
    mainElem: f32,
    mainType0: vec4<f32>,
    mainType1: vec2<f32>,
    // top_stat contributions from the chosen main echo, expressed as
    // percentage points (matches the cpu evaluator's units).
    mainCR: f32,
    mainCD: f32,
    mainDmgBns: f32,
) -> f32 {
    let finalER = pre.finalERBase + mainER;

    var bonus = pre.bonusBaseTotal;

    // set 14 five-piece er threshold
    let set14Enabled = (setRuntimeMask & SET_RUNTIME_TOGGLE_SET14_FIVE) != 0u;
    let s14_er_bonus = 30.0 * f32(u32(set14Enabled && count14 >= 5u && finalER >= 250.0));
    bonus += s14_er_bonus;

    // apply main-echo elemental bonus
    bonus += mainElem;

    // apply main-echo skill-type bonus
    let mask = u32(pre.skillMask);
    bonus += mainType0.x * f32((mask >> 0u) & 1u);
    bonus += mainType0.y * f32((mask >> 1u) & 1u);
    bonus += mainType0.z * f32((mask >> 2u) & 1u);
    bonus += mainType0.w * f32((mask >> 3u) & 1u);
    bonus += mainType1.x * f32((mask >> 6u) & 1u);
    bonus += mainType1.y * f32((mask >> 7u) & 1u);
    // generic top_stat dmgBonus from the main echo, unconditional
    bonus += mainDmgBns;

    var dmgBonus = pre.dmgBonusBase + bonus * INV_100;
    if (isChar(pre.charId, 1212.0)) {
        let baseFusion = min(max(pre.finalHpBase * 0.0015, 0.0), 75.0);
        let fortuneFusion = min(max(pre.finalHpBase * 0.00005, 0.0), 2.5) * jingranFortune(pre.toggles);
        dmgBonus += (baseFusion + fortuneFusion) * INV_100;
    }

    let set33Enabled = (setRuntimeMask & SET_RUNTIME_TOGGLE_SET33_CHONGMING) != 0u;
    let s33_atk_bonus = min(max(finalER * 0.1, 0.0), 25.0) *
        f32(u32(set33Enabled && count33 >= 5u));

    var finalAtk =
        pre.atkBaseTerm +
        (pre.baseAtk * (mainAtkPRatio + s33_atk_bonus * INV_100)) +
        mainAtkF;

    // 1206 er -> atk conversion
    if (isChar(pre.charId, 1206.0)) {
        let erOver = max(0.0, finalER - 150.0);
        var extraAtk: f32 = 0.0;
        if (toggleValue(pre.toggles, 0u) == 1.0) {
            extraAtk = min(erOver * 20.0, 2600.0);
        } else {
            extraAtk = min(erOver * 12.0, 1560.0);
        }
        finalAtk += extraAtk;
    }

    if (isChar(pre.charId, 1512.0)) {
        let aromaStacks = f32((bitcast<u32>(pre.toggles) >> 1u) & 7u);
        finalAtk += pre.baseAtk * aromaStacks * clamp(finalER - 190.0, 0.0, 70.0) * 0.001;
    }

    if (isChar(pre.charId, 1212.0)) {
        var extraAtk = min(max(pre.finalHpBase * 0.036, 0.0), 1800.0);
        if (decodeSequence(params) >= 3.0 && jingranEverflow(pre.toggles)) {
            extraAtk = min(max(pre.finalHpBase * 0.05, 0.0), 2500.0);
        }
        finalAtk += extraAtk;
    }

    // 1412 echo-skill bonus from er
    if (isChar(pre.charId, 1412.0)) {
        let erOver = max((finalER - 125.0), 0);
        let extraDmgBonus = min(erOver * 2.0, 50.0);
        dmgBonus += extraDmgBonus * INV_100 * f32((mask >> 6u) & 1u);
    }

    // seed crit aggregates with main-echo top_stat contributions. echoes
    // like 6000201 (adam smasher for Lucy/Rebecca) actually shift the
    // damage estimate.
    var critRateForDmg = pre.critRateTotal + mainCR * INV_100;
    var critDmgForDmg = pre.critDmgTotal + mainCD * INV_100;
    let baseMul = pre.resDefAmp * pre.dmgReductionTotal;

    // 1505 team crit from shorekeeper's own er
    if (isChar(pre.charId, 1505.0)) {
        critRateForDmg = critRateForDmg + min(max(finalER * 0.05, 0.0), 12.5) * INV_100 * toggleValue(pre.toggles, 1u);
        critDmgForDmg = critDmgForDmg + min(max(finalER * 0.1, 0.0), 25.0) * INV_100 * toggleValue(pre.toggles, 1u) * toggleValue(pre.toggles, 2u);
    }

    // Lily's enhanced Intro and two finishers carry bit 0 in the packed toggles.
    if (isChar(pre.charId, 1512.0) && toggleValue(pre.toggles, 0u) == 1.0) {
        let erOver = max(0.0, finalER - 100.0);
        critRateForDmg += min(erOver * 0.5, 80.0) * INV_100;
        critDmgForDmg += min(erOver, 160.0) * INV_100;
    }

    if (isChar(pre.charId, 1512.0) && toggleValue(pre.toggles, 4u) == 1.0 && ((mask >> 6u) & 1u) != 0u) {
        let supportEr = clamp(finalER - 190.0, 0.0, 70.0);
        critRateForDmg += supportEr / 700.0;
        critDmgForDmg += supportEr / 350.0;
    }

    // 1209 er-based bonuses
    if (isChar(pre.charId, 1209.0)) {
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

    let archetype = select(u32(pre.archetype), ARCHETYPE, ARCHETYPE != 0xffffu);
    var avg: f32 = 0.0;
    // limits check the displayed crit, conditional bonuses included
    var constraintCritRate = critRateForDmg;
    var constraintCritDmg = critDmgForDmg;
    var constraintDmgBonus = dmgBonus;

    // archetype-specific average damage logic
    if (archetype == ARCHETYPE_TUNE_RUPTURE || archetype == ARCHETYPE_HACK) {
        let normal =
            pre.multiplier *
            params.resMult *
            params.defMult *
            params.dmgReductionTotal *
            params.dmgBonus *
            params.dmgAmplify *
            pre.aux0;
        let cr = clamp(pre.packedCritRate, 0.0, 1.0);
        avg = optimizerAverageDamage(normal, cr, pre.packedCritDmg);
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
        let normal =
            pre.multiplier *
            params.resMult *
            params.defMult *
            params.dmgReductionTotal *
            params.dmgBonus *
            params.dmgAmplify *
            pre.aux0;
        let cr = clamp(pre.packedCritRate, 0.0, 1.0);
        avg = optimizerAverageDamage(normal, cr, pre.packedCritDmg);
        constraintCritRate = pre.packedCritRate;
        constraintCritDmg = pre.packedCritDmg;
        constraintDmgBonus = pre.packedDmgBonus;
    } else {
        let multiplier = pre.multiplier + jingranFireOfLifeMultiplier(
            pre.charId,
            pre.skillId,
            pre.finalHpBase,
            pre.toggles,
        );
        let base = (scaled * multiplier + pre.flatDmg) * baseMul * dmgBonus;
        avg = optimizerAverageDamage(base, critRateForDmg, critDmgForDmg);
    }

    if (!BOUND_PASS && !passes_constraints(
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

// score one main echo from its main-bonus row
fn evalMainEcho(pre: PreMain, base: EchoBase, setRuntimeMask: u32, mainId: u32) -> f32 {
    let b = mainId * BUFFS_PER_ECHO;
    let elemIdx = u32(clamp(pre.elementId, 0.0, 5.0));
    return evalMainPos(
        pre,
        base.count14,
        base.count33,
        setRuntimeMask,
        mainEchoBuffs[b + __OPT_MAIN_BUFF_atkPercent__u] / 100.0,
        mainEchoBuffs[b + __OPT_MAIN_BUFF_atkFlat__u],
        mainEchoBuffs[b + __OPT_MAIN_BUFF_energyRegen__u],
        mainEchoBuffs[b + __OPT_MAIN_BUFF_aero__u + elemIdx],
        vec4<f32>(
            mainEchoBuffs[b + __OPT_MAIN_BUFF_basicAtk__u],
            mainEchoBuffs[b + __OPT_MAIN_BUFF_heavyAtk__u],
            mainEchoBuffs[b + __OPT_MAIN_BUFF_resonanceSkill__u],
            mainEchoBuffs[b + __OPT_MAIN_BUFF_resonanceLiberation__u]
        ),
        vec2<f32>(
            mainEchoBuffs[b + __OPT_MAIN_BUFF_echoSkill__u],
            mainEchoBuffs[b + __OPT_MAIN_BUFF_coord__u]
        ),
        mainEchoBuffs[b + __OPT_MAIN_BUFF_critRate__u],
        mainEchoBuffs[b + __OPT_MAIN_BUFF_critDmg__u],
        mainEchoBuffs[b + __OPT_MAIN_BUFF_dmgBonus__u]
    );
}
