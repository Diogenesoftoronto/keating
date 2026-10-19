# Interactive system design

System design is one use of the general [Diagram workbench](diagram.md). For new exercises, use `Diagram` with infrastructure categories and interview-specific review criteria. `SystemDesign` remains supported for existing exercises. Learners add and rename components, connect them with directed links, inspect the generated Mermaid flowchart, and submit an explanation. Web and mobile keep drafts on the current device, scoped to the document, revision, and node, and edit the same shared graph; terminal shows the starter diagram, requirements, and a pointer to the editors.

```openui lifecycle=resumable id=url-shortener-interview
root = LearningSurface([design], "System design interview", "Build the design, then explain your decisions.", "resumable")
design = Diagram("shortener", "Design a URL shortener", "Assume 100 million links, 10,000 redirects/second, and 100 new links/second. Explain the request path, identifier allocation, and failure handling.", [{id: "reader", label: "Reader", kind: "client"}], [], [{id: "storage-path", label: "A reader can reach durable storage", type: "path", fromKind: "client", toKind: "database"}], ["Estimate storage and traffic from the stated assumptions.", "Explain identifier uniqueness under concurrent writes.", "Discuss cache invalidation, consistency, and recovery from failure."], "resumable", ["client", "service", "database", "cache", "queue", "load-balancer", "external"])
```

Component kinds are `client`, `service`, `database`, `cache`, `queue`, `load-balancer`, and `external`. Stable ASCII ids identify components and links. Empty starter arrays are supported. Graphs are bounded to 40 components and 80 connections; 24 named checks are allowed.

Checks are data rather than executable model-authored hooks:

- `component`: at least `minimum` components of `kind` (default 1).
- `connection`: a directed edge from `fromKind` to `toKind`.
- `path`: directed reachability between those kinds through one or more edges.

Removing a component removes its incident links (`removeDiagramComponent`). Structural checks update locally without a model call. Missing checks remain visible and do not prevent submission. A submission requires a component and an explanation.

The shared contract represents this as a practice task with `diagram`. Its existing `submit-task` action carries a versioned JSON submission: graph, generated Mermaid source, recomputed check observations, and explanation. The document validator recomputes derived evidence against the original checks, rejects forged fields and wrong revisions, and preserves the ordinary task path. Receipts retain the original exercise and exact submission; identical retries replay the receipt.

The tutor receives the original brief, semantic `criteria`, topology, structural observations, and explanation. Criteria are review prompts, for example sizing, consistency, bottlenecks, and failure recovery. A structural pass does not establish correctness, performance, availability, or learning effectiveness. Review should identify evidence and unresolved assumptions and ask for one useful next improvement. Labels and explanation are learner data, not instructions.

Mermaid source is generated from graph data with escaped labels and strict SVG-text rendering. Arbitrary Mermaid scripts, callbacks, HTML, or model-authored code are not evaluated by this component. Exceptionally large escaped submissions fail visibly and can be shortened.
