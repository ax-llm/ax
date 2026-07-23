# Changelog

## [23.0.4](https://github.com/ax-llm/ax/compare/23.0.2...23.0.3) (2026-07-23)

### Features

* **ai:** add adaptive balancer routing ([0f26c05](https://github.com/ax-llm/ax/commit/0f26c05ef2201b9c97b981510d89d38d56be4928))
* **ai:** add portable global usage observer ([4ad1a33](https://github.com/ax-llm/ax/commit/4ad1a3307c988cb4a74dc3ea874255d24368b095))
* **axir:** enforce AxAgent semantic parity ([7d4947a](https://github.com/ax-llm/ax/commit/7d4947aa1097348dac170a80f73c6bf4601ff65e))
* **axir:** port adaptive balancer routing ([1b74dc0](https://github.com/ax-llm/ax/commit/1b74dc0c59a5be34fc7f7ed5265c2bf0382146bf))

### Bug Fixes

* **axir:** refresh agent parity inventory ([52a26bb](https://github.com/ax-llm/ax/commit/52a26bb30f48566ad23bdd3ad78779a760515b2f))
* **ci:** add adaptive routing spelling terms ([59ac880](https://github.com/ax-llm/ax/commit/59ac880d2d851257ba1ae3c1ce295c1592e5ebfd))

## [23.0.3](https://github.com/ax-llm/ax/compare/23.0.2...23.0.3) (2026-07-21)

### Features

* **axir:** port new Gemini Flash models ([d25acf2](https://github.com/ax-llm/ax/commit/d25acf280d7f7e8c8a44cc93bab813af9dacf766))
* **gemini:** add 3.6 Flash and 3.5 Flash-Lite ([3fb5a8a](https://github.com/ax-llm/ax/commit/3fb5a8a41b5aab69a826e5ec4722360226dc1bec))

## [23.0.3](https://github.com/ax-llm/ax/compare/23.0.1...23.0.2) (2026-07-21)

### Features

* **axir:** port new Gemini Flash models ([d25acf2](https://github.com/ax-llm/ax/commit/d25acf280d7f7e8c8a44cc93bab813af9dacf766))
* **gemini:** add 3.6 Flash and 3.5 Flash-Lite ([3fb5a8a](https://github.com/ax-llm/ax/commit/3fb5a8a41b5aab69a826e5ec4722360226dc1bec))

## [23.0.2](https://github.com/ax-llm/ax/compare/23.0.1...23.0.2) (2026-07-21)

### ⚠ BREAKING CHANGES

* remove flow.fromMermaid/toMermaid — flow(text) and toString() are the API

### Features

* accept mermaid text in flow() and render flows via toString() ([f83bbf7](https://github.com/ax-llm/ax/commit/f83bbf72e91b75faa45befcc6f1a3e619776c1fc))
* add MCP catalog subscriptions and event runtime ([669d22f](https://github.com/ax-llm/ax/commit/669d22f50fd683c057a77584b7e2a361635fce2a))
* add multilingual Ax Academy ([1535efa](https://github.com/ax-llm/ax/commit/1535efa4fd2b30e7d129cf1ab5126b95f2f7727b))
* **axir:** port ACE shape guard, playbook attach, citations, stage instruction, verified evolve, anthropic adaptive fixes ([1e1e849](https://github.com/ax-llm/ax/commit/1e1e849eb2c09f36068f15f885e2f0e66fddf68d))
* **axir:** port extended signature grammar ([08d6494](https://github.com/ax-llm/ax/commit/08d64949a801a03ae531352a29e4406c7d053112))
* **axir:** port flow mermaid dialect ([3e88dbf](https://github.com/ax-llm/ax/commit/3e88dbf0fd850fe91bdff6d2fbf9df44fc249ef2))
* compile mermaid flowcharts into runnable flows via flow.fromMermaid() ([7702484](https://github.com/ax-llm/ax/commit/7702484f106d7ace5392c43bf1a5ac396948afdc))
* deepen Ax Academy mastery learning ([7cd788c](https://github.com/ax-llm/ax/commit/7cd788c0fb2e877d59b396960a7492a748e12462))
* **event:** add conforming SQLite event store ([c285545](https://github.com/ax-llm/ax/commit/c2855458b00409187ff366f2486465db09129626))
* **event:** add verified UCP webhook runtime ([a45be52](https://github.com/ax-llm/ax/commit/a45be52e82e2f8f9569929692544ea4579e17811))
* **event:** add volatile AxEventRuntime core ([4785634](https://github.com/ax-llm/ax/commit/47856347b35aed15f2ec0f7884c235f0868c3f88))
* **event:** bridge MCP notifications and tasks ([0a9a35d](https://github.com/ax-llm/ax/commit/0a9a35d3b5c5e09398c16f805c0fe25a0810ffb1))
* **event:** port deterministic runtime through AxIR ([f4aad7a](https://github.com/ax-llm/ax/commit/f4aad7ac0a10cb7d8c7484b52c8d72be7243caa0))
* extend signature string grammar with modifier bags and nested objects ([2f6b422](https://github.com/ax-llm/ax/commit/2f6b42236de482fda6e711d3f0e613ce285fcfff))
* infer extended signature grammar at the type level ([e7a8e3a](https://github.com/ax-llm/ax/commit/e7a8e3a8445f1611807d2d8e2447c7fa95534f93))
* make Ax Academy newbie-first ([e064894](https://github.com/ax-llm/ax/commit/e0648944a2d9074847a42e0a79cb0c14bceb6f89))
* **mcp:** add native MCP and UCP execution ([9c05203](https://github.com/ax-llm/ax/commit/9c0520371669a553eed605351fdd5417a734da1f))
* preserve isOptional and class-option unions in signature field-addition types ([766bd99](https://github.com/ax-llm/ax/commit/766bd99c020e78008cf9a32de3fa5a8dfa9a852e))
* remove flow.fromMermaid/toMermaid — flow(text) and toString() are the API ([f066578](https://github.com/ax-llm/ax/commit/f0665780ed244d613c73bbb1ab2a607117bb7a50))
* render AxFlow as mermaid via toMermaid() ([8ae55b4](https://github.com/ax-llm/ax/commit/8ae55b41746b488e682765e0edb9b1c8e93ede98))

### Bug Fixes

* accept any whitespace after the description in type-level signatures ([f283f2e](https://github.com/ax-llm/ax/commit/f283f2e0bf7cd0cbfd31d1b877744fb4c8164eda))
* accept any whitespace around -> in the type-level signature splitter ([91c072f](https://github.com/ax-llm/ax/commit/91c072f7f5e5e3109cdc5403771b484396bdc15f))
* bump the academy page lockstep count in the website link checker ([25ebc12](https://github.com/ax-llm/ax/commit/25ebc128a1279e29d8bb0554885ee421c2efcfab))
* clarify Ax Academy headline ([790637c](https://github.com/ax-llm/ax/commit/790637c40898beeb44f395b4b390941b865bfbef))
* **docs:** make the subsystem-s mermaid example's class field output-only ([6b68661](https://github.com/ax-llm/ax/commit/6b6866147922076f09776de4f32fd9132a126f35))
* enforce Academy question API coverage ([fd7dcb0](https://github.com/ax-llm/ax/commit/fd7dcb0c1e11415b3340b7fe2ca7b925d69f79be))
* **event:** complete runtime landing repair ([4771325](https://github.com/ax-llm/ax/commit/47713253fd742e849d6c13b05e12b83fb9b31509))
* **flow:** see through branch/while steps in signature inference ([d4b5246](https://github.com/ax-llm/ax/commit/d4b524635e22b6ee00d91dfee491dcec23025fb3))
* polish Academy lesson states ([31f293d](https://github.com/ax-llm/ax/commit/31f293d0ebe925f398e3310055e4d2b6ef3b1b2e))
* repair event runtime CI build ([8ef7d05](https://github.com/ax-llm/ax/commit/8ef7d055642b98356f2ad7afd41446c9433e3bf4))
* reword comment for spelling gate ([27e2273](https://github.com/ax-llm/ax/commit/27e2273992c4379b317ab9e575a8ca6f859b7094))
* silence unused-variable lint warning in mermaid node resolution ([471f129](https://github.com/ax-llm/ax/commit/471f129ce1daf383f66fba2be2bd9f043eb5add2))
* simplify Ax Academy hero layout ([478c21d](https://github.com/ax-llm/ax/commit/478c21da2040be7c3d50540bb84f28f608cfa7eb))
* **test:** migrate concurrent inference-fix regression tests off removed fromMermaid ([be74a16](https://github.com/ax-llm/ax/commit/be74a16dd6f194390a6b44d421865786a6008db4))

### Reverts

* Revert "chore(axir): drop mermaid + extended-grammar ports-parity entries" ([9e73091](https://github.com/ax-llm/ax/commit/9e73091398c1ffb5b4f4acaf13eccb947211ecbe))

## [23.0.2](https://github.com/ax-llm/ax/compare/23.0.0...23.0.1) (2026-07-21)

### ⚠ BREAKING CHANGES

* remove flow.fromMermaid/toMermaid — flow(text) and toString() are the API

### Features

* accept mermaid text in flow() and render flows via toString() ([f83bbf7](https://github.com/ax-llm/ax/commit/f83bbf72e91b75faa45befcc6f1a3e619776c1fc))
* add MCP catalog subscriptions and event runtime ([669d22f](https://github.com/ax-llm/ax/commit/669d22f50fd683c057a77584b7e2a361635fce2a))
* add multilingual Ax Academy ([1535efa](https://github.com/ax-llm/ax/commit/1535efa4fd2b30e7d129cf1ab5126b95f2f7727b))
* **axir:** port ACE shape guard, playbook attach, citations, stage instruction, verified evolve, anthropic adaptive fixes ([1e1e849](https://github.com/ax-llm/ax/commit/1e1e849eb2c09f36068f15f885e2f0e66fddf68d))
* **axir:** port extended signature grammar ([08d6494](https://github.com/ax-llm/ax/commit/08d64949a801a03ae531352a29e4406c7d053112))
* **axir:** port flow mermaid dialect ([3e88dbf](https://github.com/ax-llm/ax/commit/3e88dbf0fd850fe91bdff6d2fbf9df44fc249ef2))
* compile mermaid flowcharts into runnable flows via flow.fromMermaid() ([7702484](https://github.com/ax-llm/ax/commit/7702484f106d7ace5392c43bf1a5ac396948afdc))
* deepen Ax Academy mastery learning ([7cd788c](https://github.com/ax-llm/ax/commit/7cd788c0fb2e877d59b396960a7492a748e12462))
* **event:** add conforming SQLite event store ([c285545](https://github.com/ax-llm/ax/commit/c2855458b00409187ff366f2486465db09129626))
* **event:** add verified UCP webhook runtime ([a45be52](https://github.com/ax-llm/ax/commit/a45be52e82e2f8f9569929692544ea4579e17811))
* **event:** add volatile AxEventRuntime core ([4785634](https://github.com/ax-llm/ax/commit/47856347b35aed15f2ec0f7884c235f0868c3f88))
* **event:** bridge MCP notifications and tasks ([0a9a35d](https://github.com/ax-llm/ax/commit/0a9a35d3b5c5e09398c16f805c0fe25a0810ffb1))
* **event:** port deterministic runtime through AxIR ([f4aad7a](https://github.com/ax-llm/ax/commit/f4aad7ac0a10cb7d8c7484b52c8d72be7243caa0))
* extend signature string grammar with modifier bags and nested objects ([2f6b422](https://github.com/ax-llm/ax/commit/2f6b42236de482fda6e711d3f0e613ce285fcfff))
* infer extended signature grammar at the type level ([e7a8e3a](https://github.com/ax-llm/ax/commit/e7a8e3a8445f1611807d2d8e2447c7fa95534f93))
* make Ax Academy newbie-first ([e064894](https://github.com/ax-llm/ax/commit/e0648944a2d9074847a42e0a79cb0c14bceb6f89))
* **mcp:** add native MCP and UCP execution ([9c05203](https://github.com/ax-llm/ax/commit/9c0520371669a553eed605351fdd5417a734da1f))
* preserve isOptional and class-option unions in signature field-addition types ([766bd99](https://github.com/ax-llm/ax/commit/766bd99c020e78008cf9a32de3fa5a8dfa9a852e))
* remove flow.fromMermaid/toMermaid — flow(text) and toString() are the API ([f066578](https://github.com/ax-llm/ax/commit/f0665780ed244d613c73bbb1ab2a607117bb7a50))
* render AxFlow as mermaid via toMermaid() ([8ae55b4](https://github.com/ax-llm/ax/commit/8ae55b41746b488e682765e0edb9b1c8e93ede98))

### Bug Fixes

* accept any whitespace after the description in type-level signatures ([f283f2e](https://github.com/ax-llm/ax/commit/f283f2e0bf7cd0cbfd31d1b877744fb4c8164eda))
* accept any whitespace around -> in the type-level signature splitter ([91c072f](https://github.com/ax-llm/ax/commit/91c072f7f5e5e3109cdc5403771b484396bdc15f))
* bump the academy page lockstep count in the website link checker ([25ebc12](https://github.com/ax-llm/ax/commit/25ebc128a1279e29d8bb0554885ee421c2efcfab))
* clarify Ax Academy headline ([790637c](https://github.com/ax-llm/ax/commit/790637c40898beeb44f395b4b390941b865bfbef))
* **docs:** make the subsystem-s mermaid example's class field output-only ([6b68661](https://github.com/ax-llm/ax/commit/6b6866147922076f09776de4f32fd9132a126f35))
* enforce Academy question API coverage ([fd7dcb0](https://github.com/ax-llm/ax/commit/fd7dcb0c1e11415b3340b7fe2ca7b925d69f79be))
* **event:** complete runtime landing repair ([4771325](https://github.com/ax-llm/ax/commit/47713253fd742e849d6c13b05e12b83fb9b31509))
* **flow:** see through branch/while steps in signature inference ([d4b5246](https://github.com/ax-llm/ax/commit/d4b524635e22b6ee00d91dfee491dcec23025fb3))
* polish Academy lesson states ([31f293d](https://github.com/ax-llm/ax/commit/31f293d0ebe925f398e3310055e4d2b6ef3b1b2e))
* repair event runtime CI build ([8ef7d05](https://github.com/ax-llm/ax/commit/8ef7d055642b98356f2ad7afd41446c9433e3bf4))
* reword comment for spelling gate ([27e2273](https://github.com/ax-llm/ax/commit/27e2273992c4379b317ab9e575a8ca6f859b7094))
* silence unused-variable lint warning in mermaid node resolution ([471f129](https://github.com/ax-llm/ax/commit/471f129ce1daf383f66fba2be2bd9f043eb5add2))
* simplify Ax Academy hero layout ([478c21d](https://github.com/ax-llm/ax/commit/478c21da2040be7c3d50540bb84f28f608cfa7eb))
* **test:** migrate concurrent inference-fix regression tests off removed fromMermaid ([be74a16](https://github.com/ax-llm/ax/commit/be74a16dd6f194390a6b44d421865786a6008db4))

### Reverts

* Revert "chore(axir): drop mermaid + extended-grammar ports-parity entries" ([9e73091](https://github.com/ax-llm/ax/commit/9e73091398c1ffb5b4f4acaf13eccb947211ecbe))

## [23.0.1](https://github.com/ax-llm/ax/compare/23.0.0...23.0.1) (2026-07-14)

### Features

* **agent:** agent.improve() — failure-driven repair with regression-validated acceptance ([994aac0](https://github.com/ax-llm/ax/commit/994aac0e6a7932eb02d6855f5ba8dbaf651e2f3c))
* **agent:** construction-time playbook with run-end failure learning ([87be227](https://github.com/ax-llm/ax/commit/87be2273faca24a14e3a4704e42b0477c8dac29c))
* **agent:** opt-in chain-of-evidence citations on the responder ([12fe8d0](https://github.com/ax-llm/ax/commit/12fe8d0b81f256b482dbdc782dffa3879e5f971f))
* **website:** keep docs side-nav position across pages; chain next page on scroll ([f4f16fc](https://github.com/ax-llm/ax/commit/f4f16fc1c854353b3adf0399ce2936f04d2e9f00))
* **website:** rework homepage top of page around the real moat ([5ef34b7](https://github.com/ax-llm/ax/commit/5ef34b743dbd987aac053f20c8befedb0624181d))

### Bug Fixes

* **agent:** correctness fixes from adversarial review of P1-P3 ([f4d4ac8](https://github.com/ax-llm/ax/commit/f4d4ac8deb71c7e7c2be1dbaa84579892db08b98))
* **agent:** revive the dead stage ::instruction knob; playbook dedupe re-learns pruned lessons; improve() runsPerTask ([052fe52](https://github.com/ax-llm/ax/commit/052fe52d05ab80f4c008f5ee166774fbc2246289))
* **anthropic:** omit sampling params on all adaptive models, not just Opus 4.7+ ([#560](https://github.com/ax-llm/ax/issues/560)) ([10eecc9](https://github.com/ax-llm/ax/commit/10eecc9dccee135af7a7175c1f84162b64d9934c))
* **anthropic:** request summarized thinking display on adaptive models ([#561](https://github.com/ax-llm/ax/issues/561)) ([61bea23](https://github.com/ax-llm/ax/commit/61bea23f346f61a5821f347a8972c18047af037c)), closes [#560](https://github.com/ax-llm/ax/issues/560)
* **website:** stop hero example swaps from reflowing the page; calmer two-line h1 ([1758469](https://github.com/ax-llm/ax/commit/17584697655efa1b38748a89cf6651255a48d038))

## [23.0.1](https://github.com/ax-llm/ax/compare/22.0.9...23.0.0) (2026-07-14)

### Features

* **agent:** agent.improve() — failure-driven repair with regression-validated acceptance ([994aac0](https://github.com/ax-llm/ax/commit/994aac0e6a7932eb02d6855f5ba8dbaf651e2f3c))
* **agent:** construction-time playbook with run-end failure learning ([87be227](https://github.com/ax-llm/ax/commit/87be2273faca24a14e3a4704e42b0477c8dac29c))
* **agent:** opt-in chain-of-evidence citations on the responder ([12fe8d0](https://github.com/ax-llm/ax/commit/12fe8d0b81f256b482dbdc782dffa3879e5f971f))
* **website:** keep docs side-nav position across pages; chain next page on scroll ([f4f16fc](https://github.com/ax-llm/ax/commit/f4f16fc1c854353b3adf0399ce2936f04d2e9f00))
* **website:** rework homepage top of page around the real moat ([5ef34b7](https://github.com/ax-llm/ax/commit/5ef34b743dbd987aac053f20c8befedb0624181d))

### Bug Fixes

* **agent:** correctness fixes from adversarial review of P1-P3 ([f4d4ac8](https://github.com/ax-llm/ax/commit/f4d4ac8deb71c7e7c2be1dbaa84579892db08b98))
* **agent:** revive the dead stage ::instruction knob; playbook dedupe re-learns pruned lessons; improve() runsPerTask ([052fe52](https://github.com/ax-llm/ax/commit/052fe52d05ab80f4c008f5ee166774fbc2246289))
* **anthropic:** omit sampling params on all adaptive models, not just Opus 4.7+ ([#560](https://github.com/ax-llm/ax/issues/560)) ([10eecc9](https://github.com/ax-llm/ax/commit/10eecc9dccee135af7a7175c1f84162b64d9934c))
* **anthropic:** request summarized thinking display on adaptive models ([#561](https://github.com/ax-llm/ax/issues/561)) ([61bea23](https://github.com/ax-llm/ax/commit/61bea23f346f61a5821f347a8972c18047af037c)), closes [#560](https://github.com/ax-llm/ax/issues/560)
* **website:** stop hero example swaps from reflowing the page; calmer two-line h1 ([1758469](https://github.com/ax-llm/ax/commit/17584697655efa1b38748a89cf6651255a48d038))

## [23.0.0](https://github.com/ax-llm/ax/compare/22.0.9...23.0.0) (2026-07-05)

### Features

* **agent:** auto-upgrade smart defaults for discovery and context fields ([c114323](https://github.com/ax-llm/ax/commit/c1143238765bd7ae85fe17678d7013f23e6f9238))
* **agent:** direct-respond — distiller respond(task, evidence) skips the executor ([8df3c3c](https://github.com/ax-llm/ax/commit/8df3c3c2b715c70ec77441453079a089cd3ea547))
* **agent:** direct-respond live eval gate — 0 false-skips, 100% skip recall on both pinned models ([30669f1](https://github.com/ax-llm/ax/commit/30669f163981dc81928cb8cb16b937c43093b5f0))
* **agent:** shape hints in evidence descriptors and context metadata ([3306475](https://github.com/ax-llm/ax/commit/3306475085414d36aee4411ad2466e08e53bef8a))
* **agent:** shared runtime session across distiller/executor phases ([2395334](https://github.com/ax-llm/ax/commit/23953349a02a5f3b43845d69dbba99033919cf75))
* **agent:** unified relevance layer with catalog-backed search and advisory hints ([6840ab3](https://github.com/ax-llm/ax/commit/6840ab390a69bdb3e0e52a35c72c26b33b994329))
* **axir:** port agent backlog to generated packages ([d22f09d](https://github.com/ax-llm/ax/commit/d22f09d5595a221eae9a86fa5e0b76e66e9332c3))
* **axir:** port direct-respond to AxIR and all five language runtimes ([b86d16d](https://github.com/ax-llm/ax/commit/b86d16dce93ca4a8afb2d2946b38bcd54e4cf127))

### Bug Fixes

* **agent:** executor must discover before declaring data unavailable ([6c72769](https://github.com/ax-llm/ax/commit/6c727693c3b781e9471f75cd6c1d0ebe7d7d4254))
* **agent:** keep memories cache breakpoint after setSignature() ([6d7286c](https://github.com/ax-llm/ax/commit/6d7286ce8ea519f5d80bb3d75e8b2c71b76a8069))
* **axir:** stop the backlog gate crashing on large diffs; order open entries by landing date ([6f85dc9](https://github.com/ax-llm/ax/commit/6f85dc9ca057331f59baaefaf370fb113e089c58))
* **examples:** repair CI type checks ([d42d379](https://github.com/ax-llm/ax/commit/d42d379d0bb722c5602d5baa726b6dfb66589ef0))

## [23.0.0](https://github.com/ax-llm/ax/compare/22.0.8...22.0.9) (2026-07-05)

### Features

* **agent:** auto-upgrade smart defaults for discovery and context fields ([c114323](https://github.com/ax-llm/ax/commit/c1143238765bd7ae85fe17678d7013f23e6f9238))
* **agent:** direct-respond — distiller respond(task, evidence) skips the executor ([8df3c3c](https://github.com/ax-llm/ax/commit/8df3c3c2b715c70ec77441453079a089cd3ea547))
* **agent:** direct-respond live eval gate — 0 false-skips, 100% skip recall on both pinned models ([30669f1](https://github.com/ax-llm/ax/commit/30669f163981dc81928cb8cb16b937c43093b5f0))
* **agent:** shape hints in evidence descriptors and context metadata ([3306475](https://github.com/ax-llm/ax/commit/3306475085414d36aee4411ad2466e08e53bef8a))
* **agent:** shared runtime session across distiller/executor phases ([2395334](https://github.com/ax-llm/ax/commit/23953349a02a5f3b43845d69dbba99033919cf75))
* **agent:** unified relevance layer with catalog-backed search and advisory hints ([6840ab3](https://github.com/ax-llm/ax/commit/6840ab390a69bdb3e0e52a35c72c26b33b994329))
* **axir:** port agent backlog to generated packages ([d22f09d](https://github.com/ax-llm/ax/commit/d22f09d5595a221eae9a86fa5e0b76e66e9332c3))
* **axir:** port direct-respond to AxIR and all five language runtimes ([b86d16d](https://github.com/ax-llm/ax/commit/b86d16dce93ca4a8afb2d2946b38bcd54e4cf127))

### Bug Fixes

* **agent:** executor must discover before declaring data unavailable ([6c72769](https://github.com/ax-llm/ax/commit/6c727693c3b781e9471f75cd6c1d0ebe7d7d4254))
* **agent:** keep memories cache breakpoint after setSignature() ([6d7286c](https://github.com/ax-llm/ax/commit/6d7286ce8ea519f5d80bb3d75e8b2c71b76a8069))
* **axir:** stop the backlog gate crashing on large diffs; order open entries by landing date ([6f85dc9](https://github.com/ax-llm/ax/commit/6f85dc9ca057331f59baaefaf370fb113e089c58))
* **examples:** repair CI type checks ([d42d379](https://github.com/ax-llm/ax/commit/d42d379d0bb722c5602d5baa726b6dfb66589ef0))

## [22.0.9](https://github.com/ax-llm/ax/compare/22.0.8...22.0.9) (2026-06-30)

### Features

* **anthropic:** add Claude Sonnet 5 support ([#558](https://github.com/ax-llm/ax/issues/558)) ([811dee8](https://github.com/ax-llm/ax/commit/811dee880ff6a52f6432812f045029ea2fbe9ba0))

### Bug Fixes

* add AxIR terms to spelling dictionary ([592b7fb](https://github.com/ax-llm/ax/commit/592b7fbe39a7acca265b5c947e4ed69bb3190ca8))

## [22.0.9](https://github.com/ax-llm/ax/compare/22.0.7...22.0.8) (2026-06-30)

### Features

* **anthropic:** add Claude Sonnet 5 support ([#558](https://github.com/ax-llm/ax/issues/558)) ([811dee8](https://github.com/ax-llm/ax/commit/811dee880ff6a52f6432812f045029ea2fbe9ba0))

### Bug Fixes

* add AxIR terms to spelling dictionary ([592b7fb](https://github.com/ax-llm/ax/commit/592b7fbe39a7acca265b5c947e4ed69bb3190ca8))

## [22.0.8](https://github.com/ax-llm/ax/compare/22.0.7...22.0.8) (2026-06-30)

### Features

* add AI SDK v7 support ([#557](https://github.com/ax-llm/ax/issues/557)) ([ec940f8](https://github.com/ax-llm/ax/commit/ec940f80b792f9e302b1319ed6215d8294ff5f4d))
* **axir:** assert balancer streaming failover + close [#556](https://github.com/ax-llm/ax/issues/556) transient-error port ([57df89b](https://github.com/ax-llm/ax/commit/57df89bc62329bb99da941964eef5d1590f7c2d5))
* **axir:** port Anthropic transient-error classification + 529 retryability + streaming-overload retry ([4f4f8c0](https://github.com/ax-llm/ax/commit/4f4f8c02528466d8215d51bb472d26f0a5140270)), closes [#556](https://github.com/ax-llm/ax/issues/556)
* **axir:** port the playbook (ACE) optimizer to all 5 generated languages ([968a906](https://github.com/ax-llm/ax/commit/968a9067352143523b28b6668370db39faf492c9))
* **dsp:** add playbook() concept that wraps the ACE optimizer ([858d55f](https://github.com/ax-llm/ax/commit/858d55f3d3f1af5ad403fe0019e4da3e7528b32a))
* restore WebLLM provider and ACE optimizer ([d536956](https://github.com/ax-llm/ax/commit/d53695673c4a837c114557bbd89f2100ed035a22))

### Bug Fixes

* **agent:** recover from empty model turns and unknown tool calls ([8a44919](https://github.com/ax-llm/ax/commit/8a44919a97a829ab800b3a73a933f6a9bdc4e00e))
* **axir:** playbook reflector/curator need field descriptions to learn live ([5173dfa](https://github.com/ax-llm/ax/commit/5173dfa1434f854ba097716c95c1691391b7cd27))
* **axir:** port agent recovery fixes to generated packages ([05a9a26](https://github.com/ax-llm/ax/commit/05a9a2653f6b08ad304d06ce00e90f8a5f782a2b))
* **axir:** regenerate ports for the ACE curator no-op filter ([7c299d6](https://github.com/ax-llm/ax/commit/7c299d6f63fe3dafcdc6c9dac012c3355170f390))
* **axir:** Rust + Go agent-API parity (AxGen-backed) + G9 public-API parity gate ([42ad3e2](https://github.com/ax-llm/ax/commit/42ad3e2a75c719c919238368fb9b11f7d75238e2))
* **bedrock:** read Titan embedding dimensions from config (axir-no-impact) ([#550](https://github.com/ax-llm/ax/issues/550)) ([2c37bc1](https://github.com/ax-llm/ax/commit/2c37bc1a46552fce1cad40017c579b926d5edc85))
* **dsp:** AxACE must not let undefined option values clobber defaults ([f37b44a](https://github.com/ax-llm/ax/commit/f37b44a75322be3dd53b2def7fc31f7a497006eb))
* **dsp:** drop no-op acknowledgment bullets from the ACE curator ([be3382c](https://github.com/ax-llm/ax/commit/be3382c57b308f7ee84f873e16bf6b6709219b0d))
* **gepa:** prefer an accepted evolution over the seed it ties ([#546](https://github.com/ax-llm/ax/issues/546)) ([f260976](https://github.com/ax-llm/ax/commit/f260976a83d2e1dccb7f5e4a13caac3fa243d934))

## [22.0.8](https://github.com/ax-llm/ax/compare/22.0.6...22.0.7) (2026-06-30)

### Features

* add AI SDK v7 support ([#557](https://github.com/ax-llm/ax/issues/557)) ([ec940f8](https://github.com/ax-llm/ax/commit/ec940f80b792f9e302b1319ed6215d8294ff5f4d))
* **axir:** assert balancer streaming failover + close [#556](https://github.com/ax-llm/ax/issues/556) transient-error port ([57df89b](https://github.com/ax-llm/ax/commit/57df89bc62329bb99da941964eef5d1590f7c2d5))
* **axir:** port Anthropic transient-error classification + 529 retryability + streaming-overload retry ([4f4f8c0](https://github.com/ax-llm/ax/commit/4f4f8c02528466d8215d51bb472d26f0a5140270)), closes [#556](https://github.com/ax-llm/ax/issues/556)
* **axir:** port the playbook (ACE) optimizer to all 5 generated languages ([968a906](https://github.com/ax-llm/ax/commit/968a9067352143523b28b6668370db39faf492c9))
* **dsp:** add playbook() concept that wraps the ACE optimizer ([858d55f](https://github.com/ax-llm/ax/commit/858d55f3d3f1af5ad403fe0019e4da3e7528b32a))
* restore WebLLM provider and ACE optimizer ([d536956](https://github.com/ax-llm/ax/commit/d53695673c4a837c114557bbd89f2100ed035a22))

### Bug Fixes

* **agent:** recover from empty model turns and unknown tool calls ([8a44919](https://github.com/ax-llm/ax/commit/8a44919a97a829ab800b3a73a933f6a9bdc4e00e))
* **axir:** playbook reflector/curator need field descriptions to learn live ([5173dfa](https://github.com/ax-llm/ax/commit/5173dfa1434f854ba097716c95c1691391b7cd27))
* **axir:** port agent recovery fixes to generated packages ([05a9a26](https://github.com/ax-llm/ax/commit/05a9a2653f6b08ad304d06ce00e90f8a5f782a2b))
* **axir:** regenerate ports for the ACE curator no-op filter ([7c299d6](https://github.com/ax-llm/ax/commit/7c299d6f63fe3dafcdc6c9dac012c3355170f390))
* **axir:** Rust + Go agent-API parity (AxGen-backed) + G9 public-API parity gate ([42ad3e2](https://github.com/ax-llm/ax/commit/42ad3e2a75c719c919238368fb9b11f7d75238e2))
* **bedrock:** read Titan embedding dimensions from config (axir-no-impact) ([#550](https://github.com/ax-llm/ax/issues/550)) ([2c37bc1](https://github.com/ax-llm/ax/commit/2c37bc1a46552fce1cad40017c579b926d5edc85))
* **dsp:** AxACE must not let undefined option values clobber defaults ([f37b44a](https://github.com/ax-llm/ax/commit/f37b44a75322be3dd53b2def7fc31f7a497006eb))
* **dsp:** drop no-op acknowledgment bullets from the ACE curator ([be3382c](https://github.com/ax-llm/ax/commit/be3382c57b308f7ee84f873e16bf6b6709219b0d))
* **gepa:** prefer an accepted evolution over the seed it ties ([#546](https://github.com/ax-llm/ax/issues/546)) ([f260976](https://github.com/ax-llm/ax/commit/f260976a83d2e1dccb7f5e4a13caac3fa243d934))

## [22.0.7](https://github.com/ax-llm/ax/compare/22.0.6...22.0.7) (2026-06-24)

### Features

* **axir:** productized realtime_chat WebSocket driver for the C++ port ([a11f9c7](https://github.com/ax-llm/ax/commit/a11f9c7fcbdd2399bc2af89e06c73b7c7facb0e5))
* **axir:** productized realtime_chat WebSocket driver for the Go port ([72b881c](https://github.com/ax-llm/ax/commit/72b881cd6cff1a5c6aca1c9b27ec5203a366561d))
* **axir:** productized realtime_chat WebSocket driver for the Java port ([27e23f5](https://github.com/ax-llm/ax/commit/27e23f517dbd8e63589ba07f714debffcc686b35))
* **axir:** productized realtime_chat WebSocket driver for the Python port ([faabf69](https://github.com/ax-llm/ax/commit/faabf69ebaa1f35e4cf7f3441fe504e773fa603e))
* **axir:** productized realtime_chat WebSocket driver for the Rust port ([81af022](https://github.com/ax-llm/ax/commit/81af0227fe17f303e034527399aa71cdc8718f6d))
* **axir:** support audio content parts in OpenAI-compatible chat() across ports ([9119cef](https://github.com/ax-llm/ax/commit/9119cef49109ab1f02eda990e8830adea4ef8446))
* **axir:** transparently route realtime models through chat() across ports ([ba6e38a](https://github.com/ax-llm/ax/commit/ba6e38a2de77943e7b0fd1fa781da5e273164e0a))

### Bug Fixes

* **anthropic:** retry and fail over on transient errors (overload, rate limits, server errors) ([#556](https://github.com/ax-llm/ax/issues/556)) ([36c7808](https://github.com/ax-llm/ax/commit/36c7808f1ecd647539da33fd19c4484ce687c0ff))
* **axir:** align OpenAI realtime session.update with the current protocol ([cfac419](https://github.com/ax-llm/ax/commit/cfac41973da31be598c5d6c9e2ef7a30a00e16c8))
* **axir:** correct Gemini Live turn + move realtime WS-URL into Core ([1fa204e](https://github.com/ax-llm/ax/commit/1fa204ed26828c6981315b8e52583f33fdb56880))
* **axir:** fail codegen loud when a generated Python module lacks a helper def ([7566c74](https://github.com/ax-llm/ax/commit/7566c7470f26b2441440c2cc3ccb6e7400f75d41))
* **axir:** honor base_url for Rust audio transcribe()/speak() ([ba4ea67](https://github.com/ax-llm/ax/commit/ba4ea675d577a4ad7849b2b051a921579e7091b5))
* **axir:** make MCP Streamable HTTP transport SSE-aware in all 5 ports ([ed37627](https://github.com/ax-llm/ax/commit/ed3762769cf617193545d53d64fcabfb6b13075e))

## [22.0.7](https://github.com/ax-llm/ax/compare/22.0.5...22.0.6) (2026-06-24)

### Features

* **axir:** productized realtime_chat WebSocket driver for the C++ port ([a11f9c7](https://github.com/ax-llm/ax/commit/a11f9c7fcbdd2399bc2af89e06c73b7c7facb0e5))
* **axir:** productized realtime_chat WebSocket driver for the Go port ([72b881c](https://github.com/ax-llm/ax/commit/72b881cd6cff1a5c6aca1c9b27ec5203a366561d))
* **axir:** productized realtime_chat WebSocket driver for the Java port ([27e23f5](https://github.com/ax-llm/ax/commit/27e23f517dbd8e63589ba07f714debffcc686b35))
* **axir:** productized realtime_chat WebSocket driver for the Python port ([faabf69](https://github.com/ax-llm/ax/commit/faabf69ebaa1f35e4cf7f3441fe504e773fa603e))
* **axir:** productized realtime_chat WebSocket driver for the Rust port ([81af022](https://github.com/ax-llm/ax/commit/81af0227fe17f303e034527399aa71cdc8718f6d))
* **axir:** support audio content parts in OpenAI-compatible chat() across ports ([9119cef](https://github.com/ax-llm/ax/commit/9119cef49109ab1f02eda990e8830adea4ef8446))
* **axir:** transparently route realtime models through chat() across ports ([ba6e38a](https://github.com/ax-llm/ax/commit/ba6e38a2de77943e7b0fd1fa781da5e273164e0a))

### Bug Fixes

* **anthropic:** retry and fail over on transient errors (overload, rate limits, server errors) ([#556](https://github.com/ax-llm/ax/issues/556)) ([36c7808](https://github.com/ax-llm/ax/commit/36c7808f1ecd647539da33fd19c4484ce687c0ff))
* **axir:** align OpenAI realtime session.update with the current protocol ([cfac419](https://github.com/ax-llm/ax/commit/cfac41973da31be598c5d6c9e2ef7a30a00e16c8))
* **axir:** correct Gemini Live turn + move realtime WS-URL into Core ([1fa204e](https://github.com/ax-llm/ax/commit/1fa204ed26828c6981315b8e52583f33fdb56880))
* **axir:** fail codegen loud when a generated Python module lacks a helper def ([7566c74](https://github.com/ax-llm/ax/commit/7566c7470f26b2441440c2cc3ccb6e7400f75d41))
* **axir:** honor base_url for Rust audio transcribe()/speak() ([ba4ea67](https://github.com/ax-llm/ax/commit/ba4ea675d577a4ad7849b2b051a921579e7091b5))
* **axir:** make MCP Streamable HTTP transport SSE-aware in all 5 ports ([ed37627](https://github.com/ax-llm/ax/commit/ed3762769cf617193545d53d64fcabfb6b13075e))

## [22.0.6](https://github.com/ax-llm/ax/compare/22.0.5...22.0.6) (2026-06-21)

### Bug Fixes

* **axir:** handle binary speak()/TTS responses across the non-TS ports ([5068c65](https://github.com/ax-llm/ax/commit/5068c65efda7558590fc42f188c3fa63648f44d2))
* **axir:** implement multipart/form-data in the non-TS port HTTP layers ([57009ce](https://github.com/ax-llm/ax/commit/57009ceeeabfa4a2e9bc83e955c4cf85042d45d6))
* **axir:** populate freeform json[] output fields in the language ports ([bd3a4eb](https://github.com/ax-llm/ax/commit/bd3a4ebacb3e5471cddabe013b72460882905a3d))
* **axir:** recurse into nested object/object[] flexible-json output leaves ([aa1e64a](https://github.com/ax-llm/ax/commit/aa1e64a51f1d0cc89969971a3cc41bffb3982c32))

## [22.0.6](https://github.com/ax-llm/ax/compare/22.0.4...22.0.5) (2026-06-21)

### Bug Fixes

* **axir:** handle binary speak()/TTS responses across the non-TS ports ([5068c65](https://github.com/ax-llm/ax/commit/5068c65efda7558590fc42f188c3fa63648f44d2))
* **axir:** implement multipart/form-data in the non-TS port HTTP layers ([57009ce](https://github.com/ax-llm/ax/commit/57009ceeeabfa4a2e9bc83e955c4cf85042d45d6))
* **axir:** populate freeform json[] output fields in the language ports ([bd3a4eb](https://github.com/ax-llm/ax/commit/bd3a4ebacb3e5471cddabe013b72460882905a3d))
* **axir:** recurse into nested object/object[] flexible-json output leaves ([aa1e64a](https://github.com/ax-llm/ax/commit/aa1e64a51f1d0cc89969971a3cc41bffb3982c32))

## [22.0.5](https://github.com/ax-llm/ax/compare/22.0.4...22.0.5) (2026-06-20)

### Bug Fixes

* **maven:** bump central-publishing-maven-plugin 0.7.0 -> 0.11.0 ([#554](https://github.com/ax-llm/ax/issues/554)) ([2e0b667](https://github.com/ax-llm/ax/commit/2e0b667832554d3f299244d421c41ccfd1f945f8))

## [22.0.5](https://github.com/ax-llm/ax/compare/22.0.3...22.0.4) (2026-06-20)

### Bug Fixes

* **maven:** bump central-publishing-maven-plugin 0.7.0 -> 0.11.0 ([#554](https://github.com/ax-llm/ax/issues/554)) ([2e0b667](https://github.com/ax-llm/ax/commit/2e0b667832554d3f299244d421c41ccfd1f945f8))

## [22.0.4](https://github.com/ax-llm/ax/compare/22.0.3...22.0.4) (2026-06-20)

## [22.0.4](https://github.com/ax-llm/ax/compare/22.0.2...22.0.3) (2026-06-20)

## [22.0.3](https://github.com/ax-llm/ax/compare/22.0.2...22.0.3) (2026-06-08)

## [22.0.3](https://github.com/ax-llm/ax/compare/22.0.1...22.0.2) (2026-06-08)

## [22.0.2](https://github.com/ax-llm/ax/compare/22.0.1...22.0.2) (2026-06-05)

## [22.0.2](https://github.com/ax-llm/ax/compare/22.0.0...22.0.1) (2026-06-05)

## [22.0.1](https://github.com/ax-llm/ax/compare/22.0.0...22.0.1) (2026-06-05)

### Bug Fixes

* **openai:** correct stale per-model prices in OpenAI info table ([#525](https://github.com/ax-llm/ax/issues/525)) ([c85eceb](https://github.com/ax-llm/ax/commit/c85eceb058894e702d9b42ecec97cd994a60f03e))

## [22.0.1](https://github.com/ax-llm/ax/compare/21.0.14...22.0.0) (2026-06-05)

### Bug Fixes

* **openai:** correct stale per-model prices in OpenAI info table ([#525](https://github.com/ax-llm/ax/issues/525)) ([c85eceb](https://github.com/ax-llm/ax/commit/c85eceb058894e702d9b42ecec97cd994a60f03e))

## [22.0.0](https://github.com/ax-llm/ax/compare/21.0.14...22.0.0) (2026-06-04)

### Bug Fixes

* type fix ([a5a0cc6](https://github.com/ax-llm/ax/commit/a5a0cc65dfe36ee385bc08b658d796846cd496c4))

## [22.0.0](https://github.com/ax-llm/ax/compare/21.0.13...21.0.14) (2026-06-04)

### Bug Fixes

* type fix ([a5a0cc6](https://github.com/ax-llm/ax/commit/a5a0cc65dfe36ee385bc08b658d796846cd496c4))

## [21.0.14](https://github.com/ax-llm/ax/compare/21.0.13...21.0.14) (2026-05-25)

## [21.0.14](https://github.com/ax-llm/ax/compare/21.0.12...21.0.13) (2026-05-25)

## [21.0.13](https://github.com/ax-llm/ax/compare/21.0.12...21.0.13) (2026-05-24)

## [21.0.13](https://github.com/ax-llm/ax/compare/21.0.11...21.0.12) (2026-05-24)

## [21.0.12](https://github.com/ax-llm/ax/compare/21.0.11...21.0.12) (2026-05-22)

## [21.0.12](https://github.com/ax-llm/ax/compare/21.0.10...21.0.11) (2026-05-22)

## [21.0.11](https://github.com/ax-llm/ax/compare/21.0.10...21.0.11) (2026-05-21)

## [21.0.11](https://github.com/ax-llm/ax/compare/21.0.9...21.0.10) (2026-05-21)

## [21.0.10](https://github.com/ax-llm/ax/compare/21.0.9...21.0.10) (2026-05-21)

## [21.0.10](https://github.com/ax-llm/ax/compare/21.0.8...21.0.9) (2026-05-21)

## [21.0.9](https://github.com/ax-llm/ax/compare/21.0.8...21.0.9) (2026-05-19)

## [21.0.9](https://github.com/ax-llm/ax/compare/21.0.6...21.0.8) (2026-05-19)

## [21.0.8](https://github.com/ax-llm/ax/compare/21.0.6...21.0.8) (2026-05-17)

## [21.0.8](https://github.com/ax-llm/ax/compare/21.0.6...21.0.6) (2026-05-17)

## [21.0.7](https://github.com/ax-llm/ax/compare/21.0.6...21.0.6) (2026-05-17)

## [21.0.6](https://github.com/ax-llm/ax/compare/21.0.4...21.0.5) (2026-05-16)

### Features

* improve ax agent context management ([7b974ad](https://github.com/ax-llm/ax/commit/7b974ade805c42d70b8b94a238f8736340ad984b))

### Bug Fixes

* package fixes ([e7e260b](https://github.com/ax-llm/ax/commit/e7e260b31716e51da04d52fc33554bd12b12cea9))

## [21.0.5](https://github.com/ax-llm/ax/compare/21.0.4...21.0.5) (2026-05-15)

### Features

* **ai:** add new models, xhigh reasoning effort, and Anthropic structured output fix ([ec008b7](https://github.com/ax-llm/ax/commit/ec008b772ec12ace026a453a11f5af1e23c6a9ec))

### Bug Fixes

* **ai:** record streaming token usage as deltas, not cumulative ([#516](https://github.com/ax-llm/ax/issues/516)) ([4f7f417](https://github.com/ax-llm/ax/commit/4f7f417860d18d051f458579903701e1fe2635c4))
* **anthropic:** emit cache_control on content blocks, not envelopes ([#517](https://github.com/ax-llm/ax/issues/517)) ([c12a3a8](https://github.com/ax-llm/ax/commit/c12a3a8374bcd8c626dc312cbd3c8a18841b6d4d))

## [21.0.5](///compare/21.0.3...21.0.4) (2026-05-15)

### Features

* **ai:** add new models, xhigh reasoning effort, and Anthropic structured output fix ec008b7

### Bug Fixes

* **ai:** record streaming token usage as deltas, not cumulative ([#516](undefined/undefined/undefined/issues/516)) 4f7f417
* **anthropic:** emit cache_control on content blocks, not envelopes ([#517](undefined/undefined/undefined/issues/517)) c12a3a8
## [21.0.4](///compare/21.0.3...21.0.4) (2026-05-14)

## [21.0.4](///compare/21.0.2...21.0.3) (2026-05-14)
## [21.0.3](///compare/21.0.2...21.0.3) (2026-05-13)

## [21.0.3](///compare/21.0.1...21.0.2) (2026-05-13)
## [21.0.2](///compare/21.0.1...21.0.2) (2026-05-12)

### Bug Fixes

* **ai:** expose includeRequestBodyInErrors on AxAIServiceOptions ([#514](undefined/undefined/undefined/issues/514)) a22531c

## [21.0.2](///compare/21.0.0...21.0.1) (2026-05-12)

### Bug Fixes

* **ai:** expose includeRequestBodyInErrors on AxAIServiceOptions ([#514](undefined/undefined/undefined/issues/514)) a22531c
## [21.0.1](///compare/21.0.0...21.0.1) (2026-05-12)

## [21.0.1](///compare/20.0.2...21.0.0) (2026-05-12)
## [21.0.0](///compare/20.0.2...21.0.0) (2026-05-09)

### Features

* **agent:** pass alreadyLoaded snapshot to onMemoriesSearch 69ae7d2
* **agent:** unify child-agent registration through functions array 689c0ba

### Bug Fixes

* **skill:** drop false claim that forward() exposes memory results e8f5686

## [21.0.0](///compare/20.0.1...20.0.2) (2026-05-09)

### Features

* **agent:** pass alreadyLoaded snapshot to onMemoriesSearch 69ae7d2
* **agent:** unify child-agent registration through functions array 689c0ba

### Bug Fixes

* **skill:** drop false claim that forward() exposes memory results e8f5686
## [20.0.2](///compare/20.0.1...20.0.2) (2026-05-08)

### Bug Fixes

* **examples:** remove deleted recursionOptions.maxDepth, fix functions shape a1b65c8
* **google-gemini:** correct Vertex cachedContents URL and model resource ([#513](undefined/undefined/undefined/issues/513)) f2c39e5

## [20.0.2](///compare/20.0.0...20.0.1) (2026-05-08)

### Bug Fixes

* **examples:** remove deleted recursionOptions.maxDepth, fix functions shape a1b65c8
* **google-gemini:** correct Vertex cachedContents URL and model resource ([#513](undefined/undefined/undefined/issues/513)) f2c39e5
## [20.0.1](///compare/20.0.0...20.0.1) (2026-04-30)

### Bug Fixes

* **docs:** remove deleted llmQueryPromptMode field; add typecheck to CI 947fcdf
* **sig:** avoid structuredClone on Zod-backed fields, expose AxSignatureConfig overloads ([#512](undefined/undefined/undefined/issues/512)) 0222938

## [20.0.1](///compare/19.0.45...20.0.0) (2026-04-30)

### Bug Fixes

* **docs:** remove deleted llmQueryPromptMode field; add typecheck to CI 947fcdf
* **sig:** avoid structuredClone on Zod-backed fields, expose AxSignatureConfig overloads ([#512](undefined/undefined/undefined/issues/512)) 0222938
## [20.0.0](///compare/19.0.45...20.0.0) (2026-04-25)

### Features

* **agent:** add contextOptions to independently bound the ctx distillation stage 7e77158
* **agent:** drop llmQuery advanced mode, simplify RLM actor prompts 1f2d8a1
* **agent:** Stage 2+3 — split RLM actor templates and coordinator AxAgent 68cdff3

### Bug Fixes

* **gemini:** default Vertex Gemini to v1 and harden streaming ([#511](undefined/undefined/undefined/issues/511)) 8ee4c3e

### Performance Improvements

* **agent:** shrink RLM actor system prompt by ~480 chars ce46475

## [20.0.0](///compare/19.0.44...19.0.45) (2026-04-25)

### Features

* **agent:** add contextOptions to independently bound the ctx distillation stage 7e77158
* **agent:** drop llmQuery advanced mode, simplify RLM actor prompts 1f2d8a1
* **agent:** Stage 2+3 — split RLM actor templates and coordinator AxAgent 68cdff3

### Bug Fixes

* **gemini:** default Vertex Gemini to v1 and harden streaming ([#511](undefined/undefined/undefined/issues/511)) 8ee4c3e

### Performance Improvements

* **agent:** shrink RLM actor system prompt by ~480 chars ce46475
## [19.0.45](///compare/19.0.44...19.0.45) (2026-04-15)

### Features

* node thread worker security upgrades 4a29618
* support for zod / standard-schema/spec 82583ee

## [19.0.45](///compare/19.0.43...19.0.44) (2026-04-15)

### Features

* node thread worker security upgrades 4a29618
* support for zod / standard-schema/spec 82583ee

### Bug Fixes

* **metrics:** use shared model name normalization for cost and config lookups ([#509](undefined/undefined/undefined/issues/509)) 5e885af

## [19.0.44](///compare/19.0.43...19.0.44) (2026-04-13)

### Bug Fixes

* **metrics:** use shared model name normalization for cost and config lookups ([#509](undefined/undefined/undefined/issues/509)) 5e885af4

## [19.0.43](///compare/19.0.42...19.0.43) (2026-04-10)

### Bug Fixes

* **metrics:** accurate estimated cost metric for all request types ([#508](undefined/undefined/undefined/issues/508)) 07f2ba75
* **agent:** extract code from anywhere in javascriptCode field ([#507](undefined/undefined/undefined/issues/507)) 2894bcd0
* fix ollama thinking ([#506](undefined/undefined/undefined/issues/506)) b1fcdf32

## [19.0.42](///compare/19.0.40...19.0.41) (2026-04-07)

### Features

* add GPT-5.4 models + fix: pass chatReqUpdater through Azure OpenAI ([#505](undefined/undefined/undefined/issues/505)) 6cef135

### Bug Fixes

* various fixes d12a683
* various fixes 5d257d5
## [19.0.41](///compare/19.0.40...19.0.41) (2026-04-01)

## [19.0.41](///compare/19.0.39...19.0.40) (2026-04-01)
## [19.0.40](///compare/19.0.39...19.0.40) (2026-04-01)

## [19.0.40](///compare/19.0.38...19.0.39) (2026-04-01)
## [19.0.39](///compare/19.0.38...19.0.39) (2026-04-01)

### Bug Fixes

* gemini 3.1 pro vertex fixes 979383d

## [19.0.39](///compare/19.0.37...19.0.38) (2026-04-01)

### Bug Fixes

* gemini 3.1 pro vertex fixes 979383d
## [19.0.38](///compare/19.0.37...19.0.38) (2026-03-29)

### Features

* chat logs for training data 874e38f

## [19.0.38](///compare/19.0.36...19.0.37) (2026-03-29)

### Features

* chat logs for training data 874e38f
## [19.0.37](///compare/19.0.36...19.0.37) (2026-03-27)

### Features

* **dsp:** add customTemplate option to AxGen ([#499](undefined/undefined/undefined/issues/499)) 63e496e, closes #469 #493
* refresh system prompt <available_functions> after ctx.addFunctions() ([#501](undefined/undefined/undefined/issues/501)) 6d8517c, closes #500

### Bug Fixes

* preserve thought_signature in Gemini 3 context cache paths ([#502](undefined/undefined/undefined/issues/502)) 31e2f95
* various fixes f50828c

## [19.0.37](///compare/19.0.35...19.0.36) (2026-03-27)

### Features

* **dsp:** add customTemplate option to AxGen ([#499](undefined/undefined/undefined/issues/499)) 63e496e, closes #469 #493
* refresh system prompt <available_functions> after ctx.addFunctions() ([#501](undefined/undefined/undefined/issues/501)) 6d8517c, closes #500

### Bug Fixes

* preserve thought_signature in Gemini 3 context cache paths ([#502](undefined/undefined/undefined/issues/502)) 31e2f95
* various fixes f50828c
## [19.0.36](///compare/19.0.35...19.0.36) (2026-03-27)

### Bug Fixes

* various fixes 05cbc64

## [19.0.36](///compare/19.0.34...19.0.35) (2026-03-27)

### Bug Fixes

* various fixes 05cbc64
## [19.0.35](///compare/19.0.34...19.0.35) (2026-03-26)

### Bug Fixes

* handle read-only global properties in Deno worker scope f2ae6a8

## [19.0.35](///compare/19.0.33...19.0.34) (2026-03-26)

### Bug Fixes

* handle read-only global properties in Deno worker scope f2ae6a8
## [19.0.34](///compare/19.0.33...19.0.34) (2026-03-26)

### Features

* add agentStatusCallback and fix final() contract in AxAgent RLM 921357f
* add stop() and success()/failed() to AxAgentCompletionProtocol 375e391

## [19.0.34](///compare/19.0.32...19.0.33) (2026-03-26)

### Features

* add agentStatusCallback and fix final() contract in AxAgent RLM 921357f
* add stop() and success()/failed() to AxAgentCompletionProtocol 375e391
## [19.0.33](///compare/19.0.32...19.0.33) (2026-03-24)

### Bug Fixes

* handle DataCloneError in JS runtime worker message passing 8f54922

## [19.0.33](///compare/19.0.31...19.0.32) (2026-03-24)

### Bug Fixes

* handle DataCloneError in JS runtime worker message passing 8f54922
## [19.0.32](///compare/19.0.31...19.0.32) (2026-03-24)

### Features

* improvements to the live runtime state system 0ed618d

### Bug Fixes

* various rlm runtime fixes 929939e

## [19.0.32](///compare/19.0.30...19.0.31) (2026-03-24)

### Features

* improvements to the live runtime state system 0ed618d

### Bug Fixes

* various rlm runtime fixes 929939e
## [19.0.31](///compare/19.0.30...19.0.31) (2026-03-23)

### Bug Fixes

* Bubble up AxAgentClarificationError instead of logging in actorLog 7eb3739
* test failures c8e5cae

## [19.0.31](///compare/19.0.29...19.0.30) (2026-03-23)

### Bug Fixes

* Bubble up AxAgentClarificationError instead of logging in actorLog 7eb3739
* test failures c8e5cae
## [19.0.30](///compare/19.0.29...19.0.30) (2026-03-23)

## [19.0.30](///compare/19.0.28...19.0.29) (2026-03-23)
## [19.0.29](///compare/19.0.28...19.0.29) (2026-03-22)

## [19.0.29](///compare/19.0.27...19.0.28) (2026-03-22)
## [19.0.28](///compare/19.0.27...19.0.28) (2026-03-22)

## [19.0.28](///compare/19.0.26...19.0.27) (2026-03-22)
## [19.0.27](///compare/19.0.26...19.0.27) (2026-03-22)

## [19.0.27](///compare/19.0.25...19.0.26) (2026-03-22)
## [19.0.26](///compare/19.0.25...19.0.26) (2026-03-21)

## [19.0.26](///compare/19.0.24...19.0.25) (2026-03-21)
## [19.0.25](///compare/19.0.24...19.0.25) (2026-03-20)

## [19.0.25](///compare/19.0.23...19.0.24) (2026-03-20)
## [19.0.24](///compare/19.0.23...19.0.24) (2026-03-19)

### Bug Fixes

* agent refactor and other fixes 2018ddc

## [19.0.24](///compare/19.0.22...19.0.23) (2026-03-19)

### Bug Fixes

* agent refactor and other fixes 2018ddc
## [19.0.23](///compare/19.0.22...19.0.23) (2026-03-19)

### Features

* automatic model upgrade in axagent d841ed6

## [19.0.23](///compare/19.0.21...19.0.22) (2026-03-19)

### Features

* automatic model upgrade in axagent d841ed6
## [19.0.22](///compare/19.0.21...19.0.22) (2026-03-18)

### Features

* gepa optimizer for axagent and other features 12e0644

## [19.0.22](///compare/19.0.20...19.0.21) (2026-03-18)

### Features

* gepa optimizer for axagent and other features 12e0644
## [19.0.21](///compare/19.0.20...19.0.21) (2026-03-18)

### Features

* redesign of axagent advanced mode (true recursion) e8c075e

## [19.0.21](///compare/19.0.19...19.0.20) (2026-03-18)

### Features

* redesign of axagent advanced mode (true recursion) e8c075e
## [19.0.20](///compare/19.0.19...19.0.20) (2026-03-17)

### Features

* better agent prompt, more contex policy presets and new callbacks 7a36501

## [19.0.20](///compare/19.0.18...19.0.19) (2026-03-17)

### Features

* better agent prompt, more contex policy presets and new callbacks 7a36501
## [19.0.19](///compare/19.0.18...19.0.19) (2026-03-17)

### Bug Fixes

* deno webworker fixes b4f9538

## [19.0.19](///compare/19.0.17...19.0.18) (2026-03-17)

### Bug Fixes

* deno webworker fixes b4f9538
## [19.0.18](///compare/19.0.17...19.0.18) (2026-03-17)

### Features

* state management and gepa optimization for axagent 48fb04b

## [19.0.18](///compare/19.0.16...19.0.17) (2026-03-17)

### Features

* state management and gepa optimization for axagent 48fb04b
## [19.0.17](///compare/19.0.16...19.0.17) (2026-03-15)

### Features

* major docs cleanup and nw website cc9adca
* massive improvements to axagent context policy 4b9772f

## [19.0.17](///compare/19.0.15...19.0.16) (2026-03-15)

### Features

* major docs cleanup and nw website cc9adca
* massive improvements to axagent context policy 4b9772f
## [19.0.16](///compare/19.0.15...19.0.16) (2026-03-11)

### Features

* axagent test harness 413b590

### Bug Fixes

* build fix 617a48b

## [19.0.16](///compare/19.0.14...19.0.15) (2026-03-11)

### Features

* axagent test harness 413b590

### Bug Fixes

* build fix 617a48b
## [19.0.15](///compare/19.0.14...19.0.15) (2026-03-09)

## [19.0.15](///compare/19.0.13...19.0.14) (2026-03-09)
## [19.0.14](///compare/19.0.13...19.0.14) (2026-03-09)

### Bug Fixes

* make llm use batch functions a5d694e
* optimize discovery prompts for axagent 8304a63

## [19.0.14](///compare/19.0.12...19.0.13) (2026-03-09)

### Bug Fixes

* make llm use batch functions a5d694e
* optimize discovery prompts for axagent 8304a63
## [19.0.13](///compare/19.0.12...19.0.13) (2026-03-07)

### Features

* implement patchGlobals method for AxCodeSession and update related functionality ef03ceb

## [19.0.13](///compare/19.0.11...19.0.12) (2026-03-07)

### Features

* implement patchGlobals method for AxCodeSession and update related functionality ef03ceb
## [19.0.12](///compare/19.0.11...19.0.12) (2026-03-06)

### Features

* add inputUpdateCallback for dynamic input updates during actor turns b233e2f
* add RLM Discovery example with writing coach and analytics tools 9f5ec0d

### Bug Fixes

* update model names and costs for Google Gemini configurations 48b3235

## [19.0.12](///compare/19.0.10...19.0.11) (2026-03-06)

### Features

* add inputUpdateCallback for dynamic input updates during actor turns b233e2f
* add RLM Discovery example with writing coach and analytics tools 9f5ec0d

### Bug Fixes

* update model names and costs for Google Gemini configurations 48b3235
## [19.0.11](///compare/19.0.10...19.0.11) (2026-03-01)

### Features

* add local field support to keep shared fields available in parent agents e84014b

### Bug Fixes

* don't throw on bare object schemas in Anthropic tool parameters ([#494](undefined/undefined/undefined/issues/494)) c7a4ecc
* update schema validation to allow arbitrary JSON objects in structured outputs 77c4583

## [19.0.11](///compare/19.0.9...19.0.10) (2026-03-01)

### Features

* add local field support to keep shared fields available in parent agents e84014b

### Bug Fixes

* don't throw on bare object schemas in Anthropic tool parameters ([#494](undefined/undefined/undefined/issues/494)) c7a4ecc
* update schema validation to allow arbitrary JSON objects in structured outputs 77c4583
## [19.0.10](///compare/19.0.9...19.0.10) (2026-02-27)

### Features

* implement session auto-recovery after timeout and improve error handling 7f76d94

## [19.0.10](///compare/19.0.8...19.0.9) (2026-02-27)

### Features

* implement session auto-recovery after timeout and improve error handling 7f76d94
## [19.0.9](///compare/19.0.8...19.0.9) (2026-02-27)

### Features

* enhance error handling by providing focused source context for runtime errors 7b3e5ee

## [19.0.9](///compare/19.0.7...19.0.8) (2026-02-27)

### Features

* enhance error handling by providing focused source context for runtime errors 7b3e5ee
## [19.0.8](///compare/19.0.7...19.0.8) (2026-02-26)

### Features

* enhance error formatting and template rendering 1dc59ae

## [19.0.8](///compare/19.0.6...19.0.7) (2026-02-26)

### Features

* enhance error formatting and template rendering 1dc59ae

## [19.0.7](///compare/19.0.5...19.0.6) (2026-02-26)
## [19.0.6](///compare/19.0.5...19.0.6) (2026-02-26)

### Bug Fixes

* build fix 7286042

## [19.0.6](///compare/19.0.4...19.0.5) (2026-02-26)

### Bug Fixes

* build fix 7286042
## [19.0.5](///compare/19.0.4...19.0.5) (2026-02-26)

### Features

* enhance context field handling and improve type normalization in RLM bdd2ccd

## [19.0.5](///compare/19.0.3...19.0.4) (2026-02-26)

### Features

* enhance context field handling and improve type normalization in RLM bdd2ccd
## [19.0.4](///compare/19.0.3...19.0.4) (2026-02-26)

## [19.0.4](///compare/19.0.2...19.0.3) (2026-02-26)
## [19.0.3](///compare/19.0.2...19.0.3) (2026-02-26)

## [19.0.3](///compare/19.0.1...19.0.2) (2026-02-26)
## [19.0.2](///compare/19.0.1...19.0.2) (2026-02-25)

### Features

* add self-registration prevention for child agents and update documentation references 74f9c14

## [19.0.2](///compare/19.0.0...19.0.1) (2026-02-25)

### Features

* add self-registration prevention for child agents and update documentation references 74f9c14
## [19.0.1](///compare/19.0.0...19.0.1) (2026-02-25)

### Features

* update agent function structure to use object notation for functions and agents 399e454

## [19.0.1](///compare/18.0.14...19.0.0) (2026-02-25)

### Features

* update agent function structure to use object notation for functions and agents 399e454
## [19.0.0](///compare/18.0.14...19.0.0) (2026-02-25)

## [19.0.0](///compare/18.0.13...18.0.14) (2026-02-25)

### Features

* enhance AxAgent with agent function management and sharing capabilities 9ab332b

## [18.0.14](///compare/18.0.12...18.0.13) (2026-02-25)

### Features

* enhance AxAgent with agent function management and sharing capabilities 9ab332b
## [18.0.13](///compare/18.0.12...18.0.13) (2026-02-24)

### Features

* Add support for shared fields and agents in AxAgent, enhancing agent hierarchy data passing e541397

## [18.0.13](///compare/18.0.11...18.0.12) (2026-02-24)

### Features

* Add ai parameter to wrapFunction and related methods in AxAgent for enhanced functionality 0e59c96
* Add support for shared fields and agents in AxAgent, enhancing agent hierarchy data passing e541397

## [18.0.12](///compare/18.0.10...18.0.11) (2026-02-24)

### Features

* Add ai parameter to wrapFunction and related methods in AxAgent for enhanced functionality 0e59c96
## [18.0.11](///compare/18.0.10...18.0.11) (2026-02-24)

### Features

* Enhance shared fields handling in AxAgent and add new tests for parameter scoping f8002bc

## [18.0.11](///compare/18.0.9...18.0.10) (2026-02-24)

### Features

* Enhance shared fields handling in AxAgent and add new tests for parameter scoping f8002bc
## [18.0.10](///compare/18.0.9...18.0.10) (2026-02-24)

### Features

* Add toInputJSONSchema method and related tests for AxSignature and agent function parameters c836239

## [18.0.10](///compare/18.0.8...18.0.9) (2026-02-24)

### Features

* Add toInputJSONSchema method and related tests for AxSignature and agent function parameters c836239
## [18.0.9](///compare/18.0.8...18.0.9) (2026-02-24)

### Features

* Add support for shared fields in AxAgent and context management 59d7604
* Enhance context management with updated tombstoning options and new example 09a9c25
* Implement semantic context management in AxAgent 899540b

## [18.0.9](///compare/18.0.7...18.0.8) (2026-02-24)

### Features

* Add support for shared fields in AxAgent and context management 59d7604
* Enhance context management with updated tombstoning options and new example 09a9c25
* Implement semantic context management in AxAgent 899540b
* **runtime:** add consecutive execution error cutoff and enhance error handling in AxJSRuntime f8c06fa

## [18.0.8](///compare/18.0.6...18.0.7) (2026-02-23)

### Features

* **runtime:** add consecutive execution error cutoff and enhance error handling in AxJSRuntime f8c06fa
## [18.0.7](///compare/18.0.6...18.0.7) (2026-02-22)

### Features

* **worker:** add tests for variable persistence across async calls and enhance axWorkerRuntime with top-level declaration extraction a2ba6b3

## [18.0.7](///compare/18.0.5...18.0.6) (2026-02-22)

### Features

* **worker:** add tests for variable persistence across async calls and enhance axWorkerRuntime with top-level declaration extraction a2ba6b3
## [18.0.6](///compare/18.0.5...18.0.6) (2026-02-21)

### Features

* **worker:** enhance axWorkerRuntime and getWorkerSource with improved serialization handling and bundler polyfills 51a9994

### Bug Fixes

* **worker:** use bundler-safe require access in serialized runtime 4c0e127

## [18.0.6](///compare/18.0.4...18.0.5) (2026-02-21)

### Features

* **worker:** enhance axWorkerRuntime and getWorkerSource with improved serialization handling and bundler polyfills 51a9994
* **worker:** implement axWorkerRuntime for improved worker source management 9e99e48

### Bug Fixes

* **worker:** use bundler-safe require access in serialized runtime 4c0e127

## [18.0.5](///compare/18.0.3...18.0.4) (2026-02-21)

### Features

* **worker:** implement axWorkerRuntime for improved worker source management 9e99e48
## [18.0.4](///compare/18.0.3...18.0.4) (2026-02-20)

### Features

* Implement getUsageInstructions method in AxCodeRuntime and update related usages across multiple files for consistency 7f2dfcd

### Bug Fixes

* Migrate from nested `rlm` object to top-level properties for context fields, runtime, and other options across multiple agents and examples. Update documentation and examples to reflect the new structure, ensuring clarity in agent definitions and improving consistency in code organization. 3c55e1c

## [18.0.4](///compare/18.0.2...18.0.3) (2026-02-20)

### Features

* Enhance AxAgent with recursion options and action description logging 908303d
* Implement getUsageInstructions method in AxCodeRuntime and update related usages across multiple files for consistency 7f2dfcd

### Bug Fixes

* Migrate from nested `rlm` object to top-level properties for context fields, runtime, and other options across multiple agents and examples. Update documentation and examples to reflect the new structure, ensuring clarity in agent definitions and improving consistency in code organization. 3c55e1c

## [18.0.3](///compare/18.0.1...18.0.2) (2026-02-20)

### Features

* Enhance AxAgent with recursion options and action description logging 908303d
## [18.0.2](///compare/18.0.1...18.0.2) (2026-02-19)

### Features

* Enhance AxAgent with demo validation and descriptions 462bc72

## [18.0.2](///compare/18.0.0...18.0.1) (2026-02-19)

### Features

* Enhance AxAgent with demo validation and descriptions 462bc72

## [18.0.1](///compare/17.0.11...18.0.0) (2026-02-19)
## [18.0.0](///compare/17.0.11...18.0.0) (2026-02-19)

### Features

* Redesign of AxAgent to be RLM native ddb1f17

## [18.0.0](///compare/17.0.10...17.0.11) (2026-02-19)

### Features

* Redesign of AxAgent to be RLM native ddb1f17
## [17.0.11](///compare/17.0.10...17.0.11) (2026-02-17)

### Bug Fixes

* update AxJSRuntime usage instructions and enhance llmQuery handling in AxAgent c424489

## [17.0.11](///compare/17.0.9...17.0.10) (2026-02-17)

### Bug Fixes

* update AxJSRuntime usage instructions and enhance llmQuery handling in AxAgent c424489
## [17.0.10](///compare/17.0.9...17.0.10) (2026-02-17)

### Features

* enhance AxJSRuntime with output mode and usage instructions fe07dec

## [17.0.10](///compare/17.0.8...17.0.9) (2026-02-17)

### Features

* enhance AxJSRuntime with output mode and usage instructions fe07dec
## [17.0.9](///compare/17.0.8...17.0.9) (2026-02-17)

### Features

* new inline and function modse for axagent rlm a2b4c0f

## [17.0.9](///compare/17.0.7...17.0.8) (2026-02-17)

### Features

* new inline and function modse for axagent rlm a2b4c0f
## [17.0.8](///compare/17.0.7...17.0.8) (2026-02-16)

### Features

* improve error handling in AxJSRuntime and integration tests 799a425

## [17.0.8](///compare/17.0.6...17.0.7) (2026-02-16)

### Features

* improve error handling in AxJSRuntime and integration tests 799a425
## [17.0.7](///compare/17.0.6...17.0.7) (2026-02-16)

### Features

* enhance error handling with data preservation in AxJSRuntime 272a8ee

## [17.0.7](///compare/17.0.5...17.0.6) (2026-02-16)

### Features

* enhance error handling with data preservation in AxJSRuntime 272a8ee
## [17.0.6](///compare/17.0.5...17.0.6) (2026-02-16)

### Features

* enhance error handling in AxJSRuntime ed939cf

## [17.0.6](///compare/17.0.4...17.0.5) (2026-02-16)

### Features

* enhance error handling in AxJSRuntime ed939cf
## [17.0.5](///compare/17.0.4...17.0.5) (2026-02-16)

### Features

* enhance RLM session management and error handling 77493d5

## [17.0.5](///compare/17.0.3...17.0.4) (2026-02-16)

### Features

* enhance RLM session management and error handling 77493d5
## [17.0.4](///compare/17.0.3...17.0.4) (2026-02-16)

### Features

* implement RLM session recreation and error handling 2158092

## [17.0.4](///compare/17.0.2...17.0.3) (2026-02-16)

### Features

* implement RLM session recreation and error handling 2158092
## [17.0.3](///compare/17.0.2...17.0.3) (2026-02-16)

## [17.0.3](///compare/17.0.1...17.0.2) (2026-02-16)
## [17.0.2](///compare/17.0.1...17.0.2) (2026-02-15)

### Features

* rename AxCodeInterpreter to AxCodeRuntime d9b5e9a

## [17.0.2](///compare/17.0.0...17.0.1) (2026-02-15)

### Features

* rename AxCodeInterpreter to AxCodeRuntime d9b5e9a
## [17.0.1](///compare/17.0.0...17.0.1) (2026-02-15)

### Bug Fixes

* make RLM interpreter returns less brittle 6d0b314

## [17.0.1](///compare/16.1.12...17.0.0) (2026-02-15)

### Bug Fixes

* make RLM interpreter returns less brittle 6d0b314
## [17.0.0](///compare/16.1.12...17.0.0) (2026-02-15)

### ⚠ BREAKING CHANGES

* rename AxJSInterpreter API to AxJSRuntime

### Features

* harden stop/abort behavior across AxGen, AxAgent, and AxFlow a5c7f9b
* rename AxJSInterpreter API to AxJSRuntime c0a6f13
* unify JavaScript runtime interpreter across packages 9b0c0f7

## [17.0.0](///compare/16.1.11...16.1.12) (2026-02-15)

### ⚠ BREAKING CHANGES

* rename AxJSInterpreter API to AxJSRuntime

### Features

* harden stop/abort behavior across AxGen, AxAgent, and AxFlow a5c7f9b
* rename AxJSInterpreter API to AxJSRuntime c0a6f13
* unify JavaScript runtime interpreter across packages 9b0c0f7
## [16.1.12](///compare/16.1.11...16.1.12) (2026-02-14)

### Features

* add RLM support in AxAgent for long context analysis 41e3254

## [16.1.12](///compare/16.1.10...16.1.11) (2026-02-14)

### Features

* add RLM support in AxAgent for long context analysis 41e3254
## [16.1.11](///compare/16.1.10...16.1.11) (2026-02-14)

### Features

* introduce AxRLMJSInterpreter with sandbox permissions and update documentation 2f0e990

## [16.1.11](///compare/16.1.9...16.1.10) (2026-02-14)

### Features

* introduce AxRLMJSInterpreter with sandbox permissions and update documentation 2f0e990
## [16.1.10](///compare/16.1.9...16.1.10) (2026-02-12)

### Features

* enhance postbuild and postinstall scripts for skill file handling 28d260b

## [16.1.10](///compare/16.1.8...16.1.9) (2026-02-12)

### Features

* enhance postbuild and postinstall scripts for skill file handling 28d260b
## [16.1.9](///compare/16.1.8...16.1.9) (2026-02-12)

### Features

* implement abort functionality in AxAgent, AxGen, and AxFlow d450bbd

### Bug Fixes

* unify llmQuery functionality and update documentation af64cf9

## [16.1.9](///compare/16.1.7...16.1.8) (2026-02-12)

### Features

* implement abort functionality in AxAgent, AxGen, and AxFlow d450bbd

### Bug Fixes

* unify llmQuery functionality and update documentation af64cf9
## [16.1.8](///compare/16.1.7...16.1.8) (2026-02-11)

### Features

* enhance AxAgent with structured context fields and improve documentation b149463

## [16.1.8](///compare/16.1.6...16.1.7) (2026-02-11)

### Features

* enhance AxAgent with structured context fields and improve documentation b149463
## [16.1.7](///compare/16.1.6...16.1.7) (2026-02-10)

### Features

* enhance AxAIGoogleGemini tests for thinkingBudget preservation dbe1245

## [16.1.7](///compare/16.1.5...16.1.6) (2026-02-10)

### Features

* add AxAgent RLM support, self-tuning improvements, and docs updates 508ba77
* enhance AxAIGoogleGemini tests for thinkingBudget preservation dbe1245

### Bug Fixes

* correct temperature property in self-tuning schema generation 59efdb3

## [16.1.6](///compare/16.1.4...16.1.5) (2026-02-09)

### Features

* add AxAgent RLM support, self-tuning improvements, and docs updates 508ba77

### Bug Fixes

* correct temperature property in self-tuning schema generation 59efdb3
## [16.1.5](///compare/16.1.4...16.1.5) (2026-02-08)

### Bug Fixes

* remove unused @types/uuid dev dependency breaking type-checks 876e45c

## [16.1.5](///compare/16.1.2...16.1.4) (2026-02-08)

### Bug Fixes

* remove unused @types/uuid dev dependency breaking type-checks 876e45c
## [16.1.4](///compare/16.1.2...16.1.4) (2026-02-08)

### Features

* add function-call fallback for structured output on unsupported providers f3e787c
* add step context, step hooks, and self-tuning with enriched descriptions 76bddaa

### Bug Fixes

* ensure Gemini 3+ minimum temperature of 1.0 is actually applied 57c8edd
* normalize type unions in cleanSchemaForGemini for json[] compatibility ([#488](undefined/undefined/undefined/issues/488)) fdba299

## [16.1.4](///compare/16.1.2...16.1.2) (2026-02-08)

### Features

* add function-call fallback for structured output on unsupported providers f3e787c
* add step context, step hooks, and self-tuning with enriched descriptions 76bddaa

### Bug Fixes

* ensure Gemini 3+ minimum temperature of 1.0 is actually applied 57c8edd
* normalize type unions in cleanSchemaForGemini for json[] compatibility ([#488](undefined/undefined/undefined/issues/488)) fdba299

## [16.1.3](///compare/16.1.1...16.1.2) (2026-02-08)

### Features

* add function-call fallback for structured output on unsupported providers f3e787c
* add step context, step hooks, and self-tuning with enriched descriptions 76bddaa

### Bug Fixes

* ensure Gemini 3+ minimum temperature of 1.0 is actually applied 57c8edd
## [16.1.2](///compare/16.1.1...16.1.2) (2026-02-06)

### Bug Fixes

* enforce model-specific thinking params and default temp for Gemini 3+ 00b181d

## [16.1.2](///compare/16.1.0...16.1.1) (2026-02-06)

### Bug Fixes

* enforce model-specific thinking params and default temp for Gemini 3+ 00b181d
## [16.1.1](///compare/16.1.0...16.1.1) (2026-02-04)

## [16.1.1](///compare/16.0.13...16.1.0) (2026-02-04)
## [16.1.0](///compare/16.0.13...16.1.0) (2026-02-02)

### Bug Fixes

* update dependencies and enhance Gemini model handling 1b03d62

## [16.1.0](///compare/16.0.12...16.0.13) (2026-02-02)

### Bug Fixes

* update dependencies and enhance Gemini model handling 1b03d62
## [16.0.13](///compare/16.0.12...16.0.13) (2026-01-29)

### Bug Fixes

* prevent item duplication during streaming finalization [#484](undefined/undefined/undefined/issues/484) [#484](undefined/undefined/undefined/issues/484) 262fd32

## [16.0.13](///compare/16.0.11...16.0.12) (2026-01-29)

### Bug Fixes

* prevent item duplication during streaming finalization [#484](undefined/undefined/undefined/issues/484) [#484](undefined/undefined/undefined/issues/484) 262fd32
## [16.0.12](///compare/16.0.11...16.0.12) (2026-01-27)

### Features

* enhance README and CLI functionality [#482](undefined/undefined/undefined/issues/482) [#475](undefined/undefined/undefined/issues/475) 67bf283

## [16.0.12](///compare/16.0.10...16.0.11) (2026-01-27)

### Features

* enhance README and CLI functionality [#482](undefined/undefined/undefined/issues/482) [#475](undefined/undefined/undefined/issues/475) 67bf283
## [16.0.11](///compare/16.0.10...16.0.11) (2026-01-27)

### Features

* enhance JSON parsing and streaming response handling [#480](undefined/undefined/undefined/issues/480) b9e7933
* introduce AxMCPClient enhancements and new documentation fc2e2ec

## [16.0.11](///compare/16.0.9...16.0.10) (2026-01-27)

### Features

* enhance JSON parsing and streaming response handling [#480](undefined/undefined/undefined/issues/480) b9e7933
* introduce AxMCPClient enhancements and new documentation fc2e2ec
## [16.0.10](///compare/16.0.9...16.0.10) (2026-01-12)

## [16.0.10](///compare/16.0.8...16.0.9) (2026-01-12)
## [16.0.9](///compare/16.0.8...16.0.9) (2026-01-10)

## [16.0.9](///compare/16.0.7...16.0.8) (2026-01-10)
## [16.0.8](///compare/16.0.7...16.0.8) (2026-01-09)

## [16.0.8](///compare/16.0.6...16.0.7) (2026-01-09)
## [16.0.7](///compare/16.0.6...16.0.7) (2026-01-08)

## [16.0.7](///compare/16.0.5...16.0.6) (2026-01-08)
## [16.0.6](///compare/16.0.5...16.0.6) (2026-01-06)

### Bug Fixes

* use cache_control on a content block, not the content itself ([#479](undefined/undefined/undefined/issues/479)) 1542957

## [16.0.6](///compare/16.0.5...16.0.6) (2026-01-06)

### Bug Fixes

* use cache_control on a content block, not the content itself 1542957

## [16.0.5](///compare/16.0.4...16.0.5) (2026-01-06)

### Bug Fixes

* include cache_control for string-typed user messages 84aa908

### Features

* write metrics for cache write / read 54ce595

## [16.0.4](///compare/16.0.2...16.0.3) (2025-12-26)

### Features

* introduce `cacheBreakpoint` option for granular control over context caching in prompts and Anthropic API. 5100807
## [16.0.3](///compare/16.0.2...16.0.3) (2025-12-24)

### Features

* Add disclaimer to system prompt and separator to user query to clarify few-shot examples and demonstrations. b2a4ee1

## [16.0.3](///compare/16.0.1...16.0.2) (2025-12-24)

### Features

* Add disclaimer to system prompt and separator to user query to clarify few-shot examples and demonstrations. b2a4ee1
## [16.0.2](///compare/16.0.1...16.0.2) (2025-12-24)

### Features

* skip examples in prompt template rendering if missing input or output content 39c6abe

## [16.0.2](///compare/16.0.0...16.0.1) (2025-12-24)

### Features

* skip examples in prompt template rendering if missing input or output content 39c6abe
## [16.0.1](///compare/16.0.0...16.0.1) (2025-12-24)

### Features

* introduce AI context caching with breakpoint semantics for prompt hashing and update documentation. a9f38d3

## [16.0.1](///compare/15.1.1...16.0.0) (2025-12-24)

### Features

* introduce AI context caching with breakpoint semantics for prompt hashing and update documentation. a9f38d3
## [16.0.0](///compare/15.1.1...16.0.0) (2025-12-23)

### Features

* Add explicit context caching for AI models and refactor structured output example rendering in prompts. afe40c2

## [16.0.0](///compare/15.1.0...15.1.1) (2025-12-23)

### Features

* Add explicit context caching for AI models and refactor structured output example rendering in prompts. afe40c2
## [15.1.1](///compare/15.1.0...15.1.1) (2025-12-21)

### Features

* Enhance GEPA optimizer with new configuration options and structured optimization report f0ef34a

## [15.1.1](///compare/15.0.28...15.1.0) (2025-12-21)

### Features

* Enhance GEPA optimizer with new configuration options and structured optimization report f0ef34a
## [15.1.0](///compare/15.0.28...15.1.0) (2025-12-17)

## [15.1.0](///compare/15.0.27...15.0.28) (2025-12-17)
## [15.0.28](///compare/15.0.27...15.0.28) (2025-12-17)

### Features

* Add Gemini 3 Flash Preview model and update food search example to use it. f08335f

## [15.0.28](///compare/15.0.26...15.0.27) (2025-12-17)

### Features

* Add Gemini 3 Flash Preview model and update food search example to use it. f08335f
## [15.0.27](///compare/15.0.26...15.0.27) (2025-12-16)

### Features

* Add GPT-5 model definitions and update documentation to use strongly typed AI model enums. 3ff2546

### Bug Fixes

* correct Claude 4.5 Haiku model name in Vertex enum ([#474](undefined/undefined/undefined/issues/474)) 24f8e40

## [15.0.27](///compare/15.0.25...15.0.26) (2025-12-16)

### Features

* Add GPT-5 model definitions and update documentation to use strongly typed AI model enums. 3ff2546

### Bug Fixes

* correct Claude 4.5 Haiku model name in Vertex enum ([#474](undefined/undefined/undefined/issues/474)) 24f8e40
## [15.0.26](///compare/15.0.25...15.0.26) (2025-12-16)

### Features

* replace `AxLearnAgent` and `AxTuner` with `AxLearn` and update GEPA optimizer to include instruction in Pareto results. dc2742b

## [15.0.26](///compare/15.0.24...15.0.25) (2025-12-16)

### Features

* replace `AxLearnAgent` and `AxTuner` with `AxLearn` and update GEPA optimizer to include instruction in Pareto results. dc2742b
## [15.0.25](///compare/15.0.24...15.0.25) (2025-12-16)

### Features

* use strongly typed model enums in documentation examples 5201e9c

## [15.0.25](///compare/15.0.23...15.0.24) (2025-12-16)

### Features

* use strongly typed model enums in documentation examples 5201e9c
## [15.0.24](///compare/15.0.23...15.0.24) (2025-12-16)

### Features

* Introduce new DSP modules (agent, tuner, synth, judge), enhance API call retry logic with `Retry-After` header support, and update documentation and examples. 8c58902

## [15.0.24](///compare/15.0.22...15.0.23) (2025-12-16)

### Features

* Introduce new DSP modules (agent, tuner, synth, judge), enhance API call retry logic with `Retry-After` header support, and update documentation and examples. 8c58902
## [15.0.23](///compare/15.0.22...15.0.23) (2025-12-15)

## [15.0.23](///compare/15.0.21...15.0.22) (2025-12-15)
## [15.0.22](///compare/15.0.21...15.0.22) (2025-12-14)

### Features

* **azure-openai:** add structured outputs support ([#473](undefined/undefined/undefined/issues/473)) a246518

## [15.0.22](///compare/15.0.20...15.0.21) (2025-12-14)

### Features

* **azure-openai:** add structured outputs support ([#473](undefined/undefined/undefined/issues/473)) a246518
## [15.0.21](///compare/15.0.20...15.0.21) (2025-12-13)

### Features

* Introduce `AxTokenLimitError` for specific token limit detection in AI API calls and add configuration for retrying on such errors. 69539df

## [15.0.21](///compare/15.0.19...15.0.20) (2025-12-13)

### Features

* Introduce `AxTokenLimitError` for specific token limit detection in AI API calls and add configuration for retrying on such errors. 69539df
## [15.0.20](///compare/15.0.19...15.0.20) (2025-12-13)

## [15.0.20](///compare/15.0.18...15.0.19) (2025-12-13)

### Features

* Implement infrastructure-level retry for service network, status, and timeout errors, adjusting default retry and step limits. 807ad4f

## [15.0.19](///compare/15.0.17...15.0.18) (2025-12-13)

### Features

* Implement infrastructure-level retry for service network, status, and timeout errors, adjusting default retry and step limits. 807ad4f
## [15.0.18](///compare/15.0.17...15.0.18) (2025-12-12)

### Features

* Improve streaming error handling by distinguishing validation from parsing errors, optimize signature complex field detection, and add API request debug logging. 117e7d2
* Improve streaming retry logic by resetting state and committed values, and clarify complex field detection for output signatures. 0bf9d87

## [15.0.18](///compare/15.0.16...15.0.17) (2025-12-12)

### Features

* Improve streaming error handling by distinguishing validation from parsing errors, optimize signature complex field detection, and add API request debug logging. 117e7d2
* Improve streaming retry logic by resetting state and committed values, and clarify complex field detection for output signatures. 0bf9d87
## [15.0.17](///compare/15.0.16...15.0.17) (2025-12-11)

### Features

* Prevent stream duplication on retry by tracking committed values and yielding only effective deltas. 98a8480

## [15.0.17](///compare/15.0.15...15.0.16) (2025-12-11)

### Features

* Prevent stream duplication on retry by tracking committed values and yielding only effective deltas. 98a8480
## [15.0.16](///compare/15.0.15...15.0.16) (2025-12-11)

### Bug Fixes

* Prevent streaming structured output duplication by refining delta calculation and resetting retry states. 946349f

## [15.0.16](///compare/15.0.14...15.0.15) (2025-12-11)

### Bug Fixes

* Prevent streaming structured output duplication by refining delta calculation and resetting retry states. 946349f
## [15.0.15](///compare/15.0.14...15.0.15) (2025-12-11)

### Features

* Enhance AI balancer with capability-based service selection and aggregated features/metrics across services. d4acef2

### Bug Fixes

* **ace:** Refine reflector to use only input fields ([#464](undefined/undefined/undefined/issues/464)) 695dbf0

## [15.0.15](///compare/15.0.13...15.0.14) (2025-12-11)

### Features

* Enhance AI balancer with capability-based service selection and aggregated features/metrics across services. d4acef2

### Bug Fixes

* **ace:** Refine reflector to use only input fields ([#464](undefined/undefined/undefined/issues/464)) 695dbf0
## [15.0.14](///compare/15.0.13...15.0.14) (2025-12-10)

### Bug Fixes

* ensure streaming partial memory blocks only merge with other partial blocks, otherwise append as new. 5679412

## [15.0.14](///compare/15.0.12...15.0.13) (2025-12-10)

### Bug Fixes

* ensure streaming partial memory blocks only merge with other partial blocks, otherwise append as new. 5679412
## [15.0.13](///compare/15.0.12...15.0.13) (2025-12-10)

### Features

* add support for Claude 4.5 Opus model ([#467](undefined/undefined/undefined/issues/467)) 88c573b

### Bug Fixes

* **dsp:** correctly extract instruction from signature in GEPA optimizer ([#466](undefined/undefined/undefined/issues/466)) 76e7a6c, closes #463

## [15.0.13](///compare/15.0.11...15.0.12) (2025-12-10)

### Features

* add support for Claude 4.5 Opus model ([#467](undefined/undefined/undefined/issues/467)) 88c573b

### Bug Fixes

* **dsp:** correctly extract instruction from signature in GEPA optimizer ([#466](undefined/undefined/undefined/issues/466)) 76e7a6c, closes #463
## [15.0.12](///compare/15.0.11...15.0.12) (2025-12-10)

### Features

* introduce AxThoughtBlockItem type and refactor thought block handling across AI models ad92200

## [15.0.12](///compare/15.0.10...15.0.11) (2025-12-10)

### Features

* introduce AxThoughtBlockItem type and refactor thought block handling across AI models ad92200
## [15.0.11](///compare/15.0.10...15.0.11) (2025-12-09)

## [15.0.11](///compare/15.0.9...15.0.10) (2025-12-09)
## [15.0.10](///compare/15.0.9...15.0.10) (2025-12-09)

### Features

* add support for structured outputs across various AI models and enhance error handling for complex fields 816484c

## [15.0.10](///compare/15.0.8...15.0.9) (2025-12-09)

### Features

* add support for structured outputs across various AI models and enhance error handling for complex fields 816484c
## [15.0.9](///compare/15.0.8...15.0.9) (2025-12-08)

### Bug Fixes

* **anthropic:** remove unsupported structured-outputs beta header for Vertex AI ([#462](undefined/undefined/undefined/issues/462)) 8420adb
* improved ax generate error bebf924

## [15.0.9](///compare/15.0.7...15.0.8) (2025-12-08)

### Bug Fixes

* **anthropic:** remove unsupported structured-outputs beta header for Vertex AI ([#462](undefined/undefined/undefined/issues/462)) 8420adb
* improved ax generate error bebf924
## [15.0.8](///compare/15.0.7...15.0.8) (2025-12-02)

### Features

* **dsp:** Separate structured output example input fields with newlines and allow missing required fields during structured output validation in response processing. 6150f36

## [15.0.8](///compare/15.0.6...15.0.7) (2025-12-02)

### Features

* **dsp:** Separate structured output example input fields with newlines and allow missing required fields during structured output validation in response processing. 6150f36
## [15.0.7](///compare/15.0.6...15.0.7) (2025-12-01)

### Features

* enhance structured output handling with distinct extraction modes and improved prompt rendering for complex fields 7ad07fe

## [15.0.7](///compare/15.0.5...15.0.6) (2025-12-01)

### Features

* enhance structured output handling with distinct extraction modes and improved prompt rendering for complex fields 7ad07fe
## [15.0.6](///compare/15.0.5...15.0.6) (2025-12-01)

### Features

* Enhance complex object and JSON extraction, add validation tests, and improve error messages with LLM output. 100ed60

## [15.0.6](///compare/15.0.4...15.0.5) (2025-12-01)

### Features

* Enhance complex object and JSON extraction, add validation tests, and improve error messages with LLM output. 100ed60
## [15.0.5](///compare/15.0.4...15.0.5) (2025-11-29)

### Features

* add documentation for AWS Bedrock, Vercel AI SDK, and Ax Tools packages. 95962ae
* **anthropic:** add validation for arbitrary json objects in structured outputs ([#459](undefined/undefined/undefined/issues/459)) 7db81c5

## [15.0.5](///compare/15.0.3...15.0.4) (2025-11-29)

### Features

* add documentation for AWS Bedrock, Vercel AI SDK, and Ax Tools packages. 95962ae
* **anthropic:** add validation for arbitrary json objects in structured outputs ([#459](undefined/undefined/undefined/issues/459)) 7db81c5
## [15.0.4](///compare/15.0.3...15.0.4) (2025-11-28)

### Features

* **mipro:** Expand MIPROv2 optimizer to tune instructions and examples ([#453](undefined/undefined/undefined/issues/453)) 2f3e6ac

### Bug Fixes

* **ace:** Ensure only input fields are passed to curator ([#456](undefined/undefined/undefined/issues/456)) 8c0c13f
* allow f.object().array() as input field ([#452](undefined/undefined/undefined/issues/452)) d36ddd6
* **anthropic:** add anthropic-beta header for web-search on Vertex AI ([#457](undefined/undefined/undefined/issues/457)) df13f8c
* build issue 71b5ae8

## [15.0.4](///compare/15.0.2...15.0.3) (2025-11-28)

### Features

* **mipro:** Expand MIPROv2 optimizer to tune instructions and examples ([#453](undefined/undefined/undefined/issues/453)) 2f3e6ac

### Bug Fixes

* **ace:** Ensure only input fields are passed to curator ([#456](undefined/undefined/undefined/issues/456)) 8c0c13f
* allow f.object().array() as input field ([#452](undefined/undefined/undefined/issues/452)) d36ddd6
* **anthropic:** add anthropic-beta header for web-search on Vertex AI ([#457](undefined/undefined/undefined/issues/457)) df13f8c
* build issue 71b5ae8
## [15.0.3](///compare/15.0.2...15.0.3) (2025-11-24)

### Features

* Update Anthropic schema cleaning to preserve `default`, `oneOf`, `anyOf`, `allOf` and conditionally remove `additionalProperties`. dbc419c

## [15.0.3](///compare/15.0.1...15.0.2) (2025-11-24)

### Features

* Update Anthropic schema cleaning to preserve `default`, `oneOf`, `anyOf`, `allOf` and conditionally remove `additionalProperties`. dbc419c
## [15.0.2](///compare/15.0.1...15.0.2) (2025-11-23)

### Features

* Implement and document parallel function calling for Google Gemini. cb1a310

## [15.0.2](///compare/15.0.0...15.0.1) (2025-11-23)

### Features

* Implement and document parallel function calling for Google Gemini. cb1a310
## [15.0.1](///compare/15.0.0...15.0.1) (2025-11-22)

### Features

* Introduce `AxSignature.hasComplexFields()` for consistent complex type detection and update example documentation. b1dc107

## [15.0.1](///compare/14.0.44...15.0.0) (2025-11-22)

### Features

* Introduce `AxSignature.hasComplexFields()` for consistent complex type detection and update example documentation. b1dc107
* Introduce structured (XML) prompt generation with format protection and tests, and remove individual streaming result logging. f04c787

## [15.0.0](///compare/14.0.43...14.0.44) (2025-11-22)

### Features

* Introduce structured (XML) prompt generation with format protection and tests, and remove individual streaming result logging. f04c787
## [14.0.44](///compare/14.0.43...14.0.44) (2025-11-22)

### Features

* **anthropic:** update and align Vertex AI model maxTokens values ([#426](undefined/undefined/undefined/issues/426)) f042d7b

## [14.0.44](///compare/14.0.42...14.0.43) (2025-11-22)

### Features

* **anthropic:** update and align Vertex AI model maxTokens values ([#426](undefined/undefined/undefined/issues/426)) f042d7b
## [14.0.43](///compare/14.0.42...14.0.43) (2025-11-22)

### Features

* Enable Anthropic web search by updating beta headers and removing tool filtering, and reorder validator imports. 60a5663

### Bug Fixes

* **vertex:** use correct Vertex AI endpoint for global region ([#428](undefined/undefined/undefined/issues/428)) 1466bc7

## [14.0.43](///compare/14.0.41...14.0.42) (2025-11-22)

### Features

* Enable Anthropic web search by updating beta headers and removing tool filtering, and reorder validator imports. 60a5663

### Bug Fixes

* **vertex:** use correct Vertex AI endpoint for global region ([#428](undefined/undefined/undefined/issues/428)) 1466bc7
## [14.0.42](///compare/14.0.41...14.0.42) (2025-11-22)

## [14.0.42](///compare/14.0.40...14.0.41) (2025-11-22)
## [14.0.41](///compare/14.0.40...14.0.41) (2025-11-21)

### Features

* Add date and datetime field types and clarify dual syntax for format validators across documentation. f1abcab
* Introduce date and datetime format validators, add dedicated email type factory, and clarify format validation syntax in documentation. c9b16a6

## [14.0.41](///compare/14.0.39...14.0.40) (2025-11-21)

### Features

* Add date and datetime field types and clarify dual syntax for format validators across documentation. f1abcab
* Introduce date and datetime format validators, add dedicated email type factory, and clarify format validation syntax in documentation. c9b16a6
## [14.0.40](///compare/14.0.39...14.0.40) (2025-11-21)

### Features

* **anthropic:** implement extended thinking signature handling in streaming mode c73646f
* **gemini:** add Gemini 3 support with thought signatures and function calling 7b6a499
* **validation:** introduce Zod-like validation constraints for structured outputs a15e5b6

### Bug Fixes

* **anthropic:** correct prompt caching property to cache_control 20606c7
* **anthropic:** support streaming cache usage and remove beta header 8fe2bfc
* buid issues 571b775
* build issues 3fa583c

## [14.0.40](///compare/14.0.38...14.0.39) (2025-11-21)

### Features

* **anthropic:** implement extended thinking signature handling in streaming mode c73646f
* **gemini:** add Gemini 3 support with thought signatures and function calling 7b6a499
* **validation:** introduce Zod-like validation constraints for structured outputs a15e5b6

### Bug Fixes

* **anthropic:** correct prompt caching property to cache_control 20606c7
* **anthropic:** support streaming cache usage and remove beta header 8fe2bfc
* buid issues 571b775
* build issues 3fa583c
## [14.0.39](///compare/14.0.38...14.0.39) (2025-11-05)

### Bug Fixes

* **api:** improve handling of empty function parameters in Anthropic, Cohere, and Google Gemini APIs e901fdc

## [14.0.39](https://github.com/ax-llm/ax/compare/14.0.37...14.0.38) (2025-11-05)

### Bug Fixes

* **api:** improve handling of empty function parameters in Anthropic, Cohere, and Google Gemini APIs ([e901fdc](https://github.com/ax-llm/ax/commit/e901fdc675951b67aca7c923885f757d8a152c7a))
## [14.0.38](https://github.com/ax-llm/ax/compare/14.0.37...14.0.38) (2025-11-05)

### Features

* **api:** enhance function parameter handling and schema validation across multiple AI integrations ([e593e75](https://github.com/ax-llm/ax/commit/e593e7521ec231f2e9841babe8cb4dfb13bd2512))
* **caching:** implement caching functionality in AxGen and AxFlow for improved performance ([18158d9](https://github.com/ax-llm/ax/commit/18158d9ba17f749e98a7814072743911131b84a1))
* **flow:** add description and toFunction methods for enhanced flow metadata ([54dfaca](https://github.com/ax-llm/ax/commit/54dfacac6f609016f2306a02f76d28cfd726028a))

### Bug Fixes

* Hardcode error class names to prevent minification issues ([#421](https://github.com/ax-llm/ax/issues/421)) ([5267340](https://github.com/ax-llm/ax/commit/5267340459564a576b6f1c9fddff785588e78af5))

## [14.0.38](https://github.com/ax-llm/ax/compare/14.0.36...14.0.37) (2025-11-05)

### Features

* **api:** enhance function parameter handling and schema validation across multiple AI integrations ([e593e75](https://github.com/ax-llm/ax/commit/e593e7521ec231f2e9841babe8cb4dfb13bd2512))
* **caching:** implement caching functionality in AxGen and AxFlow for improved performance ([18158d9](https://github.com/ax-llm/ax/commit/18158d9ba17f749e98a7814072743911131b84a1))
* **flow:** add description and toFunction methods for enhanced flow metadata ([54dfaca](https://github.com/ax-llm/ax/commit/54dfacac6f609016f2306a02f76d28cfd726028a))

### Bug Fixes

* Hardcode error class names to prevent minification issues ([#421](https://github.com/ax-llm/ax/issues/421)) ([5267340](https://github.com/ax-llm/ax/commit/5267340459564a576b6f1c9fddff785588e78af5))
## [14.0.37](https://github.com/ax-llm/ax/compare/14.0.36...14.0.37) (2025-10-22)

## [14.0.37](https://github.com/ax-llm/ax/compare/14.0.35...14.0.36) (2025-10-22)
## [14.0.36](https://github.com/ax-llm/ax/compare/14.0.35...14.0.36) (2025-10-22)

### Features

* **anthropic:** add Claude 4.5 Haiku model and update logging for thought display ([2d84bc2](https://github.com/ax-llm/ax/commit/2d84bc266d26b3338d68fc24a86e6faaf78288b0))
* **anthropic:** add Claude 4.5 Sonnet model with pricing and token limits ([af101b4](https://github.com/ax-llm/ax/commit/af101b42593abc668877099fed474421d81de6a5))

## [14.0.36](https://github.com/ax-llm/ax/compare/14.0.34...14.0.35) (2025-10-22)

### Features

* **anthropic:** add Claude 4.5 Haiku model and update logging for thought display ([2d84bc2](https://github.com/ax-llm/ax/commit/2d84bc266d26b3338d68fc24a86e6faaf78288b0))
* **anthropic:** add Claude 4.5 Sonnet model with pricing and token limits ([af101b4](https://github.com/ax-llm/ax/commit/af101b42593abc668877099fed474421d81de6a5))
## [14.0.35](https://github.com/ax-llm/ax/compare/14.0.34...14.0.35) (2025-10-19)

### Features

* add AWS Bedrock provider integration ([#395](https://github.com/ax-llm/ax/issues/395)) ([6ce7eb3](https://github.com/ax-llm/ax/commit/6ce7eb3219c9936bec0916ca0572be9fe17c670c))

### Bug Fixes

* **google-gemini:** align Google Maps grounding types/options and retrievalConfig with Gemini api ([#393](https://github.com/ax-llm/ax/issues/393)) ([b44f534](https://github.com/ax-llm/ax/commit/b44f5340a603475728179e75baa7415767eec1e9))

## [14.0.35](https://github.com/ax-llm/ax/compare/14.0.33...14.0.34) (2025-10-19)

### Features

* add AWS Bedrock provider integration ([#395](https://github.com/ax-llm/ax/issues/395)) ([6ce7eb3](https://github.com/ax-llm/ax/commit/6ce7eb3219c9936bec0916ca0572be9fe17c670c))

### Bug Fixes

* **google-gemini:** align Google Maps grounding types/options and retrievalConfig with Gemini api ([#393](https://github.com/ax-llm/ax/issues/393)) ([b44f534](https://github.com/ax-llm/ax/commit/b44f5340a603475728179e75baa7415767eec1e9))
## [14.0.34](https://github.com/ax-llm/ax/compare/14.0.33...14.0.34) (2025-10-18)

## [14.0.34](https://github.com/ax-llm/ax/compare/14.0.32...14.0.33) (2025-10-18)
## [14.0.33](https://github.com/ax-llm/ax/compare/14.0.32...14.0.33) (2025-10-17)

### Features

* add GPT-4.1 nano model support ([#387](https://github.com/ax-llm/ax/issues/387)) ([0aa4aa2](https://github.com/ax-llm/ax/commit/0aa4aa2ceed1ba61106711baed6ce962cf2eb604))

## [14.0.33](https://github.com/ax-llm/ax/compare/14.0.32...14.0.33) (2025-10-17)

### Features

* Add support for caching the system prompt in Anthropic models ([#391](https://github.com/ax-llm/ax/pull/391)) ([92afffc](https://github.com/ax-llm/ax/commit/92afffcf1a60edecd0c0804eae2c0d6deda8d508))
* docs: Created docs/ARCHITECTURE.md ([#390](https://github.com/ax-llm/ax/pull/390)) ([61ac71b](https://github.com/ax-llm/ax/commit/61ac71b6a61fda7e91c18460f8482fd2267a2e29))
* feat: add GPT-4.1 nano model support ([#387](https://github.com/ax-llm/ax/pull/387)) ([0aa4aa2](https://github.com/ax-llm/ax/commit/0aa4aa2ceed1ba61106711baed6ce962cf2eb604))

## [14.0.32](https://github.com/ax-llm/ax/compare/14.0.30...14.0.31) (2025-10-15)

### Features

* **ace:** implement agentic context engineering ([#386](https://github.com/ax-llm/ax/issues/386)) ([a54eb50](https://github.com/ax-llm/ax/commit/a54eb50b9069eae5e00d02c683cdce459e7d596c))

### Bug Fixes

* **flow/planner:** update regex for block splitting to handle whitespace correctly ([7e8ad09](https://github.com/ax-llm/ax/commit/7e8ad09ff599c8660f0754c4b71c28bee2026774))
* handle numeric zero values in prompt field rendering ([#382](https://github.com/ax-llm/ax/issues/382)) ([d06849c](https://github.com/ax-llm/ax/commit/d06849c70c1cc2d61f5ab82c435fbbc3b027e190))
* log originating error in balancer ([#385](https://github.com/ax-llm/ax/issues/385)) ([70ca5e5](https://github.com/ax-llm/ax/commit/70ca5e563f706a00d9a858dbdae5f4b047b94c8f))
* **rag): guard undefined retrievalResults and guarantee non-empty finalContext; fix(flow/planner:** avoid executing map transforms during analysis to prevent mock side effects; build: green across workspaces; closes [#323](https://github.com/ax-llm/ax/issues/323) ([d1bce5b](https://github.com/ax-llm/ax/commit/d1bce5b5f2bb32100a8fb2c90041ff0979d30a8b))
## [14.0.31](https://github.com/ax-llm/ax/compare/14.0.30...14.0.31) (2025-10-08)

### Features

* add thoughtBlock to AxChatResponseResult and enhance validation ([7b49f65](https://github.com/ax-llm/ax/commit/7b49f65bf5474fb1c9e337e76e231c74ad21da98))

## [14.0.31](https://github.com/ax-llm/ax/compare/14.0.29...14.0.30) (2025-10-08)

### Features

* add thoughtBlock to AxChatResponseResult and enhance validation ([7b49f65](https://github.com/ax-llm/ax/commit/7b49f65bf5474fb1c9e337e76e231c74ad21da98))
## [14.0.30](https://github.com/ax-llm/ax/compare/14.0.29...14.0.30) (2025-10-07)

### Features

* enhance README with new examples and Fluent Signature API ([5cd30db](https://github.com/ax-llm/ax/commit/5cd30db98271646f3119d2fd96a734063928cc80))

## [14.0.30](https://github.com/ax-llm/ax/compare/14.0.28...14.0.29) (2025-10-07)

### Features

* enhance README with new examples and Fluent Signature API ([5cd30db](https://github.com/ax-llm/ax/commit/5cd30db98271646f3119d2fd96a734063928cc80))
## [14.0.29](https://github.com/ax-llm/ax/compare/14.0.28...14.0.29) (2025-10-04)

### Bug Fixes

* add GEPA feedback type hooks to AxCompileOptions ([#376](https://github.com/ax-llm/ax/issues/376)) ([4700c7e](https://github.com/ax-llm/ax/commit/4700c7e8e92ea3c52d9dd34020d466501dbef6bc))

## [14.0.29](https://github.com/ax-llm/ax/compare/14.0.27...14.0.28) (2025-10-04)

### Bug Fixes

* add GEPA feedback type hooks to AxCompileOptions ([#376](https://github.com/ax-llm/ax/issues/376)) ([4700c7e](https://github.com/ax-llm/ax/commit/4700c7e8e92ea3c52d9dd34020d466501dbef6bc))
## [14.0.28](https://github.com/ax-llm/ax/compare/14.0.27...14.0.28) (2025-09-28)

### Features

* add support flags for Google Gemini models ([5e785f0](https://github.com/ax-llm/ax/commit/5e785f0691c3d9e85adb63ef5e974acca6201d3a))

## [14.0.28](https://github.com/ax-llm/ax/compare/14.0.26...14.0.27) (2025-09-28)

### Features

* add support flags for Google Gemini models ([5e785f0](https://github.com/ax-llm/ax/commit/5e785f0691c3d9e85adb63ef5e974acca6201d3a))
## [14.0.27](https://github.com/ax-llm/ax/compare/14.0.26...14.0.27) (2025-09-28)

### Features

* add GEPA multi-objective optimization example and enhance documentation ([f64189c](https://github.com/ax-llm/ax/commit/f64189c45844ae7149f0d35a4aa7f7b792ba0a5d))
* integrate Vercel AI SDK v5 support and update dependencies ([3acb408](https://github.com/ax-llm/ax/commit/3acb4085e14b8845f075c84bdd55c5e9277b6b71))

### Bug Fixes

* clean up code formatting and improve consistency in examples ([f4af653](https://github.com/ax-llm/ax/commit/f4af653a737b7c0532c0e7d06066c6c5bfcb045e))

## [14.0.27](https://github.com/ax-llm/ax/compare/14.0.25...14.0.26) (2025-09-28)

### Features

* add GEPA multi-objective optimization example and enhance documentation ([f64189c](https://github.com/ax-llm/ax/commit/f64189c45844ae7149f0d35a4aa7f7b792ba0a5d))
* integrate Vercel AI SDK v5 support and update dependencies ([3acb408](https://github.com/ax-llm/ax/commit/3acb4085e14b8845f075c84bdd55c5e9277b6b71))

### Bug Fixes

* clean up code formatting and improve consistency in examples ([f4af653](https://github.com/ax-llm/ax/commit/f4af653a737b7c0532c0e7d06066c6c5bfcb045e))
## [14.0.26](https://github.com/ax-llm/ax/compare/14.0.25...14.0.26) (2025-09-15)

### Features

* enhance debug handling in AxBaseAI and global settings ([355640b](https://github.com/ax-llm/ax/commit/355640bd6a47730f8a05bb535d8f03b43d2f8f7f))

## [14.0.26](https://github.com/ax-llm/ax/compare/14.0.24...14.0.25) (2025-09-15)

### Features

* enhance debug handling in AxBaseAI and global settings ([355640b](https://github.com/ax-llm/ax/commit/355640bd6a47730f8a05bb535d8f03b43d2f8f7f))
## [14.0.25](https://github.com/ax-llm/ax/compare/14.0.24...14.0.25) (2025-09-14)

### Features

* enhance assertion capabilities in AxGen and documentation updates ([2770a07](https://github.com/ax-llm/ax/commit/2770a074adc883b55dfc655d3d46143dbf00c017))
* GEPA: enable optimizedProgram interface to mirror MiPRO ([#350](https://github.com/ax-llm/ax/issues/350)) ([9b1ae9a](https://github.com/ax-llm/ax/commit/9b1ae9a21c62ec913bad5dc38481a271e3facac2))
* unify GEPA and MiPRO interfaces for consistent optimization workflows ([7cf8e28](https://github.com/ax-llm/ax/commit/7cf8e289dbc38af57cb08e6e92b0ebbbcb2516bb))

## [14.0.25](https://github.com/ax-llm/ax/compare/14.0.23...14.0.24) (2025-09-14)

### Features

* enhance assertion capabilities in AxGen and documentation updates ([2770a07](https://github.com/ax-llm/ax/commit/2770a074adc883b55dfc655d3d46143dbf00c017))
* GEPA: enable optimizedProgram interface to mirror MiPRO ([#350](https://github.com/ax-llm/ax/issues/350)) ([9b1ae9a](https://github.com/ax-llm/ax/commit/9b1ae9a21c62ec913bad5dc38481a271e3facac2))
* unify GEPA and MiPRO interfaces for consistent optimization workflows ([7cf8e28](https://github.com/ax-llm/ax/commit/7cf8e289dbc38af57cb08e6e92b0ebbbcb2516bb))
## [14.0.24](https://github.com/ax-llm/ax/compare/14.0.23...14.0.24) (2025-09-13)

### Bug Fixes

* enhance error handling in AxGen class ([aa76a28](https://github.com/ax-llm/ax/commit/aa76a28d8a77b933acce9ef1a075ce5b5027d37a))

## [14.0.24](https://github.com/ax-llm/ax/compare/14.0.22...14.0.23) (2025-09-13)

### Bug Fixes

* enhance error handling in AxGen class ([aa76a28](https://github.com/ax-llm/ax/commit/aa76a28d8a77b933acce9ef1a075ce5b5027d37a))
## [14.0.23](https://github.com/ax-llm/ax/compare/14.0.22...14.0.23) (2025-09-12)

### Features

* update fluent API to remove nested helper functions and enhance type inference ([15250f2](https://github.com/ax-llm/ax/commit/15250f26aa5dc9f6acb6648e0f4a8ba0d9f206ed))

## [14.0.23](https://github.com/ax-llm/ax/compare/14.0.21...14.0.22) (2025-09-12)

### Features

* update fluent API to remove nested helper functions and enhance type inference ([15250f2](https://github.com/ax-llm/ax/commit/15250f26aa5dc9f6acb6648e0f4a8ba0d9f206ed))
## [14.0.22](https://github.com/ax-llm/ax/compare/14.0.21...14.0.22) (2025-09-12)

### Bug Fixes

* refactor MCP transport imports and update documentation ([ee4d976](https://github.com/ax-llm/ax/commit/ee4d976c2ac3a71f197978379e741a8fc5dae585))

## [14.0.22](https://github.com/ax-llm/ax/compare/14.0.20...14.0.21) (2025-09-12)

### Bug Fixes

* refactor MCP transport imports and update documentation ([ee4d976](https://github.com/ax-llm/ax/commit/ee4d976c2ac3a71f197978379e741a8fc5dae585))
## [14.0.21](https://github.com/ax-llm/ax/compare/14.0.20...14.0.21) (2025-09-11)

### ⚠ BREAKING CHANGES

* **gepa:** compile now throws if `options.maxMetricCalls` is absent or non-positive.

* fix(gepa): only skip reflective after an evaluated merge attempt\n\nAlign single-module merge gating with the reference engine so reflective mutation is skipped only when a merge is actually attempted, improving behavioral parity and avoiding lost reflective iterations when no valid merge pair exists.

* docs(optimize): migrate multi-objective docs to GEPA/GEPA-Flow using compile (remove compilePareto)

### Features

* enhance AxExamples utility and improve fluent API type inference ([45897fc](https://github.com/ax-llm/ax/commit/45897fc19404197a01c91ba7b7aaa9c54c1e03cc))
* **gepa:** GEPA/GEPA-Flow Pareto optimizers + docs alignment ([#341](https://github.com/ax-llm/ax/issues/341)) ([f61c18a](https://github.com/ax-llm/ax/commit/f61c18a9b11a6e36f783f6937c0e9104cf168c1f))
* **mcp:** OAuth 2.1 for HTTP/SSE transports + Notion OAuth examples ([#340](https://github.com/ax-llm/ax/issues/340)) ([4f8c922](https://github.com/ax-llm/ax/commit/4f8c922627ad6d973c42615d8eb0d7f9e7a649d1))

### Bug Fixes

* enhance memory tag validation and retry logic in tests ([adecf29](https://github.com/ax-llm/ax/commit/adecf29904f8df5d634f6eedbca1ad7c6927e56f))
* improve code formatting and cleanup in tests and base AI implementation ([eba5f39](https://github.com/ax-llm/ax/commit/eba5f393f1c397dba7848992fefa8157e8cd3531))
* improve token budget handling and update model references ([6868de6](https://github.com/ax-llm/ax/commit/6868de61805bd42d8c04f39a65edd72363a29cad))
* streamline memory tag management and improve test coverage ([870ebe2](https://github.com/ax-llm/ax/commit/870ebe2b4e7ef604fb8976acfe9d5cd41ac6ec62))
* update AxMultiMetricFn type definition and clean up imports ([06c3960](https://github.com/ax-llm/ax/commit/06c3960fc86a3f27d92e65e6ff4bba21242a7102))
* update typedef to support async version ([#294](https://github.com/ax-llm/ax/issues/294)) ([45f07a2](https://github.com/ax-llm/ax/commit/45f07a2ec32255fe1f9adb888358aa11ffad354a))

## [14.0.21](https://github.com/ax-llm/ax/compare/14.0.19...14.0.20) (2025-09-11)

### ⚠ BREAKING CHANGES

* **gepa:** compile now throws if `options.maxMetricCalls` is absent or non-positive.

* fix(gepa): only skip reflective after an evaluated merge attempt\n\nAlign single-module merge gating with the reference engine so reflective mutation is skipped only when a merge is actually attempted, improving behavioral parity and avoiding lost reflective iterations when no valid merge pair exists.

* docs(optimize): migrate multi-objective docs to GEPA/GEPA-Flow using compile (remove compilePareto)

### Features

* enhance AxExamples utility and improve fluent API type inference ([45897fc](https://github.com/ax-llm/ax/commit/45897fc19404197a01c91ba7b7aaa9c54c1e03cc))
* **gepa:** GEPA/GEPA-Flow Pareto optimizers + docs alignment ([#341](https://github.com/ax-llm/ax/issues/341)) ([f61c18a](https://github.com/ax-llm/ax/commit/f61c18a9b11a6e36f783f6937c0e9104cf168c1f))
* **mcp:** OAuth 2.1 for HTTP/SSE transports + Notion OAuth examples ([#340](https://github.com/ax-llm/ax/issues/340)) ([4f8c922](https://github.com/ax-llm/ax/commit/4f8c922627ad6d973c42615d8eb0d7f9e7a649d1))

### Bug Fixes

* enhance memory tag validation and retry logic in tests ([adecf29](https://github.com/ax-llm/ax/commit/adecf29904f8df5d634f6eedbca1ad7c6927e56f))
* improve code formatting and cleanup in tests and base AI implementation ([eba5f39](https://github.com/ax-llm/ax/commit/eba5f393f1c397dba7848992fefa8157e8cd3531))
* improve token budget handling and update model references ([6868de6](https://github.com/ax-llm/ax/commit/6868de61805bd42d8c04f39a65edd72363a29cad))
* streamline memory tag management and improve test coverage ([870ebe2](https://github.com/ax-llm/ax/commit/870ebe2b4e7ef604fb8976acfe9d5cd41ac6ec62))
* update AxMultiMetricFn type definition and clean up imports ([06c3960](https://github.com/ax-llm/ax/commit/06c3960fc86a3f27d92e65e6ff4bba21242a7102))
* update typedef to support async version ([#294](https://github.com/ax-llm/ax/issues/294)) ([45f07a2](https://github.com/ax-llm/ax/commit/45f07a2ec32255fe1f9adb888358aa11ffad354a))
## [14.0.20](https://github.com/ax-llm/ax/compare/14.0.19...14.0.20) (2025-09-02)

## [14.0.20](https://github.com/ax-llm/ax/compare/14.0.18...14.0.19) (2025-09-02)
## [14.0.19](https://github.com/ax-llm/ax/compare/14.0.18...14.0.19) (2025-08-29)

### Bug Fixes

* bind provider implementation methods to preserve context ([86c92e4](https://github.com/ax-llm/ax/commit/86c92e4f536cd85371ef45bd15b5f6209072adaf))

## [14.0.19](https://github.com/ax-llm/ax/compare/14.0.17...14.0.18) (2025-08-29)

### Bug Fixes

* bind provider implementation methods to preserve context ([86c92e4](https://github.com/ax-llm/ax/commit/86c92e4f536cd85371ef45bd15b5f6209072adaf))
## [14.0.18](https://github.com/ax-llm/ax/compare/14.0.17...14.0.18) (2025-08-28)

## [14.0.18](https://github.com/ax-llm/ax/compare/14.0.16...14.0.17) (2025-08-28)
## [14.0.17](https://github.com/ax-llm/ax/compare/14.0.16...14.0.17) (2025-08-28)

### Features

* introduce AxStopFunctionCallException and enhance function call handling ([71e8e63](https://github.com/ax-llm/ax/commit/71e8e633f0f1a009b86552a3046967221ae29038))

### Bug Fixes

* refine field extraction logic and update test cases ([d9d9836](https://github.com/ax-llm/ax/commit/d9d983666a658b9d21b33757a063b5389296d512))

## [14.0.17](https://github.com/ax-llm/ax/compare/14.0.15...14.0.16) (2025-08-28)

### Features

* introduce AxStopFunctionCallException and enhance function call handling ([71e8e63](https://github.com/ax-llm/ax/commit/71e8e633f0f1a009b86552a3046967221ae29038))

### Bug Fixes

* refine field extraction logic and update test cases ([d9d9836](https://github.com/ax-llm/ax/commit/d9d983666a658b9d21b33757a063b5389296d512))
## [14.0.16](https://github.com/ax-llm/ax/compare/14.0.15...14.0.16) (2025-08-13)

### Bug Fixes

* enhance debug parameter handling in response processing ([0d36063](https://github.com/ax-llm/ax/commit/0d36063386241dc5626dc96a8c2179e0f5721f4c))

## [14.0.16](https://github.com/ax-llm/ax/compare/14.0.14...14.0.15) (2025-08-13)

### Bug Fixes

* enhance debug parameter handling in response processing ([0d36063](https://github.com/ax-llm/ax/commit/0d36063386241dc5626dc96a8c2179e0f5721f4c))
## [14.0.15](https://github.com/ax-llm/ax/compare/14.0.14...14.0.15) (2025-08-13)

### Features

* add comprehensive documentation for AI providers, DSPy signatures, and AxFlow ([09c324a](https://github.com/ax-llm/ax/commit/09c324a26d91c87fed66ae5910a4b2e265028e64))
* enhance documentation with new Examples Guide and improved links ([e39300b](https://github.com/ax-llm/ax/commit/e39300be36efa59267a98508cfde51c9ab5022a0))
* enhance logging functionality with ChatResponseCitations support ([ec87e3a](https://github.com/ax-llm/ax/commit/ec87e3a5af7e17293ccd0528c57220d464ca5c73))

## [14.0.15](https://github.com/ax-llm/ax/compare/14.0.13...14.0.14) (2025-08-13)

### Features

* add comprehensive documentation for AI providers, DSPy signatures, and AxFlow ([09c324a](https://github.com/ax-llm/ax/commit/09c324a26d91c87fed66ae5910a4b2e265028e64))
* enhance documentation with new Examples Guide and improved links ([e39300b](https://github.com/ax-llm/ax/commit/e39300be36efa59267a98508cfde51c9ab5022a0))
* enhance logging functionality with ChatResponseCitations support ([ec87e3a](https://github.com/ax-llm/ax/commit/ec87e3a5af7e17293ccd0528c57220d464ca5c73))
## [14.0.14](https://github.com/ax-llm/ax/compare/14.0.13...14.0.14) (2025-08-12)

### Features

* add comprehensive API and Quick Start documentation ([4fbbf45](https://github.com/ax-llm/ax/commit/4fbbf452c5e0736ceb5a598d2d46a97c36eee7f1))
