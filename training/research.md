# Research

What each training pass read, and what it made of it. Every entry here was read **as an abstract**, through arXiv's public API
([`research.mjs`](research.mjs)), unless it says the full text was read. An abstract says what a paper claims, not how well it
holds, so nothing below is taken as settled: each is a reason to measure something, and the measurement decides.

A reading that suggests a change becomes an **idea**: a candidate brief for one slot, with the paper it came from
(`training/candidates/<slot>.json`). An idea changes the swarm only if [`improve.mjs`](improve.mjs) keeps it. What became of
each idea is in [`state.json`](state.json).

Status of a paper: **idea** (became a candidate, with the slot), **parked** (worth doing, with what would start it),
**set aside** (read, and not for this, with why), **unread**.

The searches are in `state.json`. The standing ones are asked every pass; each pass adds one for every kind of question the
swarm answered differently from its target on.

## Pass 1 (2026-11-15)

8 searches, 36 abstracts no pass had seen. Ten were read closely (as abstracts) and are marked; four became ideas. The rest are unread: most are about other things (medicine, vision, databases) that the searches also matched.

`all:"multi-agent debate" AND all:"language models" AND all:reasoning`

| Paper | What its abstract claims | Status |
|---|---|---|
| Alignment by Confident Debate: Preference Learning from Multi-Agent Debate ([2611.09568](https://arxiv.org/abs/2611.09568), 2026-11-06) | Post-training language models for reasoning typically rely on gold answers, task-specific verifiers, or learned reward models, limiting scalability when such signals are scarce. | unread |
| Rethinking Requirement-to-Code Traceability Through Single-Agent and Multi-Agent Approaches ([2611.09162](https://arxiv.org/abs/2611.09162), 2026-11-06) | Requirements-to-code traceability supports essential software engineering activities, including change impact analysis, maintenance, and regulatory compliance. | unread |
| Who Convinced Whom? Tracing How LLMs Change Their Minds in Multi-Agent Systems ([2610.35930](https://arxiv.org/abs/2610.35930), 2026-10-18) | Multi-agent debate (MAD) aims to improve language-model decisions through the exchange of arguments, yet agreement after debate need not reflect independent corroboration. | **parked**: debate raises the rate of everyone being wrong together, and a stated track record sways a model more than a title does. Start it by telling the judge how often each drafting slot has been right (the trainers measure that every pass) |
| Bias Control and Injection for Multi-Agent Aggregation ([2610.21290](https://arxiv.org/abs/2610.21290), 2026-10-15) | Multi-agent reasoning with large language models (LLMs) raises a central question for collective decision-making: when agents disagree, whose decision should be trusted? | **idea** for `bonsai-judge`: show one worked answer for each different answer (`plan.onePerAnswer`), so a judge cannot count heads |
| Beyond Answer Sharing: TrueMAD for Targeted Peer Engagement in Multi-Agent Debate ([2610.18240](https://arxiv.org/abs/2610.18240), 2026-10-13) | Multi-agent debate (MAD) aims to improve large language model reasoning by exposing agents to alternative solutions and enabling iterative revision. | **parked**: one-to-one advice aimed at one answer beats broadcasting all answers. Needs a round in which a draft is revised, which the plan does not have |
| Efficient Multi-Agent Reasoning via Confidence-Guided Adaptive Debate ([2610.16343](https://arxiv.org/abs/2610.16343), 2026-10-12) | Multi-agent debate has shown promise for improving the reasoning of large language models, yet recent theory suggests its benefits are highly regime-dependent. | **parked**: debate helps only when invoked at the right time; otherwise simple aggregation. The plan already passes the checks over when every draft agrees. Start a leader-and-supporters shape if the judge stays the weakest slot |
| DREAM: Dynamic Resolution Assignment For Multimodal Multi-agent Debate ([2610.05615](https://arxiv.org/abs/2610.05615), 2026-10-04) | Multi-agent debate (MAD) has emerged as an effective paradigm to improve the reasoning capabilities of large language models (LLMs) and is increasingly being extended to multimodal settings. | unread |
| MADBench: Benchmarking the Security of Multi-Agent Debate ([2609.39146](https://arxiv.org/abs/2609.39146), 2026-09-30) | Multi-agent debate (MAD) can improve large language model (LLM) reasoning by allowing multiple agents to exchange and critique their answers to the same task. | unread |

`all:"self-consistency" AND all:"chain of thought" AND all:"small language models"`

| Paper | What its abstract claims | Status |
|---|---|---|
| When Self-Consistency Hurts: The Hidden Cost of Majority Voting in Small Language Models ([2611.11201](https://arxiv.org/abs/2611.11201), 2026-11-08) | We study prompted chain-of-thought (CoT) with self-consistency (SC), i.e. | **parked**: on small models voting turns right answers wrong on 3 to 10 in 100 questions, and a gate that skips it keeps the accuracy at a third of the cost. `measure.mjs` already counts this (LOST). Start it when LOST is seen to exceed BEYOND: skip the swarm where the plain draft is enough |
| Dual-Track CoT: Budget-Aware Stepwise Guidance for Small LMs ([2604.25039](https://arxiv.org/abs/2604.25039), 2026-04-27) | Large Language Models (LLMs) solve many reasoning tasks via chain-of-thought (CoT) prompting, but smaller models (about 7 to 8B parameters) still struggle with multi-step reasoning under tight compute and token budgets. | **set aside**: a project statement about step-level control for small models, with no result in the abstract to act on |
| Bridging the Reasoning Gap in Vietnamese with Small Language Models via Test-Time Scaling ([2604.17794](https://arxiv.org/abs/2604.17794), 2026-04-20) | The democratization of ubiquitous AI hinges on deploying sophisticated reasoning capabilities on resource-constrained devices. | unread |
| Sustainability Analysis of Prompt Strategies for SLM-based Automated Test Generation ([2604.02761](https://arxiv.org/abs/2604.02761), 2026-04-03) | The growing adoption of prompt-based automation in software testing raises important issues regarding its computational and environmental sustainability. | unread |

`all:"mixture of agents" AND all:LLM`

| Paper | What its abstract claims | Status |
|---|---|---|
| Breaking Babel: A Self-Evolving Multi-Agent System for Long-Form Subtitle Translation ([2609.38660](https://arxiv.org/abs/2609.38660), 2026-09-29) | Long-form subtitle translation requires reasoning over discourse and cultural context spanning episodes or entire series, while maintaining consistent terminology and style. | unread |
| CERA-MoA: Co-Evolving Routing Mechanisms with Continually Learning LLM Agents ([2609.18779](https://arxiv.org/abs/2609.18779), 2026-09-16) | Current Mixture-of-Agents (MoA) paradigms generally treat query routing and agent fine-tuning as separate processes, limiting their ability to respond to evolving agent capabilities. | unread |
| Enhancing Accessibility of Medical Texts through Large Language Model-Driven Plain Language Adaptation ([2609.17398](https://arxiv.org/abs/2609.17398), 2026-09-15) | This paper addresses the challenge of making complex healthcare information more accessible through automated Plain Language Adaptation (PLA). | unread |
| The Universe of Universes: Benefit Yield Functions, Implosion Thresholds, and Infrastructure-Aware Optimization in Multi-LLM Systems ([2609.15314](https://arxiv.org/abs/2609.15314), 2026-09-14) | We introduce the Universe of Universes (UoU) framework, which treats the full ecosystem of major large language models (LLMs) as a structured retrieval corpus and proposes a compositional Automated Reasoning (AR) and Machine Learning (ML) architecture for cros | unread |
| A Structured Debate-Mixture-of-Agents Framework for Complex Clinical Diagnostic Decision Support ([2609.05069](https://arxiv.org/abs/2609.05069), 2026-09-04) | Large language models (LLMs) show potential for medical tasks, but their single-turn question-answer format does not reflect how clinical diagnosis is performed in practice. | unread |
| The Interaction Tax: When Communication Erases Diversity in Multi-Agent Teams ([2608.23541](https://arxiv.org/abs/2608.23541), 2026-08-24) | Does multi-agent LLM interaction help or hurt? | **idea** for `lfm-critic`: critique helps only where the broken rule is easy to find, so the critic is given four such rules. Also confirms two things already so: drafts never see each other, and one checker sees answers without their work |
| Role-Specialized Mixture-of-Agents with Open-Weight LLMs for Clinical Prediction ([2608.22176](https://arxiv.org/abs/2608.22176), 2026-08-23) | Large Language Models (LLMs) are increasingly applied to clinical prediction tasks such as in-hospital mortality and readmission from electronic health records (EHRs). | **set aside**, with a use: in a mixture of agents the effect was found in the final integrator. It is why the trainers work on the judge before the drafts |

`all:"self-verification" AND all:"language models" AND all:reasoning AND all:errors`

| Paper | What its abstract claims | Status |
|---|---|---|
| Physics as the label for measuring and correcting materials reasoning in multimodal models ([2609.12181](https://arxiv.org/abs/2609.12181), 2026-09-10) | Vision-language and language models increasingly interpret materials data, yet benchmarks report that they hallucinate invalid properties and violate physical law. | unread |
| Claim-Level Confidence Calibration for Reliable Decision Making with Large Language Models ([2608.22483](https://arxiv.org/abs/2608.22483), 2026-08-23) | Large Language Models (LLMs) increasingly support decision-making in high-stakes domains, but they often hallucinate and express confidence that is misaligned with factual correctness. | unread |
| EVADE: Evidence-Verified Agentic Diagnosis with Escape ([2608.18833](https://arxiv.org/abs/2608.18833), 2026-08-19) | Medical vision-language models (VLMs) can achieve high accuracy but remain unreliable: they are systematically overconfident, benefit little from test-time reasoning, and lack the ability to reliably calibrate trust in their own responses. | unread |
| Reinforcing Step-level Reasoning for Effective Self-Correction in LLMs ([2608.11573](https://arxiv.org/abs/2608.11573), 2026-08-12) | Achieving effective self-correction, where models verify and correct their own mistakes, remains a fundamental challenge for large language models (LLMs). | unread |
| Constraint-Anchored Reasoning Traces ([2607.16727](https://arxiv.org/abs/2607.16727), 2026-07-18) | Autoregressive multimodal large language models (MLLMs) suffer from error snowballing: a single incorrect inference early in a chainof-thought (CoT) trace corrupts all downstream reasoning. | **idea** for `lfm-steps`: a checkable statement after each step, and the step done again when it fails (the paper trains this in; here it is only asked for) |
| Iterative Visual Thinking and the Self-Correction Mirage in VLM Grounding ([2606.13156](https://arxiv.org/abs/2606.13156), 2026-06-11) | Letting a vision-language model (VLM) think longer at test time has driven much recent progress. | unread |
| VeriSimpl: Robust Optimization Modeling from Natural Language using Simplification-based Verification ([2607.20474](https://arxiv.org/abs/2607.20474), 2026-05-24) | Natural language interfaces can greatly benefit the accessibility and usability of optimization modeling, and recent advances in large language models (LLMs) show promise in automatically translating textual problem descriptions into executable solver formulat | unread |
| SVSR: A Self-Verification and Self-Rectification Paradigm for Multimodal Reasoning ([2604.10228](https://arxiv.org/abs/2604.10228), 2026-04-11) | Current multimodal models often suffer from shallow reasoning, leading to errors caused by incomplete or inconsistent thought processes. | unread |

`all:"prompt optimization" AND all:"automatic" AND all:"small language models"`

| Paper | What its abstract claims | Status |
|---|---|---|
| POaaS: Minimal-Edit Prompt Optimization as a Service to Lift Accuracy and Cut Hallucinations on On-Device sLLMs ([2603.16045](https://arxiv.org/abs/2603.16045), 2026-03-17) | Small language models (sLLMs) are increasingly deployed on-device, where imperfect user prompts--typos, unclear intent, or missing context--can trigger factual errors and hallucinations. | **idea** for `bonsai-direct`: a far shorter brief. Also a rule for every candidate: small models do worse with long, structured instructions, so briefs stay short |
| eARCO: Efficient Automated Root Cause Analysis with Prompt Optimization ([2504.11505](https://arxiv.org/abs/2504.11505), 2025-04-15) | Root cause analysis (RCA) for incidents in large-scale cloud systems is a complex, knowledge-intensive task that often requires significant manual effort from on-call engineers (OCEs). | unread |

`all:"model cascade" AND all:"language models" AND all:routing AND all:cost`

| Paper | What its abstract claims | Status |
|---|---|---|
| ARoute: Task-Aligned Batch and Streaming Model Routing ([2611.13209](https://arxiv.org/abs/2611.13209), 2026-11-09) | Language models increasingly power data-intensive applications, from semantic data processing to question answering and agentic workflows. | unread |
| Predictable performance is suboptimal, and what it means for model routing ([2610.31428](https://arxiv.org/abs/2610.31428), 2026-10-22) | Large language models (LLMs) differ in capabilities and costs, motivating routing methods that adaptively choose a model for each query. | unread |
| Dual-Layer Agentic Memory with Fast Write Routing and Slow Consolidation ([2608.22215](https://arxiv.org/abs/2608.22215), 2026-08-23) | Large language model (LLM) agents operate in dynamic environments where knowledge continuously evolves. | unread |
| Streaming Model Cascades for Semantic SQL ([2604.00660](https://arxiv.org/abs/2604.00660), 2026-04-01) | Modern data warehouses extend SQL with semantic operators that invoke large language models on each qualifying row, making per-row inference orders of magnitude more expensive than traditional SQL. | unread |
| AdaptEvolve: Improving Efficiency of Evolutionary AI Agents through Adaptive Model Selection ([2602.11931](https://arxiv.org/abs/2602.11931), 2026-02-12) | Evolutionary agentic systems intensify the trade-off between computational efficiency and reasoning capability by repeatedly invoking large language models (LLMs) during inference. | unread |
| Cortex AISQL: A Production SQL Engine for Unstructured Data ([2511.07663](https://arxiv.org/abs/2511.07663), 2025-11-10) | Snowflake's Cortex AISQL is a production SQL engine that integrates native semantic operations directly into SQL. | unread |
| Choosing to Be Green: Advancing Green AI via Dynamic Model Selection ([2509.19996](https://arxiv.org/abs/2509.19996), 2025-09-24) | Artificial Intelligence is increasingly pervasive across domains, with ever more complex models delivering impressive predictive performance. | unread |
