---
title: "Research Map"
description: "Research papers behind Ax: DSPy, DSPy Assertions, GEPA, ACE, Recursive Language Models, PEEK — plus the agent-learning lineage: Reflexion, ExpeL, Self-RAG, Attributed QA, STOP, Darwin Gödel Machine, and Self-Harness."
standalone: true
toc: true
---

# Research Map

Ax is a practical library, but its shape is not accidental. The core ideas line up with a serious LLM systems lineage: declarative model programs, signatures, constraints, reflective optimization, runtime-backed long-context work, persistent context maps, learning from failures, attributed answers, and regression-validated self-improvement.

This page is not an endorsement wall. It is a map from public research ideas to the Ax concepts users see in the docs.

<div class="research-map home-research-list">
  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2310.03714">DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines</a></h2></div>
    <p><strong>Authors:</strong> Omar Khattab, Arnav Singhvi, Paridhi Maheshwari, Zhiyuan Zhang, Keshav Santhanam, Sri Vardhamanan, Saiful Haq, Ashutosh Sharma, Thomas T. Joshi, Hanna Moazam, Heather Miller, Matei Zaharia, Christopher Potts.</p>
    <p><strong>Year:</strong> 2023.</p>
    <p><strong>Why it matters for Ax:</strong> DSPy makes LLM pipelines declarative and optimizable. Ax carries that idea into typed signatures, generated structured outputs, examples, evals, and multi-language package surfaces.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2310.03714">arXiv 2310.03714</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2312.13382">DSPy Assertions: Computational Constraints for Self-Refining Language Model Pipelines</a></h2></div>
    <p><strong>Authors:</strong> Arnav Singhvi, Manish Shetty, Shangyin Tan, Christopher Potts, Koushik Sen, Matei Zaharia, Omar Khattab.</p>
    <p><strong>Year:</strong> 2023.</p>
    <p><strong>Why it matters for Ax:</strong> Assertions show why constraints should be part of the program, not just comments in a prompt. Ax uses signature fields, schemas, validators, retries, and parser feedback to keep outputs usable.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2312.13382">arXiv 2312.13382</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2507.19457">GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning</a></h2></div>
    <p><strong>Authors:</strong> Lakshya A. Agrawal, Shangyin Tan, Dilara Soylu, Noah Ziems, Rishi Khare, Krista Opsahl-Ong, Arnav Singhvi, Herumb Shandilya, Michael J. Ryan, Meng Jiang, Christopher Potts, Koushik Sen, Alexandros G. Dimakis, Ion Stoica, Dan Klein, Matei Zaharia, Omar Khattab.</p>
    <p><strong>Year:</strong> 2025.</p>
    <p><strong>Why it matters for Ax:</strong> GEPA uses natural-language reflection and a Pareto frontier to optimize prompts and multi-component AI systems. Ax exposes this as practical optimization for generators, flows, and agents.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2507.19457">arXiv 2507.19457</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-stanford">Stanford</span><span class="paper-logo-mark paper-logo-berkeley">Berkeley</span></div>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2510.04618">Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models</a></h2></div>
    <p><strong>Authors:</strong> Qizheng Zhang et al.</p>
    <p><strong>Year:</strong> 2025.</p>
    <p><strong>Why it matters for Ax:</strong> ACE treats context as an evolving playbook — generation, reflection, and curation with incremental delta updates that resist brevity bias and context collapse. Ax ships it as the ACE optimizer alongside GEPA, evolving a reusable strategy playbook that merges into a program's instructions.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2510.04618">arXiv 2510.04618</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2512.24601">Recursive Language Models</a></h2></div>
    <p><strong>Authors:</strong> Alex L. Zhang, Tim Kraska, Omar Khattab.</p>
    <p><strong>Year:</strong> 2025.</p>
    <p><strong>Why it matters for Ax:</strong> RLMs treat long prompts as an external environment the model can inspect and decompose. Ax agents follow the same spirit by keeping durable state in the host runtime and letting the model work through bounded, tool-mediated turns.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2512.24601">arXiv 2512.24601</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-mit">MIT</span><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2605.19932">PEEK: Context Map as an Orientation Cache for Long-Context LLM Agents</a></h2></div>
    <p><strong>Authors:</strong> Zhuohan Gu, Qizheng Zhang, Omar Khattab, Samuel Madden.</p>
    <p><strong>Year:</strong> 2026.</p>
    <p><strong>Why it matters for Ax:</strong> PEEK frames context maps as persistent orientation knowledge for recurring long-context work. Ax agent docs use the same product instinct: memory, context maps, skills, and runtime summaries should keep agents oriented without replaying every token.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2605.19932">arXiv 2605.19932</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-mit">MIT</span><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2303.11366">Reflexion: Language Agents with Verbal Reinforcement Learning</a></h2></div>
    <p><strong>Authors:</strong> Noah Shinn, Federico Cassano, Edward Berman, Ashwin Gopinath, Karthik Narasimhan, Shunyu Yao.</p>
    <p><strong>Year:</strong> 2023.</p>
    <p><strong>Why it matters for Ax:</strong> Reflexion showed agents improve sharply when they verbally reflect on failed attempts and carry the lesson into the next try. Ax's agent <code>playbook</code> option automates that loop in production: each run's error turns, repeated dead-ends, and failing tool calls are reflected into durable avoidance rules that ride the next run's prompt.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2303.11366">arXiv 2303.11366</a>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2308.10144">ExpeL: LLM Agents Are Experiential Learners</a></h2></div>
    <p><strong>Authors:</strong> Andrew Zhao, Daniel Huang, Quentin Xu, Matthieu Lin, Yong-Jin Liu, Gao Huang.</p>
    <p><strong>Year:</strong> 2023.</p>
    <p><strong>Why it matters for Ax:</strong> ExpeL distills reusable insights from successes and failures across tasks into a persistent pool injected at inference time. Ax's playbook snapshots are the operational version: lessons persist via <code>onUpdate</code>, seed fresh agents in later sessions, and dedupe deterministically so covered failures never re-spend model calls.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2308.10144">arXiv 2308.10144</a>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2310.11511">Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection</a></h2></div>
    <p><strong>Authors:</strong> Akari Asai, Zeqiu Wu, Yizhong Wang, Avirup Sil, Hannaneh Hajishirzi.</p>
    <p><strong>Year:</strong> 2023.</p>
    <p><strong>Why it matters for Ax:</strong> Self-RAG interleaves generation with retrieval, self-critique, and citation of supporting passages. Ax's <code>citations</code> option carries the citation contract into agents: answers list the evidence ids they rely on, and the pipeline validates them with retry — the model cannot cite evidence it never collected.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2310.11511">arXiv 2310.11511</a>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2212.08037">Attributed Question Answering: Evaluation and Modeling for Attributed Large Language Models</a></h2></div>
    <p><strong>Authors:</strong> Bernd Bohnet, Vinh Q. Tran, Pat Verga, et al.</p>
    <p><strong>Year:</strong> 2022.</p>
    <p><strong>Why it matters for Ax:</strong> This line of work made attribution a first-class, measurable property of answers rather than an afterthought. Ax's validated <code>evidenceCitations</code> field is the practical form: existence-checked citations over the evidence the agent actually curated, with the honest limit stated in the docs (existence, not entailment).</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2212.08037">arXiv 2212.08037</a>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2310.02304">Self-Taught Optimizer (STOP): Recursively Self-Improving Code Generation</a></h2></div>
    <p><strong>Authors:</strong> Eric Zelikman, Eliana Lorch, Lester Mackey, Adam Tauman Kalai.</p>
    <p><strong>Year:</strong> 2023.</p>
    <p><strong>Why it matters for Ax:</strong> STOP demonstrated recursive self-improvement of scaffolding — and that it only pays off with capable base models. That finding shapes <code>agent.playbook().evolve()</code>: mining and judging are documented as strong-model work, and a deterministic grounding verifier discards diagnoses whose evidence quotes are not verbatim from the failing runs.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2310.02304">arXiv 2310.02304</a>
      <div class="paper-logo-row"><span class="paper-logo-mark paper-logo-stanford">Stanford</span></div>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2505.22954">Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents</a></h2></div>
    <p><strong>Authors:</strong> Jenny Zhang, Shengran Hu, Cong Lu, Robert Lange, Jeff Clune.</p>
    <p><strong>Year:</strong> 2025.</p>
    <p><strong>Why it matters for Ax:</strong> The DGM keeps only self-modifications that empirically improve benchmark scores. <code>agent.playbook().evolve()</code> applies the same discipline to one agent: a playbook bullet lands only when the failing tasks improve and a held-out set does not regress; otherwise it rolls back exactly.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2505.22954">arXiv 2505.22954</a>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><span class="paper-logo-mark paper-logo-arxiv" aria-label="arXiv"><span>ar</span><strong>X</strong><span>iv</span></span><h2><a href="https://arxiv.org/abs/2606.09498">Self-Harness: Harnesses That Improve Themselves</a></h2></div>
    <p><strong>Authors:</strong> Hangfan Zhang, Shao Zhang, Kangcong Li, Chen Zhang, Yang Chen, Yiqun Zhang, Lei Bai, Shuyue Hu.</p>
    <p><strong>Year:</strong> 2026.</p>
    <p><strong>Why it matters for Ax:</strong> Self-Harness runs weakness mining over execution traces, proposes minimal harness edits, and accepts them only after regression validation. <code>agent.playbook().evolve()</code> is that loop productized at the single-agent level: deterministic failure clustering, a grounded weakness miner that sees what the agent actually did, bounded playbook-bullet proposals, and a sequential accept gate with exact rollback.</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://arxiv.org/abs/2606.09498">arXiv 2606.09498</a>
    </div>
  </article>

  <article class="home-paper-item">
    <div class="paper-item-main">
      <div class="paper-title-row"><h2><a href="https://lilianweng.github.io/posts/2026-07-04-harness/">Harness Engineering for Self-Improvement</a></h2></div>
    <p><strong>Author:</strong> Lilian Weng.</p>
    <p><strong>Year:</strong> 2026 (Lil'Log).</p>
    <p><strong>Why it matters for Ax:</strong> A survey of the harness-engineering design space — workflow loops, persistent memory, context engineering, and self-improving harnesses. It maps directly onto Ax's RLM/ACE/GEPA/PEEK lineage above and motivated three shipped agent features: playbook failure learning, validated citations, and verified playbook evolution (<code>agent.playbook().evolve()</code>).</p>
    </div>
    <div class="paper-item-meta">
      <a class="paper-arxiv-link" href="https://lilianweng.github.io/posts/2026-07-04-harness/">Lil'Log · 2026</a>
    </div>
  </article>
</div>

## How Ax Uses This Lineage

Ax focuses these research ideas into a developer library:

- Signatures make model calls declarative.
- Field constraints and schemas turn output parsing into a program contract.
- Tools, MCP clients, and child agents turn external systems into typed capabilities.
- Agent runtime state keeps long-running work out of the prompt transcript.
- Optimizers tune programs against examples, metrics, and judges.
- AxIR keeps these concepts portable across native package surfaces.

The result is not a paper clone. It is a library for building and operating real LLM applications with the best parts of this research line made practical.
