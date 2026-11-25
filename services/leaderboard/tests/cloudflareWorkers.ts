/*
  Author: Runor Ewhro
  description: the service's 'cloudflare:workers' imports for vitest
               (vite.config.ts aliases the module here). a Durable Object stores
               the state and env passed by the runtime.
*/

export class DurableObject<Env = unknown> {
  protected ctx: DurableObjectState
  protected env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
