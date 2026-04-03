// ---------------------------------------------------------------------------
// Extension → Language mapping
// ---------------------------------------------------------------------------
export const EXTENSION_TO_LANGUAGE = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.c': 'cpp',
    '.h': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.dart': 'dart',
};
// ---------------------------------------------------------------------------
// Language configurations (import + export regex patterns)
// ---------------------------------------------------------------------------
export const LANGUAGE_CONFIGS = {
    typescript: {
        extensions: ['.ts', '.tsx', '.mts', '.cts'],
        importPatterns: [
            // import X from 'Y'  /  import * as X from 'Y'  /  import { X } from 'Y'
            /(?:^|\n)\s*import\s+(?:[\w*{},\s]+from\s+)?['"]([^'"]+)['"]/g,
            // require('Y')
            /require\(['"]([^'"]+)['"]\)/g,
            // dynamic import('Y')
            /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            // export { X } from 'Y'  /  export * from 'Y'
            /export\s+(?:[\w{},*\s]+from\s+)?['"]([^'"]+)['"]/g,
        ],
        exportPatterns: [
            // export function/class/const/let/var/type/interface/enum/abstract
            /(?:^|\n)\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?\s+|class\s+|const\s+|let\s+|var\s+|type\s+|interface\s+|enum\s+|abstract\s+class\s+)(\w+)/g,
            // export { X, Y }
            /(?:^|\n)\s*export\s+\{([^}]+)\}/g,
            // export default
            /(?:^|\n)\s*export\s+default\s/g,
            // module.exports = X
            /module\.exports\s*=/g,
        ],
    },
    javascript: {
        extensions: ['.js', '.jsx', '.mjs', '.cjs'],
        importPatterns: [
            /(?:^|\n)\s*import\s+(?:[\w*{},\s]+from\s+)?['"]([^'"]+)['"]/g,
            /require\(['"]([^'"]+)['"]\)/g,
            /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            /export\s+(?:[\w{},*\s]+from\s+)?['"]([^'"]+)['"]/g,
        ],
        exportPatterns: [
            /(?:^|\n)\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?\s+|class\s+|const\s+|let\s+|var\s+)(\w+)/g,
            /(?:^|\n)\s*export\s+\{([^}]+)\}/g,
            /(?:^|\n)\s*export\s+default\s/g,
            /module\.exports\s*=/g,
        ],
    },
    python: {
        extensions: ['.py'],
        importPatterns: [
            // from X import Y
            /(?:^|\n)\s*from\s+([\w.]+)\s+import/g,
            // import X
            /(?:^|\n)\s*import\s+([\w.,\s]+)/g,
        ],
        exportPatterns: [
            // top-level def (non-private)
            /(?:^|\n)def\s+([A-Za-z][A-Za-z0-9_]*)\s*\(/g,
            // top-level class (non-private)
            /(?:^|\n)class\s+([A-Za-z][A-Za-z0-9_]*)\s*[:(]/g,
            // __all__ = [...]
            /__all__\s*=\s*\[([^\]]+)\]/g,
        ],
    },
    go: {
        extensions: ['.go'],
        importPatterns: [
            // import "X"
            /import\s+"([^"]+)"/g,
            // import ( "X" \n "Y" ) — each quoted path inside block
            /import\s*\(([^)]+)\)/g,
        ],
        exportPatterns: [
            // Exported func (uppercase first letter)
            /(?:^|\n)func\s+([A-Z][A-Za-z0-9_]*)\s*[\[(]/g,
            // Exported type
            /(?:^|\n)type\s+([A-Z][A-Za-z0-9_]*)\s+/g,
            // Exported var/const
            /(?:^|\n)(?:var|const)\s+([A-Z][A-Za-z0-9_]*)\s/g,
        ],
    },
    rust: {
        extensions: ['.rs'],
        importPatterns: [
            // use X::Y
            /(?:^|\n)\s*use\s+([\w::{},\s*]+);/g,
            // mod X / pub mod X (declaration that maps to a file)
            /(?:^|\n)\s*(?:pub\s+)?mod\s+(\w+)\s*;/g,
            // extern crate X
            /(?:^|\n)\s*extern\s+crate\s+(\w+)/g,
        ],
        exportPatterns: [
            // pub fn / pub async fn
            /(?:^|\n)\s*pub\s+(?:async\s+)?fn\s+(\w+)/g,
            // pub struct
            /(?:^|\n)\s*pub\s+struct\s+(\w+)/g,
            // pub enum
            /(?:^|\n)\s*pub\s+enum\s+(\w+)/g,
            // pub trait
            /(?:^|\n)\s*pub\s+trait\s+(\w+)/g,
            // pub type
            /(?:^|\n)\s*pub\s+type\s+(\w+)/g,
            // pub mod
            /(?:^|\n)\s*pub\s+mod\s+(\w+)/g,
        ],
    },
    java: {
        extensions: ['.java'],
        importPatterns: [
            // import com.foo.Bar
            /(?:^|\n)\s*import\s+(?:static\s+)?([\w.]+);/g,
        ],
        exportPatterns: [
            // public class/interface/enum/record/abstract class
            /(?:^|\n)\s*public\s+(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+(\w+)/g,
            // public static methods (common API surface)
            /(?:^|\n)\s*public\s+(?:static\s+)?(?:\w+\s+)*(\w+)\s*\(/g,
        ],
    },
    csharp: {
        extensions: ['.cs'],
        importPatterns: [
            // using System.Foo
            /(?:^|\n)\s*using\s+([\w.]+);/g,
        ],
        exportPatterns: [
            // public class/interface/struct/enum/record
            /(?:^|\n)\s*public\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+)*(?:class|interface|struct|enum|record)\s+(\w+)/g,
            // public methods
            /(?:^|\n)\s*public\s+(?:static\s+|virtual\s+|override\s+|async\s+)*(?:\w+\s+)+(\w+)\s*\(/g,
        ],
    },
    cpp: {
        extensions: ['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hxx'],
        importPatterns: [
            // #include "file.h"
            /#include\s+"([^"]+)"/g,
            // #include <file.h>
            /#include\s+<([^>]+)>/g,
        ],
        exportPatterns: [
            // class/struct/enum in header files
            /(?:^|\n)\s*(?:class|struct|enum)\s+(\w+)/g,
            // function declarations
            /(?:^|\n)\s*(?:[\w*&:<>]+\s+)+(\w+)\s*\([^;{]*\)\s*(?:const\s*)?[{;]/g,
        ],
    },
    ruby: {
        extensions: ['.rb'],
        importPatterns: [
            // require 'X'
            /(?:^|\n)\s*require\s+['"]([^'"]+)['"]/g,
            // require_relative 'X'
            /(?:^|\n)\s*require_relative\s+['"]([^'"]+)['"]/g,
        ],
        exportPatterns: [
            // def method_name
            /(?:^|\n)\s*def\s+(self\.)?\s*(\w+)/g,
            // class ClassName
            /(?:^|\n)\s*class\s+([A-Z]\w*)/g,
            // module ModuleName
            /(?:^|\n)\s*module\s+([A-Z]\w*)/g,
        ],
    },
    php: {
        extensions: ['.php'],
        importPatterns: [
            // use App\Models\X
            /(?:^|\n)\s*use\s+([\w\\]+)(?:\s+as\s+\w+)?;/g,
            // require_once/require/include
            /(?:require_once|require|include_once|include)\s+['"]([^'"]+)['"]/g,
        ],
        exportPatterns: [
            // public function
            /(?:^|\n)\s*(?:public\s+)?(?:static\s+)?function\s+(\w+)\s*\(/g,
            // class/interface/trait
            /(?:^|\n)\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+(\w+)/g,
        ],
    },
    swift: {
        extensions: ['.swift'],
        importPatterns: [
            // import Foundation
            /(?:^|\n)\s*import\s+(\w+)/g,
        ],
        exportPatterns: [
            // public/open func/class/struct/enum/protocol
            /(?:^|\n)\s*(?:public|open)\s+(?:final\s+)?(?:func|class|struct|enum|protocol|typealias|var|let)\s+(\w+)/g,
            // internal declarations (default visibility in Swift)
            /(?:^|\n)\s*(?:func|class|struct|enum|protocol)\s+(\w+)/g,
        ],
    },
    kotlin: {
        extensions: ['.kt', '.kts'],
        importPatterns: [
            // import com.foo.bar
            /(?:^|\n)\s*import\s+([\w.]+)(?:\.\*)?/g,
        ],
        exportPatterns: [
            // class/interface/fun/object/val/var — public by default
            /(?:^|\n)\s*(?:public\s+)?(?:open\s+|abstract\s+|sealed\s+|data\s+|enum\s+|inner\s+)?(?:class|interface|object|fun)\s+(\w+)/g,
            /(?:^|\n)\s*(?:val|var)\s+(\w+)/g,
        ],
    },
    dart: {
        extensions: ['.dart'],
        importPatterns: [
            // import 'package:X/Y.dart'
            /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
            // export 'file.dart'
            /(?:^|\n)\s*export\s+['"]([^'"]+)['"]/g,
        ],
        exportPatterns: [
            // class/mixin/extension/enum — no underscore = public
            /(?:^|\n)\s*(?:abstract\s+)?(?:class|mixin|extension|enum)\s+([A-Z][A-Za-z0-9_]*)/g,
            // top-level functions
            /(?:^|\n)(?:[\w<>?]+\s+)+([a-zA-Z][a-zA-Z0-9_]*)\s*\(/g,
        ],
    },
};
// ---------------------------------------------------------------------------
// Domain keywords — infer semantic domain from path segments + content
// ---------------------------------------------------------------------------
export const DOMAIN_KEYWORDS = {
    auth: ['auth', 'login', 'logout', 'signup', 'signin', 'password', 'token', 'jwt', 'oauth', 'session', 'credential', 'permission', 'role', 'user'],
    payments: ['payment', 'stripe', 'billing', 'invoice', 'checkout', 'subscription', 'charge', 'refund', 'transaction', 'pricing'],
    db: ['database', 'db', 'query', 'sql', 'postgres', 'mysql', 'sqlite', 'mongodb', 'redis', 'orm', 'migration', 'schema', 'repository', 'dao'],
    api: ['api', 'rest', 'graphql', 'endpoint', 'route', 'router', 'handler', 'controller', 'request', 'response', 'http', 'grpc', 'webhook'],
    ui: ['component', 'view', 'page', 'screen', 'widget', 'button', 'form', 'modal', 'dialog', 'layout', 'style', 'css', 'theme', 'render'],
    utils: ['util', 'utils', 'helper', 'helpers', 'common', 'shared', 'lib', 'tools', 'misc', 'format', 'parse', 'convert'],
    config: ['config', 'configuration', 'settings', 'env', 'environment', 'constants', 'defaults', 'options'],
    test: ['test', 'spec', 'mock', 'fixture', 'fake', 'stub', '__tests__', 'e2e', 'integration', 'unit'],
    types: ['types', 'interfaces', 'models', 'schemas', 'dtos', 'entities', 'structs', 'typings'],
    queue: ['queue', 'worker', 'job', 'task', 'background', 'celery', 'bull', 'rabbitmq', 'kafka', 'pubsub', 'event'],
    cache: ['cache', 'redis', 'memcache', 'ttl', 'invalidate', 'memoize'],
    email: ['email', 'mail', 'smtp', 'sendgrid', 'mailgun', 'notification', 'template', 'mailer'],
    upload: ['upload', 'file', 'storage', 's3', 'bucket', 'blob', 'media', 'image', 'asset'],
    search: ['search', 'index', 'query', 'elastic', 'solr', 'lucene', 'fulltext', 'rank', 'tfidf'],
};
// ---------------------------------------------------------------------------
// Stop words — filtered from queries
// ---------------------------------------------------------------------------
export const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'it', 'its', 'be', 'as', 'this',
    'that', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'do',
    'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'can', 'not', 'no', 'any', 'all', 'some', 'more', 'than', 'then',
    'so', 'if', 'else', 'get', 'set', 'use', 'using', 'used',
    'file', 'files', 'function', 'class', 'method', 'import', 'export',
]);
// ---------------------------------------------------------------------------
// Default excludes for filesystem walker
// ---------------------------------------------------------------------------
export const DEFAULT_EXCLUDES = new Set([
    'node_modules',
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    '.svelte-kit',
    '.git',
    '.hg',
    '.svn',
    '__pycache__',
    '.mypy_cache',
    '.ruff_cache',
    '.pytest_cache',
    'target', // Rust/Maven
    '.gradle',
    'vendor', // PHP/Go
    'Pods', // iOS CocoaPods
    '.dart_tool',
    '.pub-cache',
    'coverage',
    '.nyc_output',
    'tmp',
    'temp',
    '.cache',
    'logs',
]);
// ---------------------------------------------------------------------------
// Entry point filename patterns
// ---------------------------------------------------------------------------
export const ENTRY_POINT_NAMES = new Set([
    'index', 'main', 'app', 'server', 'entry', 'start',
    'bootstrap', 'init', 'cmd', 'bin', 'run',
]);
// ---------------------------------------------------------------------------
// Architectural role patterns (matched against path segments)
// ---------------------------------------------------------------------------
export const ARCH_ROLE_PATTERNS = [
    { pattern: /router|routes?/i, role: 'router' },
    { pattern: /service/i, role: 'service' },
    { pattern: /repo(sitory)?|dao/i, role: 'repository' },
    { pattern: /middleware/i, role: 'middleware' },
    { pattern: /controller/i, role: 'controller' },
    { pattern: /model/i, role: 'model' },
    { pattern: /util|helper/i, role: 'util' },
    { pattern: /config|settings?/i, role: 'config' },
    { pattern: /test|spec|__tests__/i, role: 'test' },
    { pattern: /types?|interfaces?|schemas?|dtos?/i, role: 'types' },
];
// Cache version — bump when index schema changes to force re-index
export const CACHE_VERSION = '2.0.0';
//# sourceMappingURL=constants.js.map