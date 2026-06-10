---
title: "Research Map"
description: "Research papers behind Ax: DSPy, DSPy Assertions, GEPA, Recursive Language Models, and PEEK."
standalone: true
toc: true
---

# Research Map

Ax is a practical library, but its shape is not accidental. The core ideas line up with a serious LLM systems lineage: declarative model programs, signatures, constraints, reflective optimization, runtime-backed long-context work, and persistent context maps.

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
