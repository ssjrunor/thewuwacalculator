struct Candidate {
  // candidate score produced by the main optimizer shader
  damage: f32,

  // packed combo rank + main position payload
  rank: u32,
};

struct ReduceParams {
  // total number of candidate entries available in candidatesIn
  candidateCount: u32,

  // explicit padding so the uniform layout stays aligned
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

// input candidates from the main search pass
@group(0) @binding(0) var<storage, read> candidatesIn: array<Candidate>;

// reduced top-k candidates written one block per workgroup
@group(0) @binding(1) var<storage, read_write> candidatesOut: array<Candidate>;

// small uniform with candidate count
@group(0) @binding(2) var<uniform> reduceParams: ReduceParams;

// shader constants
const WORKGROUP_SIZE: u32 = 256u;
const REDUCE_K: u32 = 8u;
const NEG_INF: f32 = -1.0e30;

// original candidate data loaded once for this workgroup's block
var<workgroup> originalDamage: array<f32, 256>;
var<workgroup> originalRank: array<u32, 256>;

// 0 = still selectable, 1 = already picked into the output top-k
var<workgroup> blocked: array<u32, 256>;

// temporary arrays used during each reduction round
var<workgroup> tmpDamage: array<f32, 256>;
var<workgroup> tmpRank: array<u32, 256>;
var<workgroup> tmpThread: array<u32, 256>;

// winning thread/data for the current pick round
var<workgroup> winningThread: u32;
var<workgroup> winningDamage: f32;

@compute @workgroup_size(256)
fn reduceCandidates(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId3: vec3<u32>,
) {
  let localId = localId3.x;

  // each workgroup reduces one contiguous block of WORKGROUP_SIZE candidates
  let base = workgroupId.x * WORKGROUP_SIZE;
  let index = base + localId;
  let count = reduceParams.candidateCount;

  // load this thread's source candidate into shared memory
  // out-of-range lanes get a guaranteed losing value
  if (index < count) {
    let candidate = candidatesIn[index];
    originalDamage[localId] = candidate.damage;
    originalRank[localId] = candidate.rank;
  } else {
    originalDamage[localId] = NEG_INF;
    originalRank[localId] = 0u;
  }

  // nothing has been picked yet at the start
  blocked[localId] = 0u;

  workgroupBarrier();

  // repeatedly select the best remaining candidate in this block
  // until REDUCE_K outputs have been produced
  var pick: u32 = 0u;
  loop {
    if (pick >= REDUCE_K) {
      break;
    }

    // blocked candidates are masked out by forcing their score to NEG_INF
    let allowed = blocked[localId] == 0u;
    tmpDamage[localId] = select(NEG_INF, originalDamage[localId], allowed);
    tmpRank[localId] = originalRank[localId];

    // keep track of which original thread owns each temporary winner
    tmpThread[localId] = localId;

    workgroupBarrier();

    // tree reduction across the workgroup to find the maximum remaining damage
    var stride: u32 = WORKGROUP_SIZE / 2u;
    loop {
      if (stride == 0u) {
        break;
      }

      if (localId < stride) {
        let other = localId + stride;

        // if the paired lane has a better candidate, adopt it
        if (tmpDamage[other] > tmpDamage[localId]) {
          tmpDamage[localId] = tmpDamage[other];
          tmpRank[localId] = tmpRank[other];
          tmpThread[localId] = tmpThread[other];
        }
      }

      stride = stride / 2u;
      workgroupBarrier();
    }

    // lane 0 writes the selected winner for this pick into the output block
    if (localId == 0u) {
      winningThread = tmpThread[0];
      winningDamage = tmpDamage[0];

      // if no positive candidate remains, emit an empty slot
      if (winningDamage <= 0.0) {
        candidatesOut[workgroupId.x * REDUCE_K + pick] = Candidate(0.0, 0u);
      } else {
        candidatesOut[workgroupId.x * REDUCE_K + pick] = Candidate(winningDamage, tmpRank[0]);
      }
    }

    workgroupBarrier();

    // permanently block the winning thread so the next loop iteration
    // finds the next best remaining candidate instead of repeating it
    if (winningDamage > 0.0 && localId == winningThread) {
      blocked[localId] = 1u;
    }

    workgroupBarrier();
    pick = pick + 1u;
  }
}