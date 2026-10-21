import { createHash } from 'node:crypto';
import ts from 'typescript';

export function assertProductSandbox(text: string): void {
  const source = ts.createSourceFile(
    'app.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const isSandboxCall = (node: ts.Node): node is ts.CallExpression =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.getText(source) === 'app' &&
    node.expression.name.text === 'enableSandbox';
  const calls: ts.CallExpression[] = [];
  let conflicting = false;
  const visit = (node: ts.Node) => {
    if (isSandboxCall(node)) calls.push(node);
    if (
      ts.isCallExpression(node) &&
      /(?:disableSandbox|appendSwitch)$/.test(
        node.expression.getText(source),
      ) &&
      (node.expression.getText(source).endsWith('disableSandbox') ||
        node.arguments.some(
          (arg) =>
            ts.isStringLiteralLike(arg) &&
            /^(?:no-sandbox|disable-(?:gpu|renderer)-sandbox)$/.test(arg.text),
        ))
    )
      conflicting = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  const topLevel = source.statements.findIndex(
    (node) =>
      ts.isExpressionStatement(node) &&
      isSandboxCall(node.expression) &&
      node.expression.arguments.length === 0,
  );
  const importsApp = source.statements.some(
    (node) =>
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'electron' &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(
        (entry) => entry.name.text === 'app' && !entry.propertyName,
      ),
  );
  if (!importsApp || topLevel < 0 || calls.length !== 1 || conflicting)
    throw new Error('PRODUCT_SANDBOX_REQUIRED');
}

// These four files own the acceptance predicates, unlike app.ts, whose other
// product behavior legitimately changes. Frozen from the pre-R30 inputs.
export const readinessHashes = {
  'packaging/release-window.ps1':
    '643805d332ed255215219b672bdc18daa7a9d0f31bded580afb9faa9d05800b7',
  'packaging/window-readiness.cs':
    '177e81204e8e449fe05b3406ab783ae99d3e5498c10eb87cb35bb7732f537655',
  'packaging/window-readiness.ps1':
    '18bf3d5fc70b2c10a677c1886b863577fcdf6452d59f5a601073b35fec012687',
  'packaging/window-readiness.ts':
    '62bdeeaa26ed9845ed4c64e7af277e262239f7d157a3aefcfe6a2cda8a5b0329',
};

export function assertReadinessPredicate(
  file: keyof typeof readinessHashes,
  source: string,
): void {
  const hash = createHash('sha256')
    .update(source.replaceAll('\r\n', '\n'))
    .digest('hex');
  if (hash !== readinessHashes[file])
    throw new Error('READINESS_PREDICATE_CHANGED:' + file);
}

export function assertRestrictedProofLauncher(source: string): void {
  for (const required of [
    'CreateRestrictedToken(token,1|4,1,ref disable,0,IntPtr.Zero,0,IntPtr.Zero,out limited)',
    'var disable=new SidEntry { sid=admins,attributes=0 }',
    'EnsureUserDefaultDacl(limited);',
    'SetMediumIntegrity',
    'if(member) throw new Exception("LIMITED_TOKEN_STILL_ADMIN")',
    'new LimitedDesktop(limited,impersonation)',
    'SetKillOwnedChildrenOnClose',
    'flags=0x2000',
    'proof=StartOwned(limited,job,app,profile,cwd,ref profileStartup)',
    'info=StartOwned(limited,job,app,command,cwd,ref startup)',
  ])
    if (!source.includes(required))
      throw new Error('RESTRICTED_PROOF_INVARIANT:' + required);
  if (/LoadUserProfile\s*\(|SetSecurityInfo\s*\(/.test(source))
    throw new Error('RESTRICTED_PROOF_MUTATION');
}
