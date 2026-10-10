import type { InferenceState, StateStore } from '../provider/types.js';
/** Action-local memory only. On-chain acceptance provides replay protection across invocations. */
export class MemoryStateStore implements StateStore {
  private states=new Map<string,InferenceState>();
  get(id:string){return this.states.get(id);}
  async set(id:string,state:InferenceState){this.states.set(id,state);}
}
