/*
  Author: Runor Ewhro
  Description: Defines the shared echo catalog shape used for echo metadata
               and display information.
*/

export interface EchoDefinition {
  id: string
  name: string
  cost: number
  sets: number[]
  icon: string
  skillDesc: string
}