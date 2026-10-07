import type { PolicyViolation } from '../import/protocol.ts';

export function observePolicyViolations(
  target: EventTarget,
  report: (violation: PolicyViolation) => void,
): () => void {
  const observe = (event: Event) => {
    const violation = event as SecurityPolicyViolationEvent;
    report({
      directive: violation.effectiveDirective,
      blockedURI: violation.blockedURI,
    });
  };
  target.addEventListener('securitypolicyviolation', observe);
  return () => target.removeEventListener('securitypolicyviolation', observe);
}
