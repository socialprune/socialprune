export interface ShapeLock {
  instruction: string | null;
}
export function acceptShape(lock: ShapeLock, instruction: string): boolean {
  if (lock.instruction !== null && lock.instruction !== instruction)
    return false;
  lock.instruction = instruction;
  return true;
}
