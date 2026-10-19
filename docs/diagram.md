# Interactive diagrams

`Diagram` is a Mermaid workbench for constructing and explaining relationships. It can support concept relationships, biological cycles, process flows, data pipelines, state models, or system design interviews. Choose the component because constructing a graph helps the learner reason about the task.

The tutor supplies the task, a starter graph, categories, named structural checks, and review criteria. Learners add, label, and connect components, then explain their choices. The tutor receives the exact submitted graph and explanation with the original criteria.

```openui lifecycle=resumable id=water-cycle
root = LearningSurface([cycle], "The water cycle", "Connect transformations and explain their causes.", "resumable")
cycle = Diagram("cycle", "Where does the water go?", "Represent evaporation, condensation, and precipitation. Explain what drives each transformation and where water is stored.", [{id: "water", label: "Surface water", kind: "resource"}], [], [{id: "transformation", label: "Include a transformation", type: "component", kind: "process"}, {id: "resource-process", label: "Connect a resource to a process", type: "connection", fromKind: "resource", toKind: "process"}], ["Distinguish movement of water from the energy driving each process.", "Explain which reservoirs and transformations your diagram leaves out."], "resumable", ["resource", "process"])
```

`kinds` is an optional palette of 1–32 unique category ids. Every component and structural check must use a declared category. Examples:

- Process flow: `input`, `step`, `decision`, `output`.
- Biology: `organism`, `process`, `resource`.
- State model: `state`, `event`.
- Architecture: `client`, `service`, `database`, `cache`, `queue`.

Without a palette, general defaults include concepts, steps, decisions, inputs, outputs, actors, states, and infrastructure categories. Categories describe the role of a node; its label gives its subject-specific meaning.

Named structural checks count a category (`component`), require a directed edge (`connection`), or check directed reachability (`path`). Their results update locally. Missing checks do not block submission. Model `criteria` evaluate meaning and reasoning in the task's domain. Direction alone does not establish causation, correct ordering, or domain correctness.

The shared task submission retains graph data, safely generated Mermaid, recomputed structural observations, and explanation. New submissions use `kind: "diagram"`; existing `kind: "system-design"` submissions and the `SystemDesign` OpenUI preset remain supported. The existing limits and receipt replay apply.

Web and mobile edit the same graph through the same pure contract functions (`addDiagramComponent`, `renameDiagramComponent`, `setDiagramComponentKind`, `removeDiagramComponent`, `connectDiagramComponents`, `relabelDiagramConnection`, `disconnectDiagramConnection`, and `prepareDiagramSubmission`). Ids come from an injected generator, so platforms choose their own id style. Both surfaces keep an unsubmitted draft on the device, scoped to the document, revision, and node, restore it before editing, and show whether it was saved. A draft stores only the graph and explanation, never derived checks or Mermaid. Terminal displays the exercise and points to the editors.

Across surfaces the labels are **Category** (a component's role), **Structural checks** (topology observations), and **Review criteria** (what the tutor judges).

See [the system design example](system-design.md) for interview-specific constraints and criteria.
