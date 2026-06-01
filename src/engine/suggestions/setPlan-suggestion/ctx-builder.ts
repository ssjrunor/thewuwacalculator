/*
  Author: Runor Ewhro
  Description: re-exports the shared suggestion evaluation context builder
               behind a set-plan-local entrypoint.
*/

export {
  mkSuggVltnCt as buildSuggestionEvaluationContext,
} from '@/engine/suggestions/shared'
