export class AgentRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class HookUsageError extends AgentRuntimeError {}
export class StructuralInvariantError extends AgentRuntimeError {}
export class ResourceConflictError extends AgentRuntimeError {}
export class StateValidationError extends AgentRuntimeError {}
