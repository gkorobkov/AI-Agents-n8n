# AI Agent Chat

Web interface for AI agents powered by [n8n](https://n8n.io) workflows.  
Paste a webhook URL — start chatting instantly.

## ToC

- [Quick start](#quick-start)
- [Features](#features)
- [License](#license)
- [LLM GPT Models](#llm-gpt-models)
  - [✅ Free providers (available in the list)](#free-providers-available-in-the-list)
  - [❌ Other providers in the list — paid only](#other-providers-in-the-list-paid-only)

## Quick start

```
start-frontend.cmd        # open frontend locally
build.cmd                 # increment version + copy to .build/
deploy.cmd                # scp .build/frontend/* to server
```

Configure deploy target in `.env`:
```
DEPLOY_USER=user
DEPLOY_HOST=example.com
DEPLOY_PATH=/var/www/ai-agent-demo/
```

## Features

- Connect any n8n webhook as an AI agent backend
- Dark / light theme, RU / EN interface
- Session management, chat history in localStorage
- Markdown-like message rendering

## License

Free for non-commercial use · Commercial use requires a paid license  
See [LICENSE](LICENSE) · Contact: gkorobkov@gmail.com


Of all the providers shown in the screenshots, here are the ones that offer **free access with limits**:

---

## LLM GPT Models

### ✅ Free providers (available in the list)

**🟠 Groq Chat Model**
- Model: `llama-3.3-70b-versatile`
- Free API key, no credit card required
- Limits: tokens per minute/day (see [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits))
- ✅ Supports tool calling, JSON, fast

**🔵 OpenRouter Chat Model**
- Free models via `openrouter/free` or `openai/gpt-oss-20b:free`
- Limits: ~20 req/min, 200 req/day on free models
- ✅ Already integrated in the course project

**🔴 Google Gemini Chat Model**
- Model: `gemini-2.5-flash-lite-preview-09-2025` via Google AI Studio
- Free tier available
- ✅ OpenAI-compatible endpoint, suitable for most educational tasks

---

### ❌ Other providers in the list — paid only

| Provider | Status |
|---|---|
| Anthropic Chat Model | Paid only |
| Azure OpenAI Chat Model | Paid only |
| AWS Bedrock Chat Model | Paid only |
| Cohere Chat Model | Paid only (trial available) |
| DeepSeek Chat Model | ~Free chat, but API is paid |
| Google Vertex Chat Model | Paid (not to be confused with Gemini AI Studio) |
| Mistral Cloud Chat Model | Experiment plan — free, but prompts are used for training |
| OpenAI Chat Model | Paid only |
| xAI Grok Chat Model | Paid only |
| Lemonade / Ollama | Local run, free, but requires your own hardware |

---

**Recommendation for the course workflow:** use **Groq** as the primary free provider (no daily request limit, only token rate limit), **OpenRouter** as fallback, and **Google Gemini** via AI Studio when a large context window is needed.
