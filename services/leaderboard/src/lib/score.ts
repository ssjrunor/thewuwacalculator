/*
  Author: Runor Ewhro
  description: board score storage and ranking. a build score (an unclamped
               percentage: over-perfect builds read above 100 and weak ones can
               read below 0) is stored as an integer `q` in 1e-4 percent, the
               precision every reader shows, so builds tie on a board exactly
               when their shown scores tie. the rank index counts q in BUCKETS
               fixed-width buckets with open-ended edge buckets, which puts
               every score in range.
*/

// q units per score percent
export const Q_PER_PERCENT = 10_000

// a build score (percent) as the integer the boards rank by: cut toward zero, never rounded up, so a score shown from
// q reads as the exact score truncated. float error under a millionth of a unit rounds onto the nearest unit
export function toQ(score: number): number {
  if (!Number.isFinite(score)) throw new Error(`score: ${score} is not a finite score`)
  const scaled = score * Q_PER_PERCENT
  const near = Math.round(scaled)
  return Math.abs(scaled - near) <= 1e-6 ? near : Math.trunc(scaled)
}

// the score a q stands for, as shown
export function fromQ(q: number): number {
  return q / Q_PER_PERCENT
}

// the rank index's bucket count, and how q maps into them: bucket = (q + Q_OFFSET) >> BUCKET_SHIFT, clamped
export const BUCKETS = 4096
export const BUCKET_SHIFT = 10
export const Q_OFFSET = 1_000_000

// the bucket a q is counted in
export function bucketOf(q: number): number {
  const raw = Math.floor((q + Q_OFFSET) / (1 << BUCKET_SHIFT))
  return raw < 0 ? 0 : raw >= BUCKETS ? BUCKETS - 1 : raw
}

// lowest q of a bucket (-Infinity for the bottom bucket, which takes everything below)
export function bucketLow(bucket: number): number {
  return bucket <= 0 ? Number.NEGATIVE_INFINITY : bucket * (1 << BUCKET_SHIFT) - Q_OFFSET
}

// highest q of a bucket (Infinity for the top bucket, which takes everything above)
export function bucketHigh(bucket: number): number {
  return bucket >= BUCKETS - 1 ? Number.POSITIVE_INFINITY : (bucket + 1) * (1 << BUCKET_SHIFT) - Q_OFFSET - 1
}
