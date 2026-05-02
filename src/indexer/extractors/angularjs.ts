/**
 * AngularJS 1.x symbol extractor.
 *
 * Extracts registered component names and exposed methods from AngularJS
 * module declarations. Results are returned as pseudo-export strings so they
 * flow into buildFileDomains as 'symbol' source tokens.
 *
 * Detected patterns:
 *   .controller('UserController', ...)  → 'UserController'
 *   .service('authService', ...)        → 'authService'
 *   .factory / .directive / .filter / .component / .provider
 *   this.getUser = ...                  → 'getUser'
 *   $scope.loadItems = ...              → 'loadItems'
 */

const ANGULAR_REGISTER_RE =
  /\.(?:controller|service|factory|directive|component|filter|provider|value|constant)\s*\(\s*['"]([^'"]+)['"]/g;

const THIS_METHOD_RE = /\bthis\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g;
const SCOPE_METHOD_RE = /\$scope\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g;

export function extractAngularJsSymbols(content: string): string[] {
  // Quick bail — not an AngularJS file
  if (!content.includes('angular.module')) return [];

  const symbols: string[] = [];

  let m: RegExpExecArray | null;

  // Registered component names
  ANGULAR_REGISTER_RE.lastIndex = 0;
  while ((m = ANGULAR_REGISTER_RE.exec(content)) !== null) {
    symbols.push(m[1]);
  }

  // this.method = ... (service / controller instance methods)
  const thisSeen = new Set<string>();
  THIS_METHOD_RE.lastIndex = 0;
  while ((m = THIS_METHOD_RE.exec(content)) !== null) {
    if (!thisSeen.has(m[1])) { thisSeen.add(m[1]); symbols.push(m[1]); }
  }

  // $scope.method = ... (controller scope methods)
  const scopeSeen = new Set<string>();
  SCOPE_METHOD_RE.lastIndex = 0;
  while ((m = SCOPE_METHOD_RE.exec(content)) !== null) {
    if (!scopeSeen.has(m[1])) { scopeSeen.add(m[1]); symbols.push(m[1]); }
  }

  return symbols;
}
