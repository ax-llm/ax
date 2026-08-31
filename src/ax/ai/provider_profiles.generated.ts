// Generated from ir/axcore/data/provider-profiles.json. Do not edit.
// biome-ignore format: generated file
export const axAIProviderProfiles = {
  "openai": {
    "id": "openai",
    "name": "OpenAI",
    "aliases": [
      "openai"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.openai.com/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": "gpt-5-mini",
      "embedModel": "text-embedding-3-small"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": true,
      "multiTurn": true,
      "images": true,
      "audio": true,
      "audioOutput": true,
      "structuredOutputModes": [
        "native",
        "function",
        "json_object"
      ],
      "serviceTiers": [
        "standard",
        "flex",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      },
      "embed": {
        "path": "/embeddings",
        "dialect": "openai-embeddings"
      },
      "transcribe": {
        "path": "/audio/transcriptions",
        "dialect": "openai-transcription"
      },
      "speak": {
        "path": "/audio/speech",
        "dialect": "openai-speech"
      },
      "realtime": {
        "path": "/realtime",
        "dialect": "openai-realtime",
        "modelMatch": {
          "prefix": [
            "gpt-realtime"
          ]
        },
        "url": "wss://api.openai.com/v1/realtime",
        "grammar": "openai_realtime_compatible",
        "audio": {
          "input": {
            "formats": [
              "pcm16",
              "pcm"
            ],
            "sampleRate": 24000
          },
          "output": {
            "formats": [
              "pcm16",
              "pcm"
            ],
            "sampleRate": 24000,
            "voices": [
              "alloy",
              "ash",
              "ballad",
              "coral",
              "echo",
              "sage",
              "shimmer",
              "verse"
            ],
            "defaultVoice": "alloy"
          }
        },
        "validation": {
          "structuredOutputWithAudio": false
        }
      }
    },
    "modelRules": [],
    "sources": [
      "https://platform.openai.com/docs/api-reference/chat"
    ],
    "reviewedAt": "2026-08-17",
    "request": {
      "serviceTierMap": {
        "auto": "auto",
        "standard": "default",
        "flex": "flex",
        "priority": "priority"
      }
    }
  },
  "openai-compatible": {
    "id": "openai-compatible",
    "name": "OpenAI Compatible",
    "aliases": [
      "openai-compatible",
      "openai_compatible",
      "compatible"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      },
      "embed": {
        "path": "/embeddings",
        "dialect": "openai-embeddings"
      }
    },
    "modelRules": [],
    "sources": [
      "https://platform.openai.com/docs/api-reference/chat"
    ],
    "reviewedAt": "2026-08-17"
  },
  "openai-responses": {
    "id": "openai-responses",
    "name": "OpenAI Responses",
    "aliases": [
      "openai-responses",
      "openai_responses",
      "responses"
    ],
    "transport": "openai-responses",
    "baseURL": "https://api.openai.com/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": "gpt-5-mini",
      "embedModel": "text-embedding-3-small"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": true,
      "multiTurn": true,
      "images": true,
      "audio": true,
      "audioOutput": true,
      "structuredOutputModes": [
        "native",
        "function",
        "json_object"
      ],
      "serviceTiers": [
        "standard",
        "flex",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/responses",
        "dialect": "openai-responses"
      },
      "embed": {
        "path": "/embeddings",
        "dialect": "openai-embeddings"
      },
      "transcribe": {
        "path": "/audio/transcriptions",
        "dialect": "openai-transcription"
      },
      "speak": {
        "path": "/audio/speech",
        "dialect": "openai-speech"
      },
      "realtime": {
        "path": "/realtime",
        "dialect": "openai-realtime",
        "modelMatch": {
          "prefix": [
            "gpt-realtime"
          ]
        },
        "url": "wss://api.openai.com/v1/realtime",
        "grammar": "openai_realtime_compatible",
        "audio": {
          "input": {
            "formats": [
              "pcm16",
              "pcm"
            ],
            "sampleRate": 24000
          },
          "output": {
            "formats": [
              "pcm16",
              "pcm"
            ],
            "sampleRate": 24000,
            "voices": [
              "alloy",
              "ash",
              "ballad",
              "coral",
              "echo",
              "sage",
              "shimmer",
              "verse"
            ],
            "defaultVoice": "alloy"
          }
        },
        "validation": {
          "structuredOutputWithAudio": false
        }
      }
    },
    "modelRules": [],
    "sources": [
      "https://platform.openai.com/docs/api-reference/responses"
    ],
    "reviewedAt": "2026-08-17",
    "request": {
      "serviceTierMap": {
        "auto": "auto",
        "standard": "default",
        "flex": "flex",
        "priority": "priority"
      }
    }
  },
  "anthropic": {
    "id": "anthropic",
    "name": "Anthropic",
    "aliases": [
      "anthropic",
      "claude"
    ],
    "transport": "anthropic-messages",
    "baseURL": "https://api.anthropic.com",
    "requiresApiURL": false,
    "auth": {
      "type": "x-api-key",
      "required": true
    },
    "headers": {
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "structured-outputs-2025-11-13, web-search-2025-03-05"
    },
    "defaults": {
      "model": "claude-sonnet-4-5"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": true,
      "multiTurn": true,
      "images": true,
      "caching": {
        "types": [
          "ephemeral"
        ],
        "cacheBreakpoints": true
      },
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/v1/messages",
        "dialect": "anthropic-messages"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.anthropic.com/en/api/messages"
    ],
    "reviewedAt": "2026-08-17"
  },
  "google-gemini": {
    "id": "google-gemini",
    "name": "Google Gemini",
    "aliases": [
      "google-gemini",
      "google_gemini",
      "gemini"
    ],
    "transport": "gemini-generate-content",
    "baseURL": "https://generativelanguage.googleapis.com/v1beta",
    "requiresApiURL": false,
    "auth": {
      "type": "api-key-header",
      "header": "x-goog-api-key",
      "required": true
    },
    "defaults": {
      "model": "gemini-3.5-flash",
      "embedModel": "gemini-embedding-2"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": true,
      "multiTurn": true,
      "images": true,
      "audio": true,
      "audioOutput": true,
      "files": {
        "uploadMethod": "cloud"
      },
      "caching": {
        "types": [
          "persistent"
        ]
      },
      "structuredOutputModes": [
        "native",
        "function"
      ],
      "serviceTiers": [
        "standard",
        "flex",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/models/{model}:generateContent",
        "dialect": "gemini-generate-content"
      },
      "stream_chat": {
        "path": "/models/{model}:streamGenerateContent?alt=sse",
        "dialect": "gemini-generate-content"
      },
      "embed": {
        "path": "/models/{model}:batchEmbedContents",
        "dialect": "gemini-generate-content"
      },
      "transcribe": {
        "path": "/models/{model}:generateContent",
        "dialect": "gemini-generate-content"
      },
      "speak": {
        "path": "/models/{model}:generateContent",
        "dialect": "gemini-generate-content"
      },
      "realtime": {
        "path": "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
        "dialect": "gemini-live-bidi",
        "modelMatch": {
          "prefix": [
            "gemini-live"
          ],
          "contains": [
            "native-audio",
            "-live-"
          ]
        },
        "url": "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
        "grammar": "gemini_live_bidi",
        "defaultModel": "gemini-2.5-flash-native-audio-preview-12-2025",
        "audio": {
          "input": {
            "formats": [
              "pcm16",
              "pcm"
            ],
            "sampleRate": 16000
          },
          "output": {
            "formats": [
              "pcm16",
              "pcm"
            ],
            "sampleRate": 24000,
            "voices": [
              "Kore",
              "Puck",
              "Charon",
              "Fenrir",
              "Aoede"
            ],
            "defaultVoice": "Kore"
          }
        },
        "validation": {
          "pcmInputOnly": true,
          "rejectStructuredOutputWithAudio": true
        }
      }
    },
    "modelRules": [],
    "sources": [
      "https://ai.google.dev/api/generate-content",
      "https://ai.google.dev/gemini-api/docs/optimization"
    ],
    "reviewedAt": "2026-08-17",
    "request": {
      "serviceTierMap": {
        "auto": null,
        "standard": "standard",
        "flex": "flex",
        "priority": "priority"
      }
    }
  },
  "webllm": {
    "id": "webllm",
    "name": "WebLLM",
    "aliases": [
      "webllm"
    ],
    "transport": "webllm",
    "baseURL": null,
    "requiresApiURL": false,
    "auth": {
      "type": "none",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "",
        "dialect": "webllm"
      }
    },
    "modelRules": [],
    "sources": [
      "https://webllm.mlc.ai/docs/"
    ],
    "reviewedAt": "2026-08-17"
  },
  "azure-openai": {
    "id": "azure-openai",
    "name": "Azure OpenAI",
    "aliases": [
      "azure-openai",
      "azure_openai",
      "azure"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": false,
    "auth": {
      "type": "api-key-header",
      "header": "api-key",
      "required": true
    },
    "defaults": {
      "model": "gpt-5-mini",
      "embedModel": "text-embedding-3-small"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": true,
      "multiTurn": true,
      "images": true,
      "structuredOutputModes": [
        "native",
        "function"
      ],
      "serviceTiers": [
        "standard",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      },
      "embed": {
        "path": "/embeddings",
        "dialect": "openai-embeddings"
      }
    },
    "endpoint": {
      "scheme": "https",
      "hostField": "resourceName",
      "hostSuffix": ".openai.azure.com",
      "path": "/openai/deployments/{deploymentName}",
      "fields": {
        "resourceName": [
          "resource_name",
          "resourceName"
        ],
        "deploymentName": [
          "deployment_name",
          "deploymentName"
        ],
        "version": [
          "api_version",
          "apiVersion",
          "version"
        ]
      },
      "required": [
        "resourceName",
        "deploymentName"
      ],
      "defaults": {
        "version": "2024-02-15-preview"
      },
      "normalizers": {
        "version": "api-version"
      },
      "apiVersionField": "version"
    },
    "capabilityGates": {
      "structuredOutputs": {
        "option": "version",
        "min": "2024-08-01"
      }
    },
    "modelRules": [],
    "sources": [
      "https://learn.microsoft.com/en-us/azure/ai-services/openai/reference",
      "https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/priority-processing"
    ],
    "reviewedAt": "2026-08-17",
    "request": {
      "serviceTierMap": {
        "auto": "auto",
        "standard": "default",
        "flex": "flex",
        "priority": "priority"
      }
    }
  },
  "deepseek": {
    "id": "deepseek",
    "name": "DeepSeek",
    "aliases": [
      "deepseek"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.deepseek.com",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": "deepseek-v4-flash"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function",
        "json_object"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [
      {
        "match": {
          "exact": [
            "deepseek-v4-flash",
            "deepseek-v4-pro"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true,
          "showThoughts": true,
          "structuredOutputs": false,
          "structuredOutputModes": [
            "function"
          ]
        },
        "request": {
          "reasoning": "thinking-object",
          "toolChoice": "unforced",
          "effortMap": {
            "none": null,
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "highest": "max",
            "xhigh": "max",
            "max": "max"
          },
          "dropWhenThinking": [
            "temperature",
            "top_p",
            "presence_penalty",
            "frequency_penalty"
          ],
          "defaultThinkingLevel": "max"
        },
        "response": {
          "reasoningFields": [
            "reasoning_content",
            "reasoning"
          ]
        },
        "replay": {
          "assistantReasoningField": "reasoning_content"
        }
      },
      {
        "match": {
          "exact": [
            "deepseek-reasoner"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": false,
          "showThoughts": true,
          "structuredOutputs": false,
          "structuredOutputModes": [
            "function"
          ]
        },
        "request": {
          "toolChoice": "unforced"
        },
        "response": {
          "reasoningFields": [
            "reasoning_content",
            "reasoning"
          ]
        },
        "replay": {
          "assistantReasoningField": "reasoning_content"
        }
      }
    ],
    "sources": [
      "https://api-docs.deepseek.com/guides/thinking_mode/"
    ],
    "reviewedAt": "2026-08-18"
  },
  "deepseek-responses": {
    "id": "deepseek-responses",
    "name": "DeepSeek Responses",
    "aliases": [
      "deepseek-responses",
      "deepseek_responses"
    ],
    "transport": "openai-responses",
    "baseURL": "https://api.deepseek.com",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": "deepseek-v4-flash"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": true,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/responses",
        "dialect": "openai-responses"
      }
    },
    "request": {
      "dropFields": [
        "include",
        "previous_response_id",
        "store",
        "parallel_tool_calls"
      ],
      "reasoningObjectFields": [
        "effort"
      ]
    },
    "modelRules": [],
    "sources": [
      "https://api-docs.deepseek.com/api/create-chat-completion"
    ],
    "reviewedAt": "2026-08-17"
  },
  "mistral": {
    "id": "mistral",
    "name": "Mistral AI",
    "aliases": [
      "mistral"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.mistral.ai/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": "mistral-small-latest",
      "embedModel": "mistral-embed"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": false,
      "multiTurn": true,
      "images": true,
      "audio": true,
      "audioOutput": true,
      "structuredOutputModes": [
        "native",
        "function"
      ],
      "serviceTiers": [
        "standard",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      },
      "embed": {
        "path": "/embeddings",
        "dialect": "openai-embeddings"
      },
      "transcribe": {
        "path": "/audio/transcriptions",
        "dialect": "openai-transcription"
      },
      "speak": {
        "path": "/audio/speech",
        "dialect": "mistral-speech"
      }
    },
    "request": {
      "renameFields": {
        "max_completion_tokens": "max_tokens"
      },
      "imageURLShape": "object",
      "serviceTierMap": {
        "auto": "auto",
        "standard": "standard_only",
        "priority": "auto"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.mistral.ai/api/",
      "https://docs.mistral.ai/inference/priority-tier"
    ],
    "reviewedAt": "2026-08-17"
  },
  "cohere": {
    "id": "cohere",
    "name": "Cohere",
    "aliases": [
      "cohere"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.cohere.ai/compatibility/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": "command-r-plus",
      "embedModel": "embed-english-v3.0"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      },
      "embed": {
        "path": "/embeddings",
        "dialect": "openai-embeddings"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.cohere.com/reference/compatibility-api"
    ],
    "reviewedAt": "2026-08-17"
  },
  "grok": {
    "id": "grok",
    "name": "xAI Grok",
    "aliases": [
      "grok",
      "xai",
      "x-grok",
      "x_grok"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.x.ai/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": "grok-4.6"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": false,
      "multiTurn": true,
      "images": true,
      "audio": true,
      "audioOutput": true,
      "webSearch": true,
      "structuredOutputModes": [
        "native",
        "function"
      ],
      "serviceTiers": [
        "standard",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      },
      "transcribe": {
        "path": "/stt",
        "dialect": "xai-transcription"
      },
      "speak": {
        "path": "/tts",
        "dialect": "xai-speech"
      },
      "realtime": {
        "path": "/realtime",
        "dialect": "xai-realtime",
        "modelMatch": {
          "prefix": [
            "grok-voice"
          ]
        },
        "url": "wss://api.x.ai/v1/realtime",
        "grammar": "openai_realtime_compatible",
        "defaultModel": "grok-voice-think-fast-1.0",
        "audio": {
          "input": {
            "formats": [
              "pcm16",
              "pcm"
            ],
            "sampleRate": 24000
          },
          "output": {
            "formats": [
              "pcm16",
              "pcm"
            ],
            "sampleRate": 24000,
            "voices": [
              "eve",
              "ara",
              "rex",
              "sal",
              "leo"
            ],
            "defaultVoice": "eve"
          }
        },
        "validation": {
          "structuredOutputWithAudio": false
        }
      }
    },
    "request": {
      "optionDialect": "search-parameters",
      "serviceTierMap": {
        "auto": null,
        "standard": "default",
        "priority": "priority"
      }
    },
    "modelRules": [
      {
        "match": {
          "exact": [
            "grok-4.6"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true,
          "structuredOutputs": true,
          "structuredOutputModes": [
            "native",
            "function"
          ]
        },
        "request": {
          "reasoning": "effort",
          "defaultThinkingLevel": "max",
          "effortMap": {
            "none": null,
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "highest": "xhigh",
            "xhigh": "xhigh",
            "max": "xhigh"
          },
          "unsupportedThinkingLevels": {
            "none": "xAI Grok 4.6 reasoning cannot be disabled"
          },
          "dropFields": [
            "presence_penalty",
            "frequency_penalty",
            "stop"
          ]
        }
      },
      {
        "match": {
          "exact": [
            "grok-4.5",
            "grok-4.5-latest",
            "grok-build-latest"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true,
          "structuredOutputs": true,
          "structuredOutputModes": [
            "native",
            "function"
          ]
        },
        "request": {
          "reasoning": "effort",
          "defaultThinkingLevel": "max",
          "effortMap": {
            "none": null,
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "highest": "high",
            "xhigh": "high",
            "max": "high"
          },
          "unsupportedThinkingLevels": {
            "none": "xAI Grok 4.5 reasoning cannot be disabled"
          },
          "dropFields": [
            "presence_penalty",
            "frequency_penalty",
            "stop"
          ]
        }
      },
      {
        "match": {
          "exact": [
            "grok-4.3",
            "grok-4.3-latest",
            "grok-latest"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true,
          "showThoughts": true,
          "structuredOutputs": true,
          "structuredOutputModes": [
            "native",
            "function"
          ]
        },
        "request": {
          "reasoning": "effort",
          "defaultThinkingLevel": "max",
          "effortMap": {
            "none": "none",
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "highest": "high",
            "xhigh": "high",
            "max": "high"
          },
          "dropFields": [
            "presence_penalty",
            "frequency_penalty",
            "stop"
          ]
        }
      },
      {
        "match": {
          "exact": [
            "grok-3-mini",
            "grok-3-mini-latest",
            "grok-3-mini-beta",
            "grok-3-mini-fast",
            "grok-3-mini-fast-latest",
            "grok-3-mini-fast-beta"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true
        },
        "request": {
          "reasoning": "effort",
          "defaultThinkingLevel": "low",
          "effortMap": {
            "none": null,
            "minimal": "low",
            "low": "low",
            "medium": "high",
            "high": "high",
            "highest": "high",
            "xhigh": "high",
            "max": "high"
          },
          "unsupportedThinkingLevels": {
            "none": "xAI Grok 3 Mini reasoning cannot be disabled"
          }
        }
      }
    ],
    "sources": [
      "https://docs.x.ai/developers/model-capabilities/text/reasoning",
      "https://docs.x.ai/developers/rest-api-reference/management/auth",
      "https://docs.x.ai/developers/models/grok-4.5",
      "https://docs.x.ai/developers/advanced-api-usage/priority-processing"
    ],
    "reviewedAt": "2026-08-30"
  },
  "reka": {
    "id": "reka",
    "name": "Reka",
    "aliases": [
      "reka"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.reka.ai/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": "reka-core"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.reka.ai/"
    ],
    "reviewedAt": "2026-08-17"
  },
  "together": {
    "id": "together",
    "name": "Together AI",
    "aliases": [
      "together",
      "together-ai",
      "together_ai"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.together.xyz/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "native",
        "function",
        "json_object"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      },
      "embed": {
        "path": "/embeddings",
        "dialect": "openai-embeddings"
      }
    },
    "modelRules": [
      {
        "match": {
          "prefix": [
            "deepseek-ai/DeepSeek-V4"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true,
          "showThoughts": true,
          "structuredOutputs": false,
          "structuredOutputModes": [
            "function"
          ]
        },
        "request": {
          "reasoning": "effort",
          "toolChoice": "unforced",
          "effortMap": {
            "none": null,
            "minimal": "high",
            "low": "high",
            "medium": "high",
            "high": "max",
            "highest": "max",
            "xhigh": "max",
            "max": "max"
          },
          "defaultThinkingLevel": "max"
        },
        "response": {
          "reasoningFields": [
            "reasoning",
            "reasoning_content"
          ]
        },
        "replay": {
          "assistantReasoningField": "reasoning"
        }
      }
    ],
    "sources": [
      "https://docs.together.ai/docs/inference/chat/reasoning"
    ],
    "reviewedAt": "2026-08-18"
  },
  "openrouter": {
    "id": "openrouter",
    "name": "OpenRouter",
    "aliases": [
      "openrouter"
    ],
    "transport": "openai-chat",
    "baseURL": "https://openrouter.ai/api/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": [
        "standard",
        "flex",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [
      {
        "match": {
          "prefix": [
            "deepseek/"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true,
          "showThoughts": true,
          "structuredOutputs": false,
          "structuredOutputModes": [
            "function"
          ]
        },
        "request": {
          "reasoning": "openrouter",
          "toolChoice": "unforced",
          "effortMap": {
            "none": "none",
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "highest": "max",
            "xhigh": "xhigh",
            "max": "max"
          },
          "defaultThinkingLevel": "max"
        },
        "response": {
          "reasoningFields": [
            "reasoning",
            "reasoning_content"
          ],
          "reasoningDetailsFields": [
            "reasoning_details"
          ]
        },
        "replay": {
          "assistantReasoningField": "reasoning",
          "assistantReasoningDetailsField": "reasoning_details"
        }
      }
    ],
    "sources": [
      "https://openrouter.ai/docs/guides/best-practices/reasoning-tokens",
      "https://openrouter.ai/docs/guides/features/service-tiers"
    ],
    "reviewedAt": "2026-08-18",
    "request": {
      "serviceTierMap": {
        "auto": null,
        "standard": null,
        "flex": "flex",
        "priority": "priority"
      }
    }
  },
  "orcarouter": {
    "id": "orcarouter",
    "name": "OrcaRouter",
    "aliases": [
      "orcarouter"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.orcarouter.ai/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": "orcarouter/auto"
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://www.orcarouter.ai"
    ],
    "reviewedAt": "2026-08-19"
  },
  "fireworks": {
    "id": "fireworks",
    "name": "Fireworks AI",
    "aliases": [
      "fireworks",
      "fireworks-ai"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.fireworks.ai/inference/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "native",
        "function"
      ],
      "serviceTiers": [
        "standard",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      },
      "embed": {
        "path": "/embeddings",
        "dialect": "openai-embeddings"
      }
    },
    "modelRules": [
      {
        "match": {
          "contains": [
            "deepseek-v4"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true,
          "showThoughts": true,
          "structuredOutputs": false,
          "structuredOutputModes": [
            "function"
          ]
        },
        "request": {
          "reasoning": "effort",
          "toolChoice": "unforced",
          "effortMap": {
            "none": "none",
            "minimal": "high",
            "low": "high",
            "medium": "high",
            "high": "high",
            "highest": "max",
            "xhigh": "max",
            "max": "max"
          },
          "defaultThinkingLevel": "max"
        },
        "response": {
          "reasoningFields": [
            "reasoning_content",
            "reasoning"
          ]
        },
        "replay": {
          "assistantReasoningField": "reasoning_content"
        }
      }
    ],
    "sources": [
      "https://docs.fireworks.ai/api-reference/post-chatcompletions",
      "https://docs.fireworks.ai/guides/reasoning"
    ],
    "reviewedAt": "2026-08-18",
    "request": {
      "serviceTierMap": {
        "auto": null,
        "standard": "default",
        "priority": "priority"
      }
    }
  },
  "huggingface-router": {
    "id": "huggingface-router",
    "name": "Hugging Face Router",
    "aliases": [
      "huggingface-router",
      "huggingface",
      "hf-router"
    ],
    "transport": "openai-chat",
    "baseURL": "https://router.huggingface.co/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://huggingface.co/docs/inference-providers/en/index",
      "https://huggingface.co/docs/inference-providers/en/tasks/chat-completion"
    ],
    "reviewedAt": "2026-08-18"
  },
  "amazon-bedrock": {
    "id": "amazon-bedrock",
    "name": "Amazon Bedrock",
    "aliases": [
      "amazon-bedrock",
      "bedrock"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": [
        "standard",
        "flex",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html",
      "https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html"
    ],
    "reviewedAt": "2026-08-17",
    "request": {
      "serviceTierMap": {
        "auto": null,
        "standard": "default",
        "flex": "flex",
        "priority": "priority"
      }
    }
  },
  "azure-foundry": {
    "id": "azure-foundry",
    "name": "Azure AI Foundry",
    "aliases": [
      "azure-foundry",
      "azure-ai-foundry",
      "microsoft-foundry"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "api-key-header",
      "header": "api-key",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": [
        "standard",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat",
      "https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/priority-processing"
    ],
    "reviewedAt": "2026-08-17",
    "request": {
      "serviceTierMap": {
        "auto": "auto",
        "standard": "default",
        "flex": "flex",
        "priority": "priority"
      }
    }
  },
  "vertex-ai": {
    "id": "vertex-ai",
    "name": "Vertex AI OpenAI Compatibility",
    "aliases": [
      "vertex-ai",
      "vertex-openai"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [
      {
        "match": {
          "exact": [
            "google/gemma-4-26b-a4b-it-maas"
          ]
        },
        "capabilities": {
          "structuredOutputs": false,
          "structuredOutputModes": [
            "json_object",
            "function"
          ],
          "thinking": true
        },
        "request": {
          "defaultThinkingLevel": "max",
          "thinkingBoolean": {
            "path": [
              "chat_template_kwargs",
              "enable_thinking"
            ]
          }
        },
        "response": {
          "reasoningFields": [
            "reasoning_content"
          ]
        },
        "replay": {
          "assistantReasoningField": "reasoning_content"
        }
      },
      {
        "match": {
          "prefix": [
            "google/gemini-",
            "gemini-"
          ]
        },
        "capabilities": {
          "structuredOutputs": true,
          "structuredOutputModes": [
            "native",
            "function",
            "json_object"
          ]
        }
      }
    ],
    "sources": [
      "https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library",
      "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/capabilities/structured-output",
      "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/capabilities/thinking"
    ],
    "reviewedAt": "2026-08-18"
  },
  "databricks": {
    "id": "databricks",
    "name": "Databricks Model Serving",
    "aliases": [
      "databricks"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": [
        "standard",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.databricks.com/aws/en/machine-learning/model-serving/query-chat-models",
      "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/priority-mode"
    ],
    "reviewedAt": "2026-08-17",
    "request": {
      "serviceTierMap": {
        "auto": null,
        "standard": "default",
        "priority": "priority"
      }
    }
  },
  "baseten": {
    "id": "baseten",
    "name": "Baseten Model APIs",
    "aliases": [
      "baseten"
    ],
    "transport": "openai-chat",
    "baseURL": "https://inference.baseten.co/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "native",
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.baseten.co/inference/model-apis/overview"
    ],
    "reviewedAt": "2026-08-17"
  },
  "groq": {
    "id": "groq",
    "name": "Groq",
    "aliases": [
      "groq"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.groq.com/openai/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "native",
        "function"
      ],
      "serviceTiers": [
        "standard",
        "flex",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [
      {
        "match": {
          "exact": [
            "openai/gpt-oss-20b",
            "openai/gpt-oss-120b"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true
        },
        "request": {
          "reasoning": "effort",
          "defaultThinkingLevel": "max",
          "effortMap": {
            "none": null,
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "highest": "high",
            "xhigh": "high",
            "max": "high"
          },
          "unsupportedThinkingLevels": {
            "none": "Groq GPT-OSS reasoning does not support the none effort level"
          }
        }
      },
      {
        "match": {
          "exact": [
            "qwen/qwen3.6-27b"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true
        },
        "request": {
          "reasoning": "effort",
          "defaultThinkingLevel": "max",
          "effortMap": {
            "none": "none",
            "minimal": "default",
            "low": "default",
            "medium": "default",
            "high": "default",
            "highest": "default",
            "xhigh": "default",
            "max": "default"
          }
        }
      }
    ],
    "sources": [
      "https://console.groq.com/docs/reasoning",
      "https://console.groq.com/docs/api-reference",
      "https://console.groq.com/docs/service-tiers"
    ],
    "reviewedAt": "2026-08-18",
    "request": {
      "serviceTierMap": {
        "auto": "auto",
        "standard": "on_demand",
        "flex": "flex",
        "priority": "performance"
      }
    }
  },
  "cerebras": {
    "id": "cerebras",
    "name": "Cerebras Inference",
    "aliases": [
      "cerebras"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.cerebras.ai/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": true,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "native",
        "function"
      ],
      "serviceTiers": [
        "standard",
        "flex",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [
      {
        "match": {
          "exact": [
            "gpt-oss-120b"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true
        },
        "request": {
          "reasoning": "effort",
          "defaultThinkingLevel": "max",
          "effortMap": {
            "none": null,
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "highest": "high",
            "xhigh": "high",
            "max": "high"
          },
          "unsupportedThinkingLevels": {
            "none": "Cerebras GPT-OSS reasoning does not support the none effort level"
          }
        }
      },
      {
        "match": {
          "exact": [
            "gemma-4-31b"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true
        },
        "request": {
          "reasoning": "effort",
          "defaultThinkingLevel": "max",
          "effortMap": {
            "none": "none",
            "minimal": "high",
            "low": "high",
            "medium": "high",
            "high": "high",
            "highest": "high",
            "xhigh": "high",
            "max": "high"
          }
        }
      }
    ],
    "sources": [
      "https://inference-docs.cerebras.ai/capabilities/reasoning",
      "https://inference-docs.cerebras.ai/api-reference/chat-completions",
      "https://inference-docs.cerebras.ai/capabilities/service-tiers"
    ],
    "reviewedAt": "2026-08-18",
    "request": {
      "serviceTierMap": {
        "auto": "auto",
        "standard": "default",
        "flex": "flex",
        "priority": "priority"
      }
    }
  },
  "deepinfra": {
    "id": "deepinfra",
    "name": "DeepInfra",
    "aliases": [
      "deepinfra"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.deepinfra.com/v1/openai",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": [
        "standard",
        "priority"
      ]
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [
      {
        "match": {
          "prefix": [
            "deepseek-ai/DeepSeek-R1"
          ]
        },
        "capabilities": {
          "thinking": true,
          "thinkingBudget": true
        },
        "request": {
          "reasoning": "effort",
          "defaultThinkingLevel": "max",
          "effortMap": {
            "none": "none",
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "highest": "high",
            "xhigh": "high",
            "max": "high"
          }
        }
      }
    ],
    "sources": [
      "https://docs.deepinfra.com/chat/reasoning",
      "https://docs.deepinfra.com/api-reference/introduction",
      "https://docs.deepinfra.com/chat/overview"
    ],
    "reviewedAt": "2026-08-18",
    "request": {
      "serviceTierMap": {
        "auto": null,
        "standard": null,
        "priority": "priority"
      }
    }
  },
  "sambanova": {
    "id": "sambanova",
    "name": "SambaNova Cloud",
    "aliases": [
      "sambanova",
      "sambanova-cloud"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.sambanova.ai/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.sambanova.ai/docs/en/api-reference/overview"
    ],
    "reviewedAt": "2026-08-17"
  },
  "nebius": {
    "id": "nebius",
    "name": "Nebius AI Studio",
    "aliases": [
      "nebius"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.tokenfactory.nebius.com/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://api.studio.nebius.com/docs"
    ],
    "reviewedAt": "2026-08-17"
  },
  "novita": {
    "id": "novita",
    "name": "Novita AI",
    "aliases": [
      "novita",
      "novita-ai"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.novita.ai/v3/openai",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://novita.ai/docs/guides/llm-api"
    ],
    "reviewedAt": "2026-08-17"
  },
  "hyperbolic": {
    "id": "hyperbolic",
    "name": "Hyperbolic",
    "aliases": [
      "hyperbolic"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.hyperbolic.xyz/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.hyperbolic.xyz/docs/inference-api"
    ],
    "reviewedAt": "2026-08-17"
  },
  "siliconflow": {
    "id": "siliconflow",
    "name": "SiliconFlow",
    "aliases": [
      "siliconflow"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.siliconflow.com/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.siliconflow.com/en/userguide/quickstart"
    ],
    "reviewedAt": "2026-08-17"
  },
  "friendli": {
    "id": "friendli",
    "name": "FriendliAI",
    "aliases": [
      "friendli",
      "friendli-ai"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.friendli.ai/serverless/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://friendli.ai/docs/guides/tool-calling"
    ],
    "reviewedAt": "2026-08-17"
  },
  "cloudflare-workers-ai": {
    "id": "cloudflare-workers-ai",
    "name": "Cloudflare Workers AI",
    "aliases": [
      "cloudflare-workers-ai",
      "workers-ai"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/"
    ],
    "reviewedAt": "2026-08-17"
  },
  "featherless": {
    "id": "featherless",
    "name": "Featherless AI",
    "aliases": [
      "featherless",
      "featherless-ai"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.featherless.ai/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://featherless.ai/docs/quickstart-guide"
    ],
    "reviewedAt": "2026-08-17"
  },
  "nscale": {
    "id": "nscale",
    "name": "Nscale",
    "aliases": [
      "nscale"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.nscale.com/docs/use-cases/chat"
    ],
    "reviewedAt": "2026-08-17"
  },
  "ovhcloud": {
    "id": "ovhcloud",
    "name": "OVHcloud AI Endpoints",
    "aliases": [
      "ovhcloud",
      "ovh"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities"
    ],
    "reviewedAt": "2026-08-17"
  },
  "scaleway": {
    "id": "scaleway",
    "name": "Scaleway Generative APIs",
    "aliases": [
      "scaleway"
    ],
    "transport": "openai-chat",
    "baseURL": "https://api.scaleway.ai/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://www.scaleway.com/en/developers/api/generative-apis"
    ],
    "reviewedAt": "2026-08-17"
  },
  "nvidia-nim": {
    "id": "nvidia-nim",
    "name": "NVIDIA NIM",
    "aliases": [
      "nvidia-nim",
      "nim"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.nvidia.com/nim/large-language-models/latest/getting-started.html"
    ],
    "reviewedAt": "2026-08-17"
  },
  "runpod-vllm": {
    "id": "runpod-vllm",
    "name": "RunPod vLLM",
    "aliases": [
      "runpod-vllm",
      "runpod"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": true
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.runpod.io/serverless/vllm/openai-compatibility"
    ],
    "reviewedAt": "2026-08-17"
  },
  "sagemaker-vllm": {
    "id": "sagemaker-vllm",
    "name": "SageMaker vLLM",
    "aliases": [
      "sagemaker-vllm",
      "sagemaker"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.aws.amazon.com/sagemaker/latest/dg/realtime-endpoints-openai-compatible.html"
    ],
    "reviewedAt": "2026-08-17"
  },
  "vllm": {
    "id": "vllm",
    "name": "vLLM",
    "aliases": [
      "vllm"
    ],
    "transport": "openai-chat",
    "baseURL": "http://localhost:8000/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.vllm.ai/en/latest/serving/openai_compatible_server/"
    ],
    "reviewedAt": "2026-08-17"
  },
  "ollama": {
    "id": "ollama",
    "name": "Ollama",
    "aliases": [
      "ollama"
    ],
    "transport": "openai-chat",
    "baseURL": "http://localhost:11434/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.ollama.com/api/openai-compatibility"
    ],
    "reviewedAt": "2026-08-17"
  },
  "lm-studio": {
    "id": "lm-studio",
    "name": "LM Studio",
    "aliases": [
      "lm-studio",
      "lmstudio"
    ],
    "transport": "openai-chat",
    "baseURL": "http://localhost:1234/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://lmstudio.ai/docs/developer/openai-compat"
    ],
    "reviewedAt": "2026-08-17"
  },
  "llama-cpp": {
    "id": "llama-cpp",
    "name": "llama.cpp Server",
    "aliases": [
      "llama-cpp",
      "llama.cpp"
    ],
    "transport": "openai-chat",
    "baseURL": "http://localhost:8080/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md"
    ],
    "reviewedAt": "2026-08-17"
  },
  "localai": {
    "id": "localai",
    "name": "LocalAI",
    "aliases": [
      "localai",
      "local-ai"
    ],
    "transport": "openai-chat",
    "baseURL": "http://localhost:8080/v1",
    "requiresApiURL": false,
    "auth": {
      "type": "bearer",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://localai.io/features/openai-functions/"
    ],
    "reviewedAt": "2026-08-17"
  },
  "baseten-engine": {
    "id": "baseten-engine",
    "name": "Baseten Inference Engine",
    "aliases": [
      "baseten-engine",
      "truss"
    ],
    "transport": "openai-chat",
    "baseURL": null,
    "requiresApiURL": true,
    "auth": {
      "type": "bearer",
      "required": false
    },
    "defaults": {
      "model": ""
    },
    "capabilities": {
      "functions": true,
      "streaming": true,
      "structuredOutputs": false,
      "thinking": false,
      "multiTurn": true,
      "structuredOutputModes": [
        "function"
      ],
      "serviceTiers": []
    },
    "operations": {
      "chat": {
        "path": "/chat/completions",
        "dialect": "openai-chat"
      }
    },
    "modelRules": [],
    "sources": [
      "https://docs.baseten.co/development/model/deployment/inference"
    ],
    "reviewedAt": "2026-08-17"
  }
} as const;

// biome-ignore format: generated file
export const axAIProviderAliases = {
  "openai": "openai",
  "openai-compatible": "openai-compatible",
  "openai_compatible": "openai-compatible",
  "compatible": "openai-compatible",
  "openai-responses": "openai-responses",
  "openai_responses": "openai-responses",
  "responses": "openai-responses",
  "anthropic": "anthropic",
  "claude": "anthropic",
  "google-gemini": "google-gemini",
  "google_gemini": "google-gemini",
  "gemini": "google-gemini",
  "webllm": "webllm",
  "azure-openai": "azure-openai",
  "azure_openai": "azure-openai",
  "azure": "azure-openai",
  "deepseek": "deepseek",
  "deepseek-responses": "deepseek-responses",
  "deepseek_responses": "deepseek-responses",
  "mistral": "mistral",
  "cohere": "cohere",
  "grok": "grok",
  "xai": "grok",
  "x-grok": "grok",
  "x_grok": "grok",
  "reka": "reka",
  "together": "together",
  "together-ai": "together",
  "together_ai": "together",
  "openrouter": "openrouter",
  "orcarouter": "orcarouter",
  "fireworks": "fireworks",
  "fireworks-ai": "fireworks",
  "huggingface-router": "huggingface-router",
  "huggingface": "huggingface-router",
  "hf-router": "huggingface-router",
  "amazon-bedrock": "amazon-bedrock",
  "bedrock": "amazon-bedrock",
  "azure-foundry": "azure-foundry",
  "azure-ai-foundry": "azure-foundry",
  "microsoft-foundry": "azure-foundry",
  "vertex-ai": "vertex-ai",
  "vertex-openai": "vertex-ai",
  "databricks": "databricks",
  "baseten": "baseten",
  "groq": "groq",
  "cerebras": "cerebras",
  "deepinfra": "deepinfra",
  "sambanova": "sambanova",
  "sambanova-cloud": "sambanova",
  "nebius": "nebius",
  "novita": "novita",
  "novita-ai": "novita",
  "hyperbolic": "hyperbolic",
  "siliconflow": "siliconflow",
  "friendli": "friendli",
  "friendli-ai": "friendli",
  "cloudflare-workers-ai": "cloudflare-workers-ai",
  "workers-ai": "cloudflare-workers-ai",
  "featherless": "featherless",
  "featherless-ai": "featherless",
  "nscale": "nscale",
  "ovhcloud": "ovhcloud",
  "ovh": "ovhcloud",
  "scaleway": "scaleway",
  "nvidia-nim": "nvidia-nim",
  "nim": "nvidia-nim",
  "runpod-vllm": "runpod-vllm",
  "runpod": "runpod-vllm",
  "sagemaker-vllm": "sagemaker-vllm",
  "sagemaker": "sagemaker-vllm",
  "vllm": "vllm",
  "ollama": "ollama",
  "lm-studio": "lm-studio",
  "lmstudio": "lm-studio",
  "llama-cpp": "llama-cpp",
  "llama.cpp": "llama-cpp",
  "localai": "localai",
  "local-ai": "localai",
  "baseten-engine": "baseten-engine",
  "truss": "baseten-engine"
} as const;

// biome-ignore format: generated file
export const axAIProviderProfileIds = [
  "openai",
  "openai-compatible",
  "openai-responses",
  "anthropic",
  "google-gemini",
  "webllm",
  "azure-openai",
  "deepseek",
  "deepseek-responses",
  "mistral",
  "cohere",
  "grok",
  "reka",
  "together",
  "openrouter",
  "orcarouter",
  "fireworks",
  "huggingface-router",
  "amazon-bedrock",
  "azure-foundry",
  "vertex-ai",
  "databricks",
  "baseten",
  "groq",
  "cerebras",
  "deepinfra",
  "sambanova",
  "nebius",
  "novita",
  "hyperbolic",
  "siliconflow",
  "friendli",
  "cloudflare-workers-ai",
  "featherless",
  "nscale",
  "ovhcloud",
  "scaleway",
  "nvidia-nim",
  "runpod-vllm",
  "sagemaker-vllm",
  "vllm",
  "ollama",
  "lm-studio",
  "llama-cpp",
  "localai",
  "baseten-engine"
] as const;
