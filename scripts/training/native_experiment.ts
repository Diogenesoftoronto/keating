/** Explicit research instructions are actor context, never fabricated learner turns. */
import { createHash } from 'node:crypto';

export const HARNESS_EXPERIMENT_INSTRUCTION_VERSION = 1;
export interface HarnessExperimentInstruction {
  kind: 'native-action-search/v1';
  comparison_sha256: string;
  candidate_id: 'diagnose' | 'hint' | 'counterexample' | 'worked_example' | 'retrieve_practice' | 'check_transfer';
  instruction: string;
  instruction_sha256: string;
}

export function validateExperimentInstruction(value: unknown): HarnessExperimentInstruction {
  const fields = ['kind', 'comparison_sha256', 'candidate_id', 'instruction', 'instruction_sha256'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== [...fields].sort().join()) throw new Error('harness_invalid_experiment_instruction');
  const row = value as HarnessExperimentInstruction;
  if (row.kind !== 'native-action-search/v1' || typeof row.comparison_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(row.comparison_sha256)
    || !['diagnose', 'hint', 'counterexample', 'worked_example', 'retrieve_practice', 'check_transfer'].includes(row.candidate_id)
    || typeof row.instruction !== 'string' || !row.instruction.trim()
    || Buffer.byteLength(row.instruction, 'utf8') > 8192 || row.instruction.includes('\0')
    || createHash('sha256').update(row.instruction).digest('hex') !== row.instruction_sha256) {
    throw new Error('harness_invalid_experiment_instruction');
  }
  return Object.freeze({ ...row });
}

export function applyExperimentInstruction(source: string, value: HarnessExperimentInstruction): string {
  const checked = validateExperimentInstruction(value);
  return `${source}\n\n[Research condition ${checked.comparison_sha256}; move ${checked.candidate_id}]\n${checked.instruction}`;
}
