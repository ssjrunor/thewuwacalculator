/*
  Author: Runor Ewhro
  Description: Maps normalized evaluation percentages to the shared grade
               thresholds.
*/

export const GRADE_LADDER: ReadonlyArray<readonly [number, string]> = [
  [150, 'SOLON?!'], [140, 'SON?!'], [130, 'SSS+'], [120, 'SSS'], [110, 'SS'],
  [105, 'S'], [100, 'A+'], [95, 'A'], [90, 'A-'], [85, 'B+'],
  [80, 'B'], [75, 'C+'], [70, 'C'], [65, 'C-'], [60, 'D'],
  [55, 'E'], [50, 'F'], [45, 'cute'], [40, 'son..'],
]

export function gradeForPercent(percentX100: number): string {
  for (const [threshold, grade] of GRADE_LADDER) {
    if (percentX100 >= threshold) {
      return grade
    }
  }
  return '🥀'
}
