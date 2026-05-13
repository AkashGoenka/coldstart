# JVM resolver extensions — Spring DI, JPA, Spring Boot config

Status: research spec. No code changes implied; this is the design before any patch lands.

## TL;DR

Coldstart's JVM resolver today maps `import x.y.Z` → file via an FQCN index built from
source-root paths (`src/main/java/...`, `src/<set>/{java,kotlin}/`). Anything wired by
Spring at runtime — or referenced from the same package without an explicit import — is
invisible. The fix is a new **convention extractor** that walks the AST for a small set
of annotations and emits synthetic file-level imports, the same way the Ruby extractor
emits Rails association imports today.

This spec covers six conventions, scoped to "navigation-grade" precision:

1. DI by interface type (`@Autowired` / constructor injection of an interface).
2. `@Qualifier` narrowing.
3. JPA relationships (`@OneToMany`, `@ManyToOne`, …) via the field type.
4. Same-package entity references (JPA fields whose target is in the same package, so no `import` appears).
5. `@ConfigurationProperties` ↔ `application.{yml,properties}` linkage.
6. Decision: `@RequestMapping` → views / templates.

Out of scope (documented as edge cases): XML bean defs, factory beans, conditional
beans, `BeanFactory.getBean()` reflective lookup, generated proxy classes.

## Surface forms

### Java

These are the AST shapes (tree-sitter-java) the extractor needs to recognise. The
existing `getAnnotations` helper in `src/indexer/extractors/java.ts` already pulls
annotation names off `class_declaration` / `field_declaration` / `method_declaration` /
`formal_parameter` modifier lists. We need to extend it to also capture annotation
**arguments** (`annotation_argument_list`) and to walk `formal_parameter` of
constructors.

| Convention | Annotation | Node it attaches to | What to extract |
| --- | --- | --- | --- |
| Bean class | `@Component`, `@Service`, `@Repository`, `@Controller`, `@RestController`, `@Configuration` | `class_declaration` | class name; bean name = annotation arg if present, else `lowerCamel(className)` |
| Field DI | `@Autowired`, `@Inject`, `@Resource` | `field_declaration` | field type (`type_identifier` / `generic_type`); `@Qualifier("name")` if sibling |
| Constructor DI | (no annotation needed in Spring 4.3+; presence of single ctor implies DI) | `constructor_declaration` → `formal_parameters` | each parameter's `type` and optional `@Qualifier` annotation |
| Setter DI | `@Autowired` on setter | `method_declaration` (name starts with `set`) | single param type |
| Bean factory | `@Bean` | `method_declaration` inside `@Configuration` class | return type → maps to bean providing that type |
| JPA entity | `@Entity`, `@MappedSuperclass`, `@Embeddable` | `class_declaration` | class name; entity name = `name=` arg or class name |
| JPA relationship | `@OneToMany`, `@ManyToOne`, `@OneToOne`, `@ManyToMany` | `field_declaration` | inner type of collection (`List<Pet>` → `Pet`) or direct type; `mappedBy=`, `targetEntity=` args |
| JPA JPQL | `@Query("SELECT u FROM User u …")` | `method_declaration` annotation | parse the string for `FROM <EntityName>` / `JOIN <EntityName>` |
| Config props | `@ConfigurationProperties(prefix="x.y")` | `class_declaration` | the prefix string |
| Routing | `@RequestMapping`, `@GetMapping`, … | `class_declaration` / `method_declaration` | view-name return value (string literal from method body) |

Annotation argument access in tree-sitter-java: the argument list node type is
`annotation_argument_list`; named args are `element_value_pair { name, value }`; the
single-positional form (`@Qualifier("foo")`) is just a `string_literal` child of the
argument list.

### Kotlin

tree-sitter-kotlin's AST is shaped differently — annotations are first-class siblings,
not modifiers — but every Spring annotation that works in Java also works in Kotlin.

| Convention | Kotlin form | tree-sitter-kotlin nodes |
| --- | --- | --- |
| Bean class | `@Service class Foo` | `class_declaration` preceded by `annotation` siblings (or as `modifiers` child) |
| Field DI | `@Autowired lateinit var x: T` or constructor `class Foo(val x: T)` | `property_declaration` with `annotation`; primary ctor's `class_parameter` |
| JPA relationship | `@OneToMany val pets: List<Pet>` | `property_declaration`; type via `user_type` / `type_arguments` |
| JPQL | `@Query("...")` | same |

Practical concern: tree-sitter-kotlin's grammar is the one source-built grammar
coldstart ships (`reference_tree_sitter_prebuilds.md` notes only this grammar compiles
from source). It loads — coldstart already uses it in `extractors/kotlin.ts` — so the
POC could in principle parse Kotlin. **This spec defers Kotlin POC because no test
corpus uses Kotlin + Spring.** The Java POC validates the design; once a Kotlin Spring
repo exists in the benchmark set, swap in the Kotlin parser and translate the node
types per the table above.

## Resolution rules

All rules emit zero or more **synthetic imports** as FQCNs (or bare class names — see
below). Synthetic imports flow through the existing `resolveJava` resolver and its
FQCN-index, so files end up resolved via the same code path as real `import`
statements.

### 1. DI by type

For each injection site (field / ctor param / setter param) whose declared type `T`:

  a. If `T` is a class that has been seen as `@Component`/`@Service`/`@Repository` —
     emit one edge: injection-site-file → bean-file.

  b. If `T` is an interface — look up all classes that `implements T`. The existing
     `implementsNames` field on `SymbolNode` is already extracted at parse time.
     Emit one edge per implementor that is itself a Spring bean.

  c. If `T` is an interface extending `JpaRepository<E, ID>` / `CrudRepository<…>` —
     no implementor class exists in user code (Spring Data generates it at runtime).
     Emit an edge to the **interface file itself**: navigationally that's where the
     human would go.

  d. If `@Qualifier("beanName")` is present, prefer the bean whose name matches; if
     none match, fall back to all of (a)/(b) (don't drop the edge — the human can
     still navigate).

### 2. JPA relationships

For a field annotated `@OneToMany` / `@ManyToOne` / `@OneToOne` / `@ManyToMany`:

  a. Resolve the inner type of `Collection<T>` / `List<T>` / `Set<T>`, else the bare type.
  b. If `targetEntity = Pet.class` is set, use that instead.
  c. Emit a synthetic import for `T`, resolved via the entity-name index (see §3).

If `mappedBy = "owner"` is present, that's a hint that the target entity has a field
named `owner` pointing back — useful for cluster-bridging but not for the synthetic
edge itself (the edge is the same either direction).

### 3. Entity-name index

Build a parallel name→FQCN map: scan every class with `@Entity` and record
`(entityName, fqcn)` where `entityName = @Entity(name=…)` if present, else the class's
simple name. This lets us resolve JPQL strings (`SELECT u FROM User u`) and short-name
references in `@OneToMany` fields when the import is missing (same-package case).

Same-package resolution **without an explicit import** is a real gap, not Spring-
specific: `Owner.java` references `Pet` (same package) and coldstart records no edge
today. The simplest fix is: for any unresolved short type name referenced from a JPA
annotation, try `<currentPackage>.<ShortName>` against the FQCN index before falling
back to the entity-name index. This generalises: do it for **all** synthetic-edge
sources, not just JPA.

### 4. `@ConfigurationProperties` ↔ config files

For every class annotated `@ConfigurationProperties(prefix = "spring.foo")`:

  a. Walk `application*.{yml,yaml,properties}` (already indexed by the YAML / env
     extractors).
  b. For each one that contains a top-level key matching the prefix (`spring.foo.*`),
     emit a bidirectional synthetic edge.

Implementation note: the YAML extractor today indexes generic YAML, not specifically
Spring config. A new small extractor (or a hook in the existing one) needs to mark
files matching `**/application*.{yml,yaml,properties}` and expose their key set to
the JVM resolver. The edge is **file-level** (bean-class file ↔ config file), not
key-level.

### 5. `@Bean` factory methods

A `@Bean` method inside an `@Configuration` class returns a bean of the method's
return type. For navigation purposes, emit:

  - edge from the config class to the bean's class file (the type being returned), so
    "who constructs this thing?" is discoverable.
  - DI sites typed by that return type also link to the config class (in addition to
    any class-level `@Component` implementations).

### 6. Routing / controller→view

**Decision needed.** Coldstart's existing Rails work emits controller↔view
bidirectional edges. For Spring:

- `@RequestMapping("/owners")` on the class plus `@GetMapping("/new")` on a method
  defines a route; the method **returns a string** that's the template name
  (`"owners/findOwners"` → `src/main/resources/templates/owners/findOwners.html`).
- Today the Java resolver does **not** emit any controller→template edge. Verified
  by grepping the resolver/extractor: zero references to `templates/`, `.html`,
  `view`, or `Mapping`.

**Recommendation:** emit controller→template edges in a follow-up. The mechanism is
straightforward (string-return scan within a `@GetMapping`-annotated method, glue
`templates/` + return value + `.html`), but it's separable from the DI/JPA work and
each method needs a string-literal-return walker that we don't have yet. Keep it on
the JVM resolver TODO list.

## Stoplist

Skip when the declared type or implementor class is in any of these packages:

```
java.*
javax.*
jakarta.*           (jakarta.persistence.Entity etc. — the annotations themselves
                     are real, but their *types* like jakarta.validation.Valid
                     don't need synthetic edges)
kotlin.*
kotlinx.*
scala.*
org.springframework.*  (framework classes; user-code @Configuration extending a
                        Spring class still gets the user-side edge)
com.sun.*
sun.*
```

Plus these primitive / built-in short names when they appear unqualified in a field
type position:

```
String, Integer, Long, Short, Byte, Boolean, Character, Float, Double, Object,
Void, Number, BigDecimal, BigInteger, List, Map, Set, Collection, Optional,
LocalDate, LocalDateTime, LocalTime, Instant, Duration, UUID, URL, URI, Path,
File, Date, Calendar
```

(All of these resolve to `java.*` once their import is checked, but for unqualified
references in same-package or wildcard-import scenarios we never see the import.)

The existing FQCN index lookup naturally filters out anything not in the user's
source tree — `java.util.List` simply isn't in `byFqcn` — so the stoplist is mostly
a performance / log-noise hygiene measure, not a correctness one.

## Edge cases (document, don't solve)

- **Spring profiles.** `@Profile("dev")` on a bean class. We emit the edge regardless;
  the dev-only bean is still a valid navigation target. Profile awareness would
  require runtime config, out of scope for static analysis.
- **Conditional beans.** `@ConditionalOnProperty`, `@ConditionalOnClass`, etc. Same
  treatment — emit the edge, ignore the condition.
- **Factory beans / `FactoryBean<T>`.** A class implementing `FactoryBean<Foo>`
  produces `Foo` at runtime. Treat the factory class as a bean providing `Foo` (one
  extra rule in the bean-provider map). Low priority.
- **Generic type parameters.** `Repository<User>` injection — the **type argument** is
  what we want, not the raw `Repository`. tree-sitter `generic_type`'s `type_arguments`
  field gives us this; strip the raw type and recurse on the arguments.
- **`BeanFactory.getBean("name")` / `ApplicationContext.getBean(...)`.** Reflective
  runtime lookup, unresolvable statically. Skip.
- **Polymorphic injection (multiple impls).** Emit edges to **all** candidate
  implementors. The cluster mechanism downstream is supposed to disambiguate; a single-
  edge greedy choice would discard signal.
- **XML bean defs (`<bean id="..." class="..."/>`).** Legacy Spring. The XML extractor
  exists; a hook there could emit bean-name → class FQCN, which the DI extractor would
  consume. Low priority — none of the test repos use it heavily.
- **`@Primary` / `@Order`.** Disambiguation hints. Track but don't drop the non-
  primary edges; surface them in identical order in the synthetic-import list (the
  ranker can prioritise downstream).
- **Same-FQCN, different file** (e.g. main + test source roots both define
  `com.foo.Bar`). Existing FQCN-index behaviour is "first wins, source-root-tagged
  prefers structured paths". JPA + DI edges follow the same rule.

## Integration sketch

Files to touch (all under `src/indexer/`):

1. **`extractors/java.ts`** — extend `getAnnotations` to also collect annotation
   arguments. Add a new `extractSpringConventions` pass that walks `class_declaration`
   / `field_declaration` / `formal_parameter` / `method_declaration` and emits typed
   records:

   ```ts
   type SpringEdge =
     | { kind: 'bean'; fqcn: string; beanName: string; stereotype: string }
     | { kind: 'inject'; fromFqcn: string; targetType: string; qualifier?: string }
     | { kind: 'jpa-relation'; fromFqcn: string; targetType: string; targetEntity?: string }
     | { kind: 'entity'; fqcn: string; entityName: string }
     | { kind: 'config-props'; fqcn: string; prefix: string }
     | { kind: 'bean-factory'; configFqcn: string; returnType: string };
   ```

   Tack `springEdges: SpringEdge[]` onto `JavaParseResult`. Equivalent change in
   `extractors/kotlin.ts`.

2. **`resolvers/java.ts`** — add a second-pass helper invoked **after** all files are
   parsed (so `byFqcn` and the new `byEntityName` / `byInterface` / `byBeanName` maps
   are complete). It folds the `springEdges` into synthetic imports per file.

   The current `resolveJava` is per-import-string. The new code path is per-file,
   reading `springEdges` and appending to that file's `imports[]` array before the
   import-resolution stage of the indexer. The natural hook is `graph.ts`'s pre-
   resolve pass — or, mirroring the Ruby pattern, do it inside the extractor by
   appending to `imports[]` directly. The Ruby approach is simpler but pays the cost
   of one redundant traversal; the resolver approach is more efficient but couples
   the extractor to the post-parse phase. **Recommend the Ruby approach for v1.**

3. **`graph.ts`** — no changes if approach (2.Ruby-style) is taken; synthetic imports
   appear in the same `imports[]` array and flow through normally.

4. **`extractors/yaml.ts`** — add a small marker for Spring Boot config files
   (`application*.{yml,yaml,properties}`) so the JVM resolver can match `prefix=` to
   top-level keys. Could also live in `extractors/env.ts` since `.properties` files
   are key=value. Keep the marker simple: a `springConfigKeys: Set<string>` exposed
   alongside the file's symbols.

5. **`types.ts`** — extend `SymbolNode` only if we want to mark "is a bean" / "is an
   entity" for downstream ranking. v1 doesn't need it.

## Prioritisation (within the JVM resolver effort)

Land in this order; each step is independently shippable.

1. **Same-package entity references** — pure correctness fix, no new annotation
   work needed. Walk the JPA field-type extractor over `@OneToMany` etc., resolve
   short names via `<currentPackage>.<ShortName>`. Highest precision/recall ratio,
   smallest blast radius.

2. **JPA relationships (full)** — adds `targetEntity=` / generic-arg handling and
   entity-name index for JPQL. Same-package fix above is a subset.

3. **DI by interface type** — adds bean-stereotype scan + interface→implementors
   index. The lookup uses `implementsNames` which already exists.

4. **`@Qualifier` narrowing** — small refinement on top of (3).

5. **`@ConfigurationProperties`** — needs the YAML/properties marker (small new
   work).

6. **`@Bean` factory methods** — orthogonal to DI; reasonable add once the bean
   index exists.

7. **Controller → template** — orthogonal, defer until there's a clear win on a
   benchmark.

8. **XML bean defs** — defer indefinitely unless a benchmark repo demands it.

## Verification corpus

- `/tmp/spring-petclinic` — canonical Spring Boot sample. JPA + DI + controllers.
  No `@ConfigurationProperties`, no XML beans. Constructor injection without
  `@Autowired` (Spring 4.3+ style).
- `~/benchmark/repos/liya-hai/le-lia-maine-coldstart-v2` — large legacy Spring 4.x
  app (private). Has `@Service`, `@Autowired`, plus probable XML bean defs given
  the version. Not used for the POC because private.
- `~/benchmark/repos/jmri` — Java but not Spring; useful as a negative control
  (stoplist + annotation-density-low should produce zero synthetic edges).

Note (honesty): the POC was run against spring-petclinic only. Liya-hai contains
real Spring DI but is private, so I didn't read the source while writing this spec —
the design choices for legacy Spring 4 (XML beans, classic `@Autowired` field
injection) are inferred from the version, not verified against the corpus.
