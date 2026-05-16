/**
 * Tree-sitter based parser for Ruby.
 * Extracts symbol-level nodes (classes, modules, methods, constants)
 * and their relationships (calls, extends, includes/implements).
 *
 * Follows the same interface and patterns as ts-parser.ts.
 */
import { createRequire } from 'node:module';
import { dirname, resolve, basename } from 'node:path';
import type { SymbolNode, CallSite } from '../../types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParserCtor = require('tree-sitter') as { new(): any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rubyGrammar = require('tree-sitter-ruby') as unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rubyParser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getParser(): any {
  if (!rubyParser) {
    rubyParser = new ParserCtor();
    rubyParser.setLanguage(rubyGrammar);
  }
  return rubyParser;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

function childrenOfType(node: TSNode, type: string): TSNode[] {
  return node.namedChildren.filter((c: TSNode) => c.type === type);
}

function firstChildOfType(node: TSNode, type: string): TSNode | null {
  return node.namedChildren.find((c: TSNode) => c.type === type) ?? null;
}

function firstChildOfTypes(node: TSNode, types: string[]): TSNode | null {
  return node.namedChildren.find((c: TSNode) => types.includes(c.type)) ?? null;
}

/** Collect all call node method names + first-seen line in a subtree */
function collectCalls(node: TSNode, results: Map<string, number>): void {
  if (node.type === 'call') {
    // call grammar: field('receiver', ...) '.' field('method', identifier|constant) field('arguments', ...)?
    // Use the field accessor — `find(...)` returns the receiver when it's a bare
    // identifier/constant, not the method name.
    const methodNode = node.childForFieldName('method');
    if (methodNode && !results.has(methodNode.text)) {
      results.set(methodNode.text, node.startPosition.row + 1);
    }
  } else if (node.type === 'method_call' || node.type === 'command') {
    // bare method call: method_name args
    const methodNode = node.namedChildren[0];
    if (methodNode?.type === 'identifier' && !results.has(methodNode.text)) {
      results.set(methodNode.text, node.startPosition.row + 1);
    }
  }
  for (const child of node.namedChildren) {
    collectCalls(child, results);
  }
}

function callsFromMap(calls: Map<string, number>, exclude?: string): CallSite[] {
  const out: CallSite[] = [];
  for (const [name, line] of calls) {
    if (exclude && name === exclude) continue;
    out.push({ name, line });
  }
  return out;
}

/** Get constant name from a scope_resolution or constant node */
function getConstantName(node: TSNode): string | null {
  if (!node) return null;
  if (node.type === 'constant') return node.text;
  if (node.type === 'scope_resolution') {
    // Foo::Bar — return the full path
    return node.text;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rails DSL detection helpers
// ---------------------------------------------------------------------------

const RAILS_ASSOCIATION_METHODS = new Set(['has_many', 'has_one', 'belongs_to', 'has_and_belongs_to_many']);
const RAILS_CALLBACK_METHODS = new Set(['before_action', 'after_action', 'around_action', 'before_filter', 'after_filter', 'validates', 'validate']);
const RAILS_DSL_METHODS = new Set(['attr_accessor', 'attr_reader', 'attr_writer', 'delegate', 'scope', 'attribute', 'enum']);

// Stoplist for Rails autoload constant resolution — framework/stdlib constants we never resolve
const CONSTANT_STOPLIST_TOP_LEVEL = new Set([
  // Ruby builtins
  'Object', 'Kernel', 'Module', 'Class', 'BasicObject', 'Proc', 'Method', 'UnboundMethod',
  'String', 'Symbol', 'Integer', 'Float', 'Numeric', 'Rational', 'Complex',
  'TrueClass', 'FalseClass', 'NilClass', 'Array', 'Hash', 'Set', 'Range',
  'Regexp', 'MatchData', 'Time', 'Date', 'DateTime', 'IO', 'File', 'Dir',
  'Pathname', 'URI', 'Tempfile', 'Struct', 'OpenStruct', 'Comparable',
  'Enumerable', 'Enumerator', 'StandardError', 'RuntimeError', 'ArgumentError',
  'TypeError', 'NameError', 'NoMethodError', 'NotImplementedError', 'IOError',
  'EOFError', 'SystemCallError', 'ZeroDivisionError', 'FloatDomainError',
  'IndexError', 'KeyError', 'RangeError', 'StopIteration', 'ThreadError',
  'FiberError', 'LocalJumpError', 'SignalException', 'Errno', 'Encoding',
  'Thread', 'Fiber', 'Mutex', 'Queue', 'ConditionVariable', 'GC',
  'ObjectSpace', 'Process', 'Signal', 'Math', 'Random', 'JSON', 'YAML',
  'CSV', 'Base64', 'Digest', 'OpenSSL', 'Net', 'ERB', 'CGI', 'Logger',
  'SecureRandom', 'FileUtils', 'Forwardable', 'Singleton', 'BigDecimal',
  'Marshal',
  // Rails framework
  'Rails', 'ActiveRecord', 'ActiveModel', 'ActiveSupport', 'ActionController',
  'ActionView', 'ActionDispatch', 'ActionMailer', 'ActionCable', 'ActionPack',
  'ActiveJob', 'ActiveStorage', 'ActionText', 'ActionMailbox',
  'Concern', 'Mime', 'MIME', 'I18n', 'Migration', 'Schema', 'Devise',
  'Doorkeeper', 'Sidekiq', 'Paperclip', 'CarrierWave', 'Pundit', 'Kaminari',
  'WillPaginate', 'RSpec', 'Minitest', 'Faker', 'FactoryBot', 'Webpacker',
  'RSolr', 'Redis', 'Memcached', 'Resque', 'GoodJob', 'Que', 'DelayedJob',
  'Aws', 'Azure', 'Google', 'GraphQL', 'Stripe', 'Twilio', 'Twitter',
  'OmniAuth', 'Bundler', 'Gem', 'Rake', 'Rack', 'Sprockets',
  'Mail', 'Nokogiri', 'HTTP', 'HTTParty', 'Faraday', 'Chewy', 'Elasticsearch',
]);

const CONSTANT_STOPLIST_PREFIXES = [
  'ActiveRecord::', 'ActiveModel::', 'ActiveSupport::', 'ActionController::',
  'ActionView::', 'ActionDispatch::', 'ActionMailer::', 'ActionCable::',
  'ActiveJob::', 'ActiveStorage::', 'Rails::', 'Concern::',
  'Devise::', 'Doorkeeper::', 'Sidekiq::', 'Pundit::', 'Kaminari::',
  'OmniAuth::', 'OAuth::', 'OAuth2::', 'JWT::', 'OpenSSL::', 'Net::',
  'URI::', 'Errno::', 'Encoding::', 'Process::', 'Math::', 'File::',
  'IO::', 'Dir::', 'Thread::', 'JSON::', 'YAML::', 'CSV::', 'ERB::',
  'Digest::', 'Base64::', 'Mime::', 'MIME::', 'I18n::', 'Aws::',
  'Google::', 'GraphQL::', 'Stripe::', 'Mail::', 'Nokogiri::',
  'HTTP::', 'HTTParty::', 'Faraday::', 'Chewy::', 'Sprockets::',
  'Bundler::', 'Gem::', 'Rake::', 'Rack::', 'Logger::', 'FactoryBot::', 'RSpec::', 'Minitest::',
];

function isConstantStoplisted(fqcn: string): boolean {
  const head = fqcn.split('::')[0];
  if (CONSTANT_STOPLIST_TOP_LEVEL.has(head)) return true;
  for (const p of CONSTANT_STOPLIST_PREFIXES) if (fqcn.startsWith(p)) return true;
  return false;
}

/** Convert snake_case association name to CamelCase model name */
function associationToModel(name: string): string {
  // has_many :comments → Comment; has_one :profile → Profile
  // Singularize the name if it's plural, convert to CamelCase
  const singular = singularize(name);
  return singular.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_: string, c: string) => c.toUpperCase());
}

/** Singularize plural English nouns (basic rules for Rails conventions) */
function singularize(word: string): string {
  // Leave already-singular words alone: -us (status, virus, focus), -ss (address, class),
  // -is (basis, axis), -ous (famous). Rails Inflector also treats these as uncountable/no-op.
  if (word.endsWith('us') || word.endsWith('ss') || word.endsWith('is')) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ches') || word.endsWith('shes') || word.endsWith('sses') || word.endsWith('xes') || word.endsWith('zes')) return word.slice(0, -2);
  if (word.endsWith('es') && (word.endsWith('oes') || word.endsWith('zes') || word[word.length - 3] === 's' || word[word.length - 3] === 'x' || word[word.length - 3] === 'z' || word[word.length - 3] === 'h')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Pluralize singular English nouns (basic rules for Rails conventions) */
function pluralize(word: string): string {
  if (word.endsWith('y')) return word.slice(0, -1) + 'ies';
  if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z') || word.endsWith('ch') || word.endsWith('sh')) return word + 'es';
  return word + 's';
}

/** Extract Rails model association file imports from config/routes.rb */
function extractRoutesImports(rootNode: TSNode, _fileId: string): string[] {
  const routeImports: string[] = [];

  function walkNode(node: TSNode): void {
    if (node.type === 'call' || node.type === 'command') {
      const methodNode = node.type === 'call'
        ? node.namedChildren.find((c: TSNode) => c.type === 'identifier')
        : node.namedChildren[0];
      if (!methodNode || methodNode.type !== 'identifier') {
        for (const child of node.namedChildren) walkNode(child);
        return;
      }
      const methodName = methodNode.text;

      if (methodName === 'resources' || methodName === 'resource') {
        const args = firstChildOfType(node, 'argument_list') ?? firstChildOfType(node, 'arguments');
        const firstArg = args?.namedChildren[0] ?? node.namedChildren[1];
        if (firstArg?.type === 'simple_symbol') {
          const resourceName = firstArg.text.replace(/^:/, '');
          const controllerName = methodName === 'resource' ? pluralize(resourceName) : resourceName;
          routeImports.push(`../app/controllers/${controllerName}_controller`);
        }
      } else if (['get', 'post', 'put', 'patch', 'delete'].includes(methodName)) {
        const toTargetRef: { value: string | null } = { value: null };
        function findToValue(n: TSNode): void {
          if (toTargetRef.value !== null) return;
          if (n.type === 'pair' && n.namedChildren.length >= 2) {
            const firstChild = n.namedChildren[0];
            const secondChild = n.namedChildren[1];
            const keyText = firstChild.type === 'hash_key_symbol' ? firstChild.text : (firstChild.text.startsWith(':') ? firstChild.text.slice(1) : firstChild.text);
            if ((firstChild.type === 'hash_key_symbol' || firstChild.type === 'simple_symbol') && keyText === 'to') {
              if (secondChild.type === 'string' || secondChild.type === 'string_literal') {
                const content = firstChildOfType(secondChild, 'string_content');
                toTargetRef.value = content?.text ?? secondChild.text.replace(/^['"]|['"]$/g, '');
              }
            }
          }
          for (const child of n.namedChildren) {
            findToValue(child);
          }
        }
        findToValue(node);
        const toTarget = toTargetRef.value;
        if (toTarget && toTarget.includes('#')) {
          const [controller, _action] = toTarget.split('#');
          const parts = controller.split('/');
          const fileName = parts[parts.length - 1];
          const dir = parts.slice(0, -1).join('/');
          const controllerPath = dir ? `../app/controllers/${dir}/${fileName}_controller` : `../app/controllers/${fileName}_controller`;
          routeImports.push(controllerPath);
        }
      }
    }

    for (const child of node.namedChildren) {
      walkNode(child);
    }
  }

  walkNode(rootNode);
  return routeImports;
}

/** Extract DSL method names from command node arguments (bare method call form) */
function extractDslMethodsFromCommand(
  methodName: string,
  parentName: string,
  node: TSNode,
  ctx: ExtractionContext,
  symbols: SymbolNode[],
): void {
  if (!parentName) return;

  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const argList = node.namedChildren.slice(1);

  if (methodName === 'attr_accessor') {
    for (const arg of argList) {
      if (arg.type === 'simple_symbol') {
        const propName = arg.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${propName}`,
          name: `${parentName}.${propName}`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${propName}=`,
          name: `${parentName}.${propName}=`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
      }
    }
  } else if (methodName === 'attr_reader') {
    for (const arg of argList) {
      if (arg.type === 'simple_symbol') {
        const propName = arg.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${propName}`,
          name: `${parentName}.${propName}`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
      }
    }
  } else if (methodName === 'attr_writer') {
    for (const arg of argList) {
      if (arg.type === 'simple_symbol') {
        const propName = arg.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${propName}=`,
          name: `${parentName}.${propName}=`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
      }
    }
  } else if (methodName === 'delegate') {
    for (const arg of argList) {
      if (arg.type === 'simple_symbol') {
        const delegatedName = arg.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${delegatedName}`,
          name: `${parentName}.${delegatedName}`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
      } else {
        break;
      }
    }
  } else if (methodName === 'scope') {
    const firstArg = argList[0];
    if (firstArg?.type === 'simple_symbol') {
      const scopeName = firstArg.text.replace(/^:/, '');
      symbols.push({
        id: `${ctx.fileId}#${parentName}.${scopeName}`,
        name: `${parentName}.${scopeName}`,
        kind: 'method',
        startLine,
        endLine,
        isExported: false,
        calls: [],
        implementsNames: [],
      });
    }
  } else if (methodName === 'attribute') {
    const firstArg = argList[0];
    if (firstArg?.type === 'simple_symbol') {
      const attrName = firstArg.text.replace(/^:/, '');
      symbols.push({
        id: `${ctx.fileId}#${parentName}.${attrName}`,
        name: `${parentName}.${attrName}`,
        kind: 'method',
        startLine,
        endLine,
        isExported: false,
        calls: [],
        implementsNames: [],
      });
    }
  } else if (methodName === 'enum') {
    const firstArg = argList[0];
    if (firstArg?.type === 'pair') {
      const keyNode = firstChildOfTypes(firstArg, ['hash_key_symbol', 'simple_symbol', 'symbol']);
      if (keyNode) {
        const enumName = keyNode.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${enumName}`,
          name: `${parentName}.${enumName}`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
        const valueNode = firstChildOfType(firstArg, 'hash');
        if (valueNode) {
          const valuePairs = childrenOfType(valueNode, 'pair');
          for (const pair of valuePairs) {
            const pairKey = firstChildOfTypes(pair, ['hash_key_symbol', 'simple_symbol', 'symbol']);
            if (pairKey) {
              const valueName = pairKey.text.replace(/^:/, '');
              symbols.push({
                id: `${ctx.fileId}#${parentName}.${valueName}?`,
                name: `${parentName}.${valueName}?`,
                kind: 'method',
                startLine,
                endLine,
                isExported: false,
                calls: [],
                implementsNames: [],
              });
            }
          }
        }
      }
    }
  }
}

/** Extract synthesized method names from Rails DSL calls and emit SymbolNode for each */
function extractDslMethods(
  node: TSNode,
  methodName: string,
  parentName: string,
  ctx: ExtractionContext,
  symbols: SymbolNode[],
): void {
  if (!parentName) return;

  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const args = firstChildOfType(node, 'argument_list') ?? firstChildOfType(node, 'arguments');
  if (!args) return;

  const argList = args.namedChildren;

  if (methodName === 'attr_accessor') {
    // attr_accessor :name, :age → emit name, name=, age, age=
    for (const arg of argList) {
      if (arg.type === 'simple_symbol') {
        const propName = arg.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${propName}`,
          name: `${parentName}.${propName}`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${propName}=`,
          name: `${parentName}.${propName}=`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
      }
    }
  } else if (methodName === 'attr_reader') {
    // attr_reader :name, :age → emit name, age
    for (const arg of argList) {
      if (arg.type === 'simple_symbol') {
        const propName = arg.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${propName}`,
          name: `${parentName}.${propName}`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
      }
    }
  } else if (methodName === 'attr_writer') {
    // attr_writer :name, :age → emit name=, age=
    for (const arg of argList) {
      if (arg.type === 'simple_symbol') {
        const propName = arg.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${propName}=`,
          name: `${parentName}.${propName}=`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
      }
    }
  } else if (methodName === 'delegate') {
    // delegate :foo, :bar, to: :user → emit foo, bar (stop at first non-symbol arg)
    for (const arg of argList) {
      if (arg.type === 'simple_symbol') {
        const delegatedName = arg.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${delegatedName}`,
          name: `${parentName}.${delegatedName}`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
      } else {
        // Stop at first non-symbol arg (hash with to:)
        break;
      }
    }
  } else if (methodName === 'scope') {
    // scope :recent, -> { ... } → emit recent (class method)
    const firstArg = argList[0];
    if (firstArg?.type === 'simple_symbol') {
      const scopeName = firstArg.text.replace(/^:/, '');
      symbols.push({
        id: `${ctx.fileId}#${parentName}.${scopeName}`,
        name: `${parentName}.${scopeName}`,
        kind: 'method',
        startLine,
        endLine,
        isExported: false,
        calls: [],
        implementsNames: [],
      });
    }
  } else if (methodName === 'attribute') {
    // attribute :webfinger, :string → emit webfinger
    const firstArg = argList[0];
    if (firstArg?.type === 'simple_symbol') {
      const attrName = firstArg.text.replace(/^:/, '');
      symbols.push({
        id: `${ctx.fileId}#${parentName}.${attrName}`,
        name: `${parentName}.${attrName}`,
        kind: 'method',
        startLine,
        endLine,
        isExported: false,
        calls: [],
        implementsNames: [],
      });
    }
  } else if (methodName === 'enum') {
    // enum status: { active: 0, inactive: 1 } → emit status, active?, inactive?
    const firstArg = argList[0];
    if (firstArg?.type === 'pair') {
      const keyNode = firstChildOfTypes(firstArg, ['hash_key_symbol', 'simple_symbol', 'symbol']);
      if (keyNode) {
        const enumName = keyNode.text.replace(/^:/, '');
        symbols.push({
          id: `${ctx.fileId}#${parentName}.${enumName}`,
          name: `${parentName}.${enumName}`,
          kind: 'method',
          startLine,
          endLine,
          isExported: false,
          calls: [],
          implementsNames: [],
        });
        const valueNode = firstChildOfType(firstArg, 'hash');
        if (valueNode) {
          const valuePairs = childrenOfType(valueNode, 'pair');
          for (const pair of valuePairs) {
            const pairKey = firstChildOfTypes(pair, ['hash_key_symbol', 'simple_symbol', 'symbol']);
            if (pairKey) {
              const valueName = pairKey.text.replace(/^:/, '');
              symbols.push({
                id: `${ctx.fileId}#${parentName}.${valueName}?`,
                name: `${parentName}.${valueName}?`,
                kind: 'method',
                startLine,
                endLine,
                isExported: false,
                calls: [],
                implementsNames: [],
              });
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Context for symbol extraction
// ---------------------------------------------------------------------------

interface ExtractionContext {
  fileId: string;
  /** All known symbol names in this file, for call resolution */
  allSymbolNames: Set<string>;
  /** Accumulated extra edges (Rails associations etc.) */
  extraCalls: Array<{ fromId: string; toName: string }>;
  /** Rails association target model names (CamelCase) — used to emit synthetic file-level imports for has_many/belongs_to/has_one/HABTM only, never callbacks or includes */
  associationTargets: string[];
}

// ---------------------------------------------------------------------------
// Extract method definition
// ---------------------------------------------------------------------------

function extractMethod(
  node: TSNode,
  ctx: ExtractionContext,
  parentName: string | null,
): SymbolNode | null {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;

  let methodName: string;
  let isSingleton = false;

  if (node.type === 'singleton_method') {
    // def self.foo; singleton_method has: object '.' name body_statement
    isSingleton = true;
    const nameNode = node.namedChildren.find(
      (c: TSNode) => c.type === 'identifier',
    );
    if (!nameNode) return null;
    methodName = nameNode.text;
  } else {
    // method: 'def' name body_statement 'end'
    const nameNode = firstChildOfTypes(node, ['identifier', 'operator']);
    if (!nameNode) return null;
    methodName = nameNode.text;
  }

  const fullName = parentName
    ? isSingleton
      ? `${parentName}.self.${methodName}`
      : `${parentName}.${methodName}`
    : methodName;

  const calls = new Map<string, number>();
  const body = firstChildOfTypes(node, ['body_statement', 'do_block']);
  if (body) collectCalls(body, calls);
  // also scan the whole node for calls
  if (!body) collectCalls(node, calls);

  return {
    id: `${ctx.fileId}#${fullName}`,
    name: fullName,
    kind: parentName ? 'method' : 'function',
    startLine,
    endLine,
    isExported: !parentName, // top-level methods are "exported" by default in Ruby
    calls: callsFromMap(calls, methodName),
    implementsNames: [],
  };
}

// ---------------------------------------------------------------------------
// Extract a class or module body
// ---------------------------------------------------------------------------

function extractBody(
  bodyNode: TSNode,
  ctx: ExtractionContext,
  parentName: string,
  symbols: SymbolNode[],
): void {
  if (!bodyNode) return;

  for (const child of bodyNode.namedChildren) {
    extractNode(child, ctx, parentName, symbols);
  }
}

// ---------------------------------------------------------------------------
// Extract a single node
// ---------------------------------------------------------------------------

function extractNode(
  node: TSNode,
  ctx: ExtractionContext,
  parentName: string | null,
  symbols: SymbolNode[],
): void {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;

  switch (node.type) {
    case 'class': {
      // class Foo [< Bar] ... end
      const nameNode = firstChildOfTypes(node, ['constant', 'scope_resolution']);
      if (!nameNode) return;
      const name = parentName ? `${parentName}::${nameNode.text}` : nameNode.text;

      // superclass: class Foo < Bar — tree-sitter exposes the superclass as a child
      let extendsName: string | undefined;
      const superclassNode = firstChildOfType(node, 'superclass');
      if (superclassNode) {
        const superNode = firstChildOfTypes(superclassNode, ['constant', 'scope_resolution']);
        if (superNode) extendsName = superNode.text;
      }

      const implementsNames: string[] = [];

      const classSymbol: SymbolNode = {
        id: `${ctx.fileId}#${name}`,
        name,
        kind: 'class',
        startLine,
        endLine,
        isExported: true, // Ruby classes are always public
        calls: [],
        extendsName,
        implementsNames,
      };
      symbols.push(classSymbol);

      // Extract body
      const body = firstChildOfType(node, 'body_statement');
      if (body) extractBody(body, ctx, name, symbols);
      break;
    }

    case 'module': {
      const nameNode = firstChildOfTypes(node, ['constant', 'scope_resolution']);
      if (!nameNode) return;
      const name = parentName ? `${parentName}::${nameNode.text}` : nameNode.text;

      const modSymbol: SymbolNode = {
        id: `${ctx.fileId}#${name}`,
        name,
        kind: 'class', // modules modeled as class
        startLine,
        endLine,
        isExported: true,
        calls: [],
        implementsNames: [],
      };
      symbols.push(modSymbol);

      const body = firstChildOfType(node, 'body_statement');
      if (body) extractBody(body, ctx, name, symbols);
      break;
    }

    case 'method':
    case 'singleton_method': {
      const sym = extractMethod(node, ctx, parentName);
      if (sym) symbols.push(sym);
      break;
    }

    case 'assignment': {
      // Constant assignment: FOO = ...
      const leftNode = node.namedChildren[0];
      if (!leftNode) return;
      // Constants start with uppercase
      if (leftNode.type === 'constant' && /^[A-Z]/.test(leftNode.text)) {
        const constName = parentName ? `${parentName}::${leftNode.text}` : leftNode.text;
        symbols.push({
          id: `${ctx.fileId}#${constName}`,
          name: constName,
          kind: 'constant',
          startLine,
          endLine,
          isExported: true,
          calls: [],
          implementsNames: [],
        });
      }
      break;
    }

    case 'call': {
      // Detect Rails DSLs: include/extend/prepend (implement edges)
      // and has_many/belongs_to/before_action etc.
      if (!parentName) return;

      const receiver = node.namedChildren[0];
      const methodNode = node.namedChildren.find(
        (c: TSNode) => c.type === 'identifier',
      );
      if (!methodNode) return;
      const methodName = methodNode.text;

      if (methodName === 'include' || methodName === 'extend' || methodName === 'prepend') {
        // include Foo → implements edge
        const args = firstChildOfType(node, 'argument_list') ?? firstChildOfType(node, 'arguments');
        if (args) {
          for (const arg of args.namedChildren) {
            const modName = getConstantName(arg);
            if (modName) {
              // Add to parent class's implementsNames (post-process)
              ctx.extraCalls.push({ fromId: `${ctx.fileId}#${parentName}`, toName: modName });
            }
          }
        }
      } else if (RAILS_ASSOCIATION_METHODS.has(methodName)) {
        // has_many :comments → Comment model
        const args = firstChildOfType(node, 'argument_list') ?? firstChildOfType(node, 'arguments');
        const firstArg = args?.namedChildren[0];
        if (firstArg?.type === 'simple_symbol') {
          const assocName = firstArg.text.replace(/^:/, '');
          const modelName = associationToModel(assocName);
          ctx.extraCalls.push({ fromId: `${ctx.fileId}#${parentName}`, toName: modelName });
          ctx.associationTargets.push(modelName);
        }
      } else if (RAILS_CALLBACK_METHODS.has(methodName)) {
        // before_action :method_name → calls edge within same class
        const args = firstChildOfType(node, 'argument_list') ?? firstChildOfType(node, 'arguments');
        const firstArg = args?.namedChildren[0];
        if (firstArg?.type === 'simple_symbol') {
          const refMethod = firstArg.text.replace(/^:/, '');
          ctx.extraCalls.push({ fromId: `${ctx.fileId}#${parentName}`, toName: refMethod });
        }
      } else if (RAILS_DSL_METHODS.has(methodName)) {
        // attr_accessor, delegate, scope, enum, etc. → emit method symbols
        extractDslMethods(node, methodName, parentName, ctx, symbols);
      }
      break;
    }

    // Handle bare method calls at class scope (include, has_many, etc.)
    case 'command': {
      if (!parentName) return;
      const methodNode = node.namedChildren[0];
      if (!methodNode || methodNode.type !== 'identifier') return;
      const methodName = methodNode.text;

      if (methodName === 'include' || methodName === 'extend' || methodName === 'prepend') {
        const args = node.namedChildren.slice(1);
        for (const arg of args) {
          const modName = getConstantName(arg);
          if (modName) {
            ctx.extraCalls.push({ fromId: `${ctx.fileId}#${parentName}`, toName: modName });
          }
        }
      } else if (RAILS_ASSOCIATION_METHODS.has(methodName)) {
        const firstArg = node.namedChildren[1];
        if (firstArg?.type === 'simple_symbol') {
          const assocName = firstArg.text.replace(/^:/, '');
          const modelName = associationToModel(assocName);
          ctx.extraCalls.push({ fromId: `${ctx.fileId}#${parentName}`, toName: modelName });
          ctx.associationTargets.push(modelName);
        }
      } else if (RAILS_CALLBACK_METHODS.has(methodName)) {
        const firstArg = node.namedChildren[1];
        if (firstArg?.type === 'simple_symbol') {
          const refMethod = firstArg.text.replace(/^:/, '');
          ctx.extraCalls.push({ fromId: `${ctx.fileId}#${parentName}`, toName: refMethod });
        }
      } else if (RAILS_DSL_METHODS.has(methodName)) {
        extractDslMethodsFromCommand(methodName, parentName, node, ctx, symbols);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Import resolution
// ---------------------------------------------------------------------------

export interface RubyImport {
  raw: string;           // original require string
  resolved: string | null; // relative file path or null for external
  isRelative: boolean;
}

/** Known gem/stdlib names — skip these as external */
const STDLIB_PREFIXES = new Set([
  'json', 'yaml', 'csv', 'net/', 'openssl', 'base64', 'digest',
  'date', 'time', 'uri', 'fileutils', 'pathname', 'set',
  'singleton', 'forwardable', 'ostruct', 'struct', 'logger',
  'securerandom', 'benchmark', 'pp', 'io/', 'cgi', 'erb',
  'tempfile', 'tmpdir',
]);

function isExternalGem(specifier: string): boolean {
  // Gems typically use simple names without slashes, or known stdlib prefixes
  if (STDLIB_PREFIXES.has(specifier)) return true;
  for (const prefix of STDLIB_PREFIXES) {
    if (specifier.startsWith(prefix)) return true;
  }
  // If no slash and no dot, likely a gem
  if (!specifier.includes('/') && !specifier.includes('.')) return true;
  return false;
}

export function resolveRubyRequire(
  specifier: string,
  fromFilePath: string,
  isRelative: boolean,
  projectRoot: string,
): string | null {
  if (!isRelative && isExternalGem(specifier)) return null;

  const base = isRelative
    ? resolve(dirname(fromFilePath), specifier)
    : resolve(projectRoot, specifier);

  // Return without extension (resolver will try appending .rb)
  return base;
}

// ---------------------------------------------------------------------------
// Constant and render collection (Rails autoload + render)
// ---------------------------------------------------------------------------

function isConstantDefinitionContext(node: TSNode): boolean {
  // True if this constant is a definition (class/module name, assignment LHS), not a reference.
  const p = node.parent;
  if (!p) return false;
  // class Foo / module Foo — constant is first named child, don't resolve
  if ((p.type === 'class' || p.type === 'module') && p.namedChildren[0] === node) return true;
  // Assignment LHS (FOO = 1) — don't resolve
  if (p.type === 'assignment' && p.namedChildren[0] === node) return true;
  return false;
}

function shouldSkipConstantContext(node: TSNode): boolean {
  // Skip if we're inside include/extend/prepend (already handled) or has_many/etc.
  let p = node.parent;
  while (p) {
    if (p.type === 'call' || p.type === 'command') {
      const mNode = p.type === 'call'
        ? p.childForFieldName?.('method')
        : p.namedChildren[0];
      const m = mNode?.text;
      if (m === 'include' || m === 'extend' || m === 'prepend') return true;
    }
    // Don't walk past statement boundaries
    if (p.type === 'body_statement' || p.type === 'program' || p.type === 'method' || p.type === 'class' || p.type === 'module') break;
    p = p.parent;
  }
  return false;
}

function collectConstantReferences(root: TSNode): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  function visit(node: TSNode): void {
    if (node.type === 'constant' || node.type === 'scope_resolution') {
      if (node.type === 'scope_resolution') {
        // Don't descend into scope_resolution children — we want the full path
        if (!isConstantDefinitionContext(node) && !shouldSkipConstantContext(node)) {
          const txt = node.text;
          if (!seen.has(txt) && !isConstantStoplisted(txt)) {
            seen.add(txt);
            out.push(txt);
          }
        }
        return;
      }
      // Bare constant
      if (!isConstantDefinitionContext(node) && !shouldSkipConstantContext(node)) {
        const txt = node.text;
        if (!seen.has(txt) && !isConstantStoplisted(txt)) {
          seen.add(txt);
          out.push(txt);
        }
      }
    }
    for (const c of node.namedChildren) visit(c);
  }
  visit(root);
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RubyParseResult {
  imports: string[];
  exports: string[];
  hasDefaultExport: false;
  symbols: SymbolNode[];
  constantReferences?: string[];  // FQCNs to resolve via Rails autoload
}

const RUBY_MAX_STRING = 32000;
const RUBY_CHUNK_SIZE = 4096;

function parseContent(parser: TSNode, content: string): TSNode {
  if (content.length <= RUBY_MAX_STRING) {
    return parser.parse(content);
  }
  return parser.parse((startIndex: number) => {
    if (startIndex >= content.length) return null;
    return content.slice(startIndex, startIndex + RUBY_CHUNK_SIZE);
  });
}

export function parseRubyContent(
  content: string,
  fileId: string,
): RubyParseResult {
  const parser = getParser();
  let tree;
  try {
    tree = parseContent(parser, content);
  } catch (err) {
    throw new Error(`Tree-sitter failed to parse Ruby (${content.length} chars): ${err}`);
  }
  const root: TSNode = tree.rootNode;

  const imports: string[] = [];
  const exports: string[] = [];
  const rawSymbols: SymbolNode[] = [];

  const ctx: ExtractionContext = {
    fileId,
    allSymbolNames: new Set<string>(),
    extraCalls: [],
    associationTargets: [],
  };

  // First pass: collect all require/require_relative calls
  function collectRequires(node: TSNode): void {
    if (node.type === 'call') {
      const methodNode = node.namedChildren.find((c: TSNode) => c.type === 'identifier');
      const isRelative = methodNode?.text === 'require_relative';
      if (isRelative || methodNode?.text === 'require') {
        const args = firstChildOfType(node, 'argument_list') ?? firstChildOfType(node, 'arguments');
        const strNode = args
          ? firstChildOfTypes(args, ['string', 'string_literal'])
          : firstChildOfTypes(node, ['string', 'string_literal']);
        if (strNode) {
          const content = firstChildOfType(strNode, 'string_content');
          const raw = content?.text ?? strNode.text.replace(/^['"]|['"]$/g, '');
          if (raw) imports.push(normalizeRequire(raw, isRelative));
        }
      }
    } else if (node.type === 'command') {
      const methodNode = node.namedChildren[0];
      const isRelative = methodNode?.text === 'require_relative';
      if (methodNode?.type === 'identifier' && (isRelative || methodNode.text === 'require')) {
        const strNode = node.namedChildren.find(
          (c: TSNode) => c.type === 'string' || c.type === 'string_literal',
        );
        if (strNode) {
          const content = firstChildOfType(strNode, 'string_content');
          const raw = content?.text ?? strNode.text.replace(/^['"]|['"]$/g, '');
          if (raw) imports.push(normalizeRequire(raw, isRelative));
        }
      }
    }
    for (const child of node.namedChildren) {
      collectRequires(child);
    }
  }

  function normalizeRequire(raw: string, isRelative: boolean): string {
    if (isRelative && !raw.startsWith('.') && !raw.startsWith('/')) {
      return './' + raw;
    }
    return raw;
  }

  collectRequires(root);

  // Second pass: extract symbols from top-level nodes
  for (const node of root.namedChildren) {
    extractNode(node, ctx, null, rawSymbols);
  }

  // Build exports from public symbols
  for (const sym of rawSymbols) {
    if (sym.isExported && sym.kind !== 'method') {
      exports.push(sym.name);
    }
  }

  // Apply extra calls (include/extend/prepend → implementsNames, Rails associations → calls)
  const symbolById = new Map<string, SymbolNode>(rawSymbols.map(s => [s.id, s]));
  for (const { fromId, toName } of ctx.extraCalls) {
    const sym = symbolById.get(fromId);
    if (sym) {
      // For include/extend/prepend: add to implementsNames
      // For Rails associations/callbacks: add to calls
      sym.implementsNames.push(toName);
    }
  }

  // For Rails models (files under app/models/), convert association names to file-level imports
  if (fileId.includes('app/models/')) {
    for (const modelName of ctx.associationTargets) {
      const modelSnake = modelName.replace(/([A-Z])/g, '_$1').slice(1).toLowerCase();
      const importPath = `./${modelSnake}`;
      if (!imports.includes(importPath)) {
        imports.push(importPath);
      }
    }
  }

  // Extract routes.rb controller imports
  if (fileId.endsWith('config/routes.rb')) {
    const routeImports = extractRoutesImports(root, fileId);
    for (const imp of routeImports) {
      if (!imports.includes(imp)) {
        imports.push(imp);
      }
    }
  }

  // Collect Rails autoload constant references
  const constantReferences = collectConstantReferences(root);

  // Resolve intra-file calls: replace plain names with full IDs
  const symbolIdByName = new Map<string, string>(rawSymbols.map(s => [s.name, s.id]));
  const resolvedSymbols = rawSymbols.map(sym => ({
    ...sym,
    calls: sym.calls.map(c => ({ name: symbolIdByName.get(c.name) ?? c.name, line: c.line })),
  }));

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    hasDefaultExport: false,
    symbols: resolvedSymbols,
    constantReferences: constantReferences.length > 0 ? constantReferences : undefined,
  };
}
