// Code in this file wires the template sources under templates/ to the
// identifiers the emitters use. Template content lives in real files so
// it can be edited with normal tooling; go:embed keeps the bytes exact.
package axir

import _ "embed"

// templates/cpp

//go:embed templates/cpp/cppConformance.cpp
var cppConformance string

//go:embed templates/cpp/cppHeader.hpp
var cppHeader string

//go:embed templates/cpp/cppRuntime.cpp
var cppRuntime string

// templates/go

//go:embed templates/go/goAudioResponsesMappingExample.go.txt
var goAudioResponsesMappingExample string

//go:embed templates/go/goAudioHTTPRoundtripExample.go.txt
var goAudioHTTPRoundtripExample string

//go:embed templates/go/goAxFlowOpenAIExample.go.txt
var goAxFlowOpenAIExample string

//go:embed templates/go/goAxFlowProgramGraphExample.go.txt
var goAxFlowProgramGraphExample string

//go:embed templates/go/goAxGenOpenAIExample.go.txt
var goAxGenOpenAIExample string

//go:embed templates/go/goAxGenScriptedClientToolExample.go.txt
var goAxGenScriptedClientToolExample string

//go:embed templates/go/goConformance.go.txt
var goConformance string

//go:embed templates/go/goMod.mod
var goMod string

//go:embed templates/go/goOptimizerArtifactExample.go.txt
var goOptimizerArtifactExample string

//go:embed templates/go/goProviderMappingNoKeyExample.go.txt
var goProviderMappingNoKeyExample string

//go:embed templates/go/goProviderStreamNoKeyExample.go.txt
var goProviderStreamNoKeyExample string

//go:embed templates/go/goRealtimeAudioEventsExample.go.txt
var goRealtimeAudioEventsExample string

//go:embed templates/go/goRealtimeAudioTurnExample.go.txt
var goRealtimeAudioTurnExample string

//go:embed templates/go/goRuntime.go.txt
var goRuntime string

//go:embed templates/go/goRuntimeAdapterExample.go.txt
var goRuntimeAdapterExample string

//go:embed templates/go/goRuntimeProtocolExample.go.txt
var goRuntimeProtocolExample string

//go:embed templates/go/goSignatureSchemaExample.go.txt
var goSignatureSchemaExample string

//go:embed templates/go/goSum.sum
var goSum string

// templates/goja

//go:embed templates/goja/goGojaRuntime.go.txt
var goGojaRuntime string

//go:embed templates/goja/goJavaScriptGojaProfileExample.go.txt
var goJavaScriptGojaProfileExample string

// templates/java

//go:embed templates/java/javaAiClient.java
var javaAiClient string

//go:embed templates/java/javaAnthropic.java
var javaAnthropic string

//go:embed templates/java/javaAx.java
var javaAx string

//go:embed templates/java/javaAxAIService.java
var javaAxAIService string

//go:embed templates/java/javaAxAIServiceError.java
var javaAxAIServiceError string

//go:embed templates/java/javaAxAgent.java
var javaAxAgent string

//go:embed templates/java/javaAxAgentClarificationException.java
var javaAxAgentClarificationException string

//go:embed templates/java/javaAxBalancer.java
var javaAxBalancer string

//go:embed templates/java/javaAxBaseAI.java
var javaAxBaseAI string

//go:embed templates/java/javaAxBootstrapFewShot.java
var javaAxBootstrapFewShot string

//go:embed templates/java/javaAxCodeRuntime.java
var javaAxCodeRuntime string

//go:embed templates/java/javaAxCodeSession.java
var javaAxCodeSession string

//go:embed templates/java/javaAxFlow.java
var javaAxFlow string

//go:embed templates/java/javaAxGEPA.java
var javaAxGEPA string

//go:embed templates/java/javaAxGen.java
var javaAxGen string

//go:embed templates/java/javaAxMemory.java
var javaAxMemory string

//go:embed templates/java/javaAxMultiServiceRouter.java
var javaAxMultiServiceRouter string

//go:embed templates/java/javaAxProgram.java
var javaAxProgram string

//go:embed templates/java/javaAxProviderRouter.java
var javaAxProviderRouter string

//go:embed templates/java/javaAzureOpenAI.java
var javaAzureOpenAI string

//go:embed templates/java/javaCohere.java
var javaCohere string

//go:embed templates/java/javaConformance.java
var javaConformance string

//go:embed templates/java/javaCore.java
var javaCore string

//go:embed templates/java/javaDeepSeek.java
var javaDeepSeek string

//go:embed templates/java/javaField.java
var javaField string

//go:embed templates/java/javaFieldType.java
var javaFieldType string

//go:embed templates/java/javaGoogleGemini.java
var javaGoogleGemini string

//go:embed templates/java/javaGrok.java
var javaGrok string

//go:embed templates/java/javaJson.java
var javaJson string

//go:embed templates/java/javaMistral.java
var javaMistral string

//go:embed templates/java/javaOpenAI.java
var javaOpenAI string

//go:embed templates/java/javaOpenAIResponses.java
var javaOpenAIResponses string

//go:embed templates/java/javaOptimizerEngine.java
var javaOptimizerEngine string

//go:embed templates/java/javaOptimizerEvaluator.java
var javaOptimizerEvaluator string

//go:embed templates/java/javaPromptTemplate.java
var javaPromptTemplate string

//go:embed templates/java/javaReka.java
var javaReka string

//go:embed templates/java/javaSignature.java
var javaSignature string

//go:embed templates/java/javaTool.java
var javaTool string

// templates/mcp

//go:embed templates/mcp/cppMCPHeader.hpp
var cppMCPHeader string

//go:embed templates/mcp/cppMCPScriptedToolsExample.cpp
var cppMCPScriptedToolsExample string

//go:embed templates/mcp/cppMCPSource.cpp
var cppMCPSource string

//go:embed templates/mcp/goMCP.go.txt
var goMCP string

//go:embed templates/mcp/goMCPScriptedToolsExample.go.txt
var goMCPScriptedToolsExample string

//go:embed templates/mcp/javaAxMCPClient.java
var javaAxMCPClient string

//go:embed templates/mcp/javaAxMCPOAuthOptions.java
var javaAxMCPOAuthOptions string

//go:embed templates/mcp/javaAxMCPScriptedTransport.java
var javaAxMCPScriptedTransport string

//go:embed templates/mcp/javaAxMCPStdioTransport.java
var javaAxMCPStdioTransport string

//go:embed templates/mcp/javaAxMCPStreamableHTTPTransport.java
var javaAxMCPStreamableHTTPTransport string

//go:embed templates/mcp/javaAxMCPTokenSet.java
var javaAxMCPTokenSet string

//go:embed templates/mcp/javaAxMCPTransport.java
var javaAxMCPTransport string

//go:embed templates/mcp/javaMCPScriptedToolsExample.java
var javaMCPScriptedToolsExample string

//go:embed templates/mcp/pyMCP.py
var pyMCP string

//go:embed templates/mcp/pyMCPScriptedToolsExample.txt
var pyMCPScriptedToolsExample string

//go:embed templates/mcp/rustMCP.rs
var rustMCP string

//go:embed templates/mcp/rustMCPScriptedToolsExample.rs
var rustMCPScriptedToolsExample string

// templates/package

//go:embed templates/package/cppCMakeConfig.cmake
var cppCMakeConfig string

//go:embed templates/package/cppCMakeLists.cmake
var cppCMakeLists string

//go:embed templates/package/javaBuildGradle.gradle
var javaBuildGradle string

//go:embed templates/package/javaPomXML.xml
var javaPomXML string

//go:embed templates/package/javaSettingsGradle.gradle
var javaSettingsGradle string

//go:embed templates/package/pyManifestIn.txt
var pyManifestIn string

//go:embed templates/package/licenseApache.txt
var packageLicenseText string

//go:embed templates/package/pyProjectToml.toml
var pyProjectToml string

// templates/pyodide

//go:embed templates/pyodide/cppPythonPyodideProfileExample.cpp
var cppPythonPyodideProfileExample string

//go:embed templates/pyodide/javaPythonPyodideProfileExample.java
var javaPythonPyodideProfileExample string

//go:embed templates/pyodide/pyPythonPyodideProfileExample.py
var pyPythonPyodideProfileExample string

//go:embed templates/pyodide/pyodidePackageJSON.json
var pyodidePackageJSON string

//go:embed templates/pyodide/pyodideProfileReadme.md
var pyodideProfileReadme string

//go:embed templates/pyodide/pyodideRuntimeHelper.sh
var pyodideRuntimeHelper string

//go:embed templates/pyodide/pyodideRuntimePolicyJSON.json
var pyodideRuntimePolicyJSON string

// templates/python

//go:embed templates/python/pyAI.py
var pyAI string

//go:embed templates/python/pyAgent.py
var pyAgent string

//go:embed templates/python/pyConformance.py
var pyConformance string

//go:embed templates/python/pyFlow.py
var pyFlow string

//go:embed templates/python/pyGen.py
var pyGen string

//go:embed templates/python/pyInit.py
var pyInit string

//go:embed templates/python/pyOpenAIProvider.py
var pyOpenAIProvider string

//go:embed templates/python/pyPrompt.py
var pyPrompt string

//go:embed templates/python/pyProvidersInit.py
var pyProvidersInit string

//go:embed templates/python/pySchema.py
var pySchema string

//go:embed templates/python/pySignature.py
var pySignature string

//go:embed templates/python/pyTool.py
var pyTool string

// templates/quickjs

//go:embed templates/quickjs/cppJavaScriptQuickJSProfileExample.cpp
var cppJavaScriptQuickJSProfileExample string

//go:embed templates/quickjs/cppQuickJSProfileReadme.md
var cppQuickJSProfileReadme string

//go:embed templates/quickjs/cppQuickJSRuntimeHeader.hpp
var cppQuickJSRuntimeHeader string

//go:embed templates/quickjs/cppQuickJSRuntimeSource.cpp
var cppQuickJSRuntimeSource string

//go:embed templates/quickjs/javaJavaScriptQuickJSProfileExample.java
var javaJavaScriptQuickJSProfileExample string

//go:embed templates/quickjs/javaQuickJSClasspathHelper.sh
var javaQuickJSClasspathHelper string

//go:embed templates/quickjs/javaQuickJSCodeRuntime.java
var javaQuickJSCodeRuntime string

//go:embed templates/quickjs/javaQuickJSCodeSession.java
var javaQuickJSCodeSession string

//go:embed templates/quickjs/javaQuickJSHostCallable.java
var javaQuickJSHostCallable string

//go:embed templates/quickjs/javaQuickJSProfileGradle.gradle
var javaQuickJSProfileGradle string

//go:embed templates/quickjs/javaQuickJSProfilePom.xml
var javaQuickJSProfilePom string

//go:embed templates/quickjs/javaQuickJSProfileReadme.md
var javaQuickJSProfileReadme string

//go:embed templates/quickjs/javaQuickJSProtocolServer.java
var javaQuickJSProtocolServer string

//go:embed templates/quickjs/pyJavaScriptQuickJSProfilePythonExample.py
var pyJavaScriptQuickJSProfilePythonExample string

//go:embed templates/quickjs/quickJSRuntimePolicyJSON.json
var quickJSRuntimePolicyJSON string

// templates/runtime

//go:embed templates/runtime/javaAxProcessCodeRuntime.java
var javaAxProcessCodeRuntime string

//go:embed templates/runtime/javaAxProcessCodeSession.java
var javaAxProcessCodeSession string

//go:embed templates/runtime/javaAxRuntimeCapabilities.java
var javaAxRuntimeCapabilities string

//go:embed templates/runtime/javaAxRuntimeEnvelope.java
var javaAxRuntimeEnvelope string

//go:embed templates/runtime/pyRuntime.py
var pyRuntime string

//go:embed templates/runtime/pyRuntimeQuickjs.py
var pyRuntimeQuickjs string

// templates/rust

//go:embed templates/rust/rustAudioResponsesMappingExample.rs
var rustAudioResponsesMappingExample string

//go:embed templates/rust/rustAudioHTTPRoundtripExample.rs
var rustAudioHTTPRoundtripExample string

//go:embed templates/rust/rustAxFlowOpenAIExample.rs
var rustAxFlowOpenAIExample string

//go:embed templates/rust/rustAxFlowProgramGraphExample.rs
var rustAxFlowProgramGraphExample string

//go:embed templates/rust/rustAxGenOpenAIExample.rs
var rustAxGenOpenAIExample string

//go:embed templates/rust/rustAxGenScriptedClientToolExample.rs
var rustAxGenScriptedClientToolExample string

//go:embed templates/rust/rustCargoToml.toml
var rustCargoToml string

//go:embed templates/rust/rustConformanceMain.rs
var rustConformanceMain string

//go:embed templates/rust/rustGEPALocalOptimizerExample.rs
var rustGEPALocalOptimizerExample string

//go:embed templates/rust/rustLib.rs
var rustLib string

//go:embed templates/rust/rustOptimizerArtifactExample.rs
var rustOptimizerArtifactExample string

//go:embed templates/rust/rustProviderMappingNoKeyExample.rs
var rustProviderMappingNoKeyExample string

//go:embed templates/rust/rustProviderStreamNoKeyExample.rs
var rustProviderStreamNoKeyExample string

//go:embed templates/rust/rustRealtimeAudioEventsExample.rs
var rustRealtimeAudioEventsExample string

//go:embed templates/rust/rustRuntimeAdapterExample.rs
var rustRuntimeAdapterExample string

//go:embed templates/rust/rustRuntimeProtocolExample.rs
var rustRuntimeProtocolExample string

//go:embed templates/rust/rustSignatureSchemaExample.rs
var rustSignatureSchemaExample string

// templates/rust_quickjs

//go:embed templates/rust_quickjs/rustJavaScriptQuickJSProfileExample.rs
var rustJavaScriptQuickJSProfileExample string

//go:embed templates/rust_quickjs/rustQuickJSRuntime.rs
var rustQuickJSRuntime string

//go:embed templates/rust_quickjs/rustRuntimeProfilesReadme.md
var rustRuntimeProfilesReadme string
