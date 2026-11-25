/*
  Author: Runor Ewhro
  description: the only engine surface the leaderboard service may import.
*/

export { indexTeammateBuilds, teamSlotKey } from './teammateBuilds'
export type { ResolvedTeammate, TeammateBuildsFile, TeammateEcho, TeammateLayout, TeammateOutfit } from './teammateBuilds'

// card + scenario definition -> scenario input -> CombatScenario.
export { scenarioDefs } from './scenarioDefs'
export type { ScenarioDefsInput, ScenariosFile } from './scenarioDefs'
export { buildScenarioInput, canonicalResonatorId, snapshotEchoes, snapshotIssues, teammateEchoes } from './scenarioInput'
export type { CatalogEcho, ScenarioInputDeps } from './scenarioInput'
export { scenarioInputDeps } from './scenarioInputDeps'
export { createScenario, modeControlKey, scenarioMemberId, scenarioResonatorIds } from './scenario'
export { scenarioBuildStats } from './buildStats'
export { CARD_SCENARIO_ID, cardBuildStats, cardScenarioInput } from './cardScenario'
export { hasScoringData } from './coverage'
export { executeScoringRotation, offlineAnchorExecutor, programMeasures, COMPILE_MIN_BUILDS } from './execute'
export { sameMeasure } from '@/engine/evaluation/compiledMeasure'
export type { ProgramMeasure, ProgramMeasurement } from '@/engine/evaluation/report'
export { anchorErRequirement, anchorStateFor, anchorStateKey } from './offlineAnchors'
export type { ErRepair, ErRepairLine, ErRepairMain } from '@/engine/evaluation/erRepair'
export { ER_REPAIR_RULE } from '@/engine/evaluation/erRepair'
export { scenarioKey, scenarioReads, SHARED_UNITS } from './scoreReads'
export { programShelf, withStoredRotations } from './rotationStore'
export type { ProgramShelf, RotationStore } from './rotationStore'

// team action plans (data/actions.json) and the identity their seats use.
export { assertActionPlan } from '@/domain/rotationActions/actionPlan'
export { resonatorForms } from '@/domain/rotationActions/identities'
export type { ActionPlan } from '@/domain/rotationActions/types'

// ruleset -> scoring session -> one scenario's score -> the build's best.
export { LEADERBOARD_ENGINE_VER, ROTATION_GEN_VER } from './version'
export { canonicalJson, sha256Hex } from '@/domain/leaderboard/canonical'
export { anchorsPath, openRuleset, refsKey, rulesetVersionIssues, RulesetError, scenariosWithoutAnchors } from './rulesetReader'
export type { OpenedRuleset, RulesetFiles } from './rulesetReader'
export { bindRulesetGameData, openScoringSession, ScoringDataConflict } from './scoringSession'
export type { ScoringSession } from './scoringSession'
export { pendingRotationExecutor, scenarioProgramSha, scoreScenario, scoreScenarioGroup } from './scoreScenario'
export type { GroupScoringOptions, ExecutionGroup, ExecutionRequest, ExecutionResult, ProgramDocument, ProgramMemo, RotationExecutor, RotationGenerator, ScenarioScore, ScenarioScoringContext } from './scoreScenario'
export { scenariosForResonator, scoreBuild } from './scoreBuild'
export type { BuildScores } from './scoreBuild'
export { buildScore, overPerfect, PERFECT_SCORE, validAnchors } from './scoreFormula'
export type { ScoreAnchors } from './scoreFormula'
export { pickBest } from './pickBest'
export type { RankableScore } from './pickBest'
export { leaderboardWeaponRank, STANDARD_WEAPON_IDS } from './weaponRank'
export { ALL_SEQUENCES, computeReferences, pendingReferenceSearch } from './references'
export { createReferenceSearch } from './referenceSearch'
export type { ReferenceRequest, ReferenceResult, ReferenceRun, ReferenceSearch } from './references'

export { countEchoSets } from '@/domain/gameData/echoSetCounts'
