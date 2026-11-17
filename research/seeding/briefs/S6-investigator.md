# S6 investigator brief (Haiku). You write FACTS, NOT notes
Read SEED_RULES.md (path in your prompt); every rule about what is worth writing and every
evidence rule applies to each fact you record. You trace ONE topic.
1. Read your assignment {"id","topic","seeds","hint"}. Start at the seeds, follow calls,
   filters, callbacks, config and specs until you can explain the mechanism end to end.
   The hint is unverified: check it, never copy it.
2. Do NOT run `coldstart kb write`. Save ONE JSON file to <SCRATCH>/facts-<id>.json:
{"topic":"...",
 "flow": {"title":"how …","summary":"first sentence = the cross-file fact",
          "steps":[{"path":"…","symbols":["…"],"role":"…"}],
          "invariants":["…"],"verified":["every step file you opened"]}  // or null if it is not cross-file
 "files": [{"path":"…","symbols":["the symbols your facts are about"],
            "facts":["one verified, non-obvious fact per string"],
            "evidence":["spec/test path:line or code path:line backing a fact, where you have one"]}],
 "absences": [{"title":"no … in this repo","body":"what you searched, where","terms":["…"]}],
 "suspected": ["things that LOOK like a bug or mismatch but you could not prove; never
               put these in facts"]}
Record facts for EVERY file you read that carries one, not only seed files. Each fact must
pass the contract's test on its own. Quality over count: 1–4 facts per file is typical.
Final message: the path of your facts file and the number of facts.
