import type {
  AxChatRequest,
  AxLoggerData,
  AxLoggerFunction,
} from '../ai/types.js';
import { ColorLog } from '../util/log.js';

const _colorLog = new ColorLog();

// Default output function that writes to stdout
const defaultOutput = (message: string): void => {
  console.log(message);
};

// Helper function to format chat message for display
const formatChatMessage = (
  msg: AxChatRequest['chatPrompt'][number],
  hideContent?: boolean,
  cl?: ColorLog
) => {
  const colorize = (text: string, colorMethod?: keyof ColorLog) => {
    if (cl && colorMethod && colorMethod in cl) {
      return (cl[colorMethod] as (t: string) => string)(text);
    }
    return text;
  };

  switch (msg.role) {
    case 'system':
      return `${colorize('[ SYSTEM ]', 'magentaBright')}\n${colorize(msg.content, 'magenta')}`;
    case 'function':
      return `${colorize('[ FUNCTION RESULT ]', 'yellow')}\n${colorize(msg.result ?? '[No result]', 'yellowDim')}`;
    case 'user': {
      const header = `${colorize('[ USER ]', 'greenBright')}\n`;
      if (typeof msg.content === 'string') {
        return header + colorize(msg.content, 'green');
      }
      const items = msg.content.map((item) => {
        if (item.type === 'text') {
          return colorize(item.text, 'green');
        }
        if (item.type === 'image') {
          const content = hideContent ? '[Image]' : `[Image: ${item.image}]`;
          return colorize(content, 'green');
        }
        if (item.type === 'audio') {
          const content = hideContent ? '[Audio]' : `[Audio: ${item.data}]`;
          return colorize(content, 'green');
        }
        return colorize('[Unknown content type]', 'gray');
      });
      return header + items.join('\n');
    }
    case 'assistant': {
      let header = colorize('[ ASSISTANT', 'cyanBright');
      if (msg.name) {
        header += ` ${msg.name}`;
      }
      header += ' ]';
      let result = `${header}\n`;
      if (msg.content) {
        result += `${colorize(msg.content, 'cyan')}\n`;
      }
      if (msg.functionCalls && msg.functionCalls.length > 0) {
        result += `${colorize('[ FUNCTION CALLS ]', 'yellow')}\n`;
        msg.functionCalls.forEach((call, i) => {
          const params =
            typeof call.function.params === 'string'
              ? call.function.params
              : JSON.stringify(call.function.params, null, 2);
          result += colorize(
            `${i + 1}. ${call.function.name}(${params}) [id: ${call.id}]`,
            'yellowDim'
          );
          if (i < (msg.functionCalls?.length ?? 0) - 1) {
            result += '\n';
          }
        });
        result += '\n';
      }
      if (
        !msg.content &&
        (!msg.functionCalls || msg.functionCalls.length === 0)
      ) {
        result += colorize('[No content]', 'gray');
      }
      return result;
    }
    default:
      return `${colorize('[ UNKNOWN ]', 'redBright')}\n${colorize(JSON.stringify(msg), 'gray')}`;
  }
};

// Factory function to create a default logger with customizable output
export const axCreateDefaultColorLogger = (
  output: (message: string) => void = defaultOutput
): AxLoggerFunction => {
  const cl = new ColorLog();
  const divider = cl.gray(`${'─'.repeat(60)}\n`);
  return (message: AxLoggerData) => {
    const typedData = message;
    let formattedMessage = '';

    switch (typedData.name) {
      case 'ChatRequestChatPrompt':
        formattedMessage = `\n${cl.blueBright(`[ CHAT REQUEST Step ${typedData.step} ]`)}\n${divider}\n`;
        typedData.value.forEach((msg, i) => {
          formattedMessage += formatChatMessage(msg, undefined, cl);
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        formattedMessage += `\n${divider}`; // Keep closing for steps
        break;
      case 'FunctionResults':
        formattedMessage = `\n${cl.yellow('[ FUNCTION RESULTS ]')}\n`;
        typedData.value.forEach((result, i) => {
          formattedMessage += cl.yellowDim(
            `Function: ${result.functionId}\nResult: ${result.result}`
          );
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'ChatResponseResults':
        formattedMessage = `\n${cl.cyanBright('[ CHAT RESPONSE ]')}\n`;
        typedData.value.forEach((result, i) => {
          const lines: string[] = [];
          if (result.thoughtBlock?.data || result.thought) {
            lines.push(
              cl.gray(
                `[THOUGHT${result.thoughtBlock?.encrypted ? ' (redacted)' : ''}]\n` +
                  (result.thoughtBlock?.data ?? result.thought ?? '')
              )
            );
          }
          if (result.content) {
            lines.push(cl.cyan(result.content));
          }
          if (lines.length === 0) {
            lines.push(cl.gray('[No content]'));
          }
          formattedMessage += lines.join('\n');
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'ChatResponseStreamingResult': {
        const thought = typedData.value.thought;
        const streamingContent =
          thought || typedData.value.delta || typedData.value.content || '';
        formattedMessage = thought
          ? cl.gray(`[THOUGHT]\n${thought}`)
          : cl.cyanBright(streamingContent);
        break;
      }
      case 'ChatResponseStreamingDoneResult': {
        formattedMessage = `\n${cl.cyanBright('[ CHAT RESPONSE ]')}\n${divider}\n`;
        if (typedData.value.content) {
          formattedMessage += cl.cyanBright(typedData.value.content);
        }
        if (typedData.value.thoughtBlock?.data || typedData.value.thought) {
          formattedMessage += `\n`;
          formattedMessage += cl.gray(
            `[THOUGHT${typedData.value.thoughtBlock?.encrypted ? ' (redacted)' : ''}]\n` +
              (typedData.value.thoughtBlock?.data ??
                typedData.value.thought ??
                '')
          );
        }
        if (typedData.value.functionCalls) {
          formattedMessage += cl.cyanBright(
            JSON.stringify(typedData.value.functionCalls, null, 2)
          );
        }
        break;
      }
      case 'FunctionError':
        formattedMessage = `\n${cl.redBright(`[ FUNCTION ERROR #${typedData.index} ]`)}\n${divider}\n${cl.white(typedData.fixingInstructions)}\n${cl.red(`Error: ${typedData.error}`)}`;
        break;
      case 'ValidationError':
        formattedMessage = `\n${cl.redBright(`[ VALIDATION ERROR #${typedData.index} ]`)}\n${divider}\n${cl.white(typedData.fixingInstructions)}\n${cl.red(`Error: ${typedData.error}`)}`;
        break;
      case 'AssertionError':
        formattedMessage = `\n${cl.redBright(`[ ASSERTION ERROR #${typedData.index} ]`)}\n${divider}\n${cl.white(typedData.fixingInstructions)}\n${cl.red(`Error: ${typedData.error}`)}`;
        break;
      case 'ResultPickerUsed':
        formattedMessage = `${cl.greenBright('[ RESULT PICKER ]')}\n${divider}\n${cl.green(`Selected sample ${typedData.selectedIndex + 1} of ${typedData.sampleCount} (${typedData.latency.toFixed(2)}ms)`)}`;
        break;
      case 'Notification':
        formattedMessage = `${cl.gray(`[ NOTIFICATION ${typedData.id} ]`)}\n${divider}\n${cl.white(typedData.value)}`;
        break;
      case 'EmbedRequest':
        formattedMessage = `${cl.orange(`[ EMBED REQUEST ${typedData.embedModel} ]`)}\n${divider}\n`;
        typedData.value.forEach((text, i) => {
          formattedMessage += cl.white(
            `Text ${i + 1}: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`
          );
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'EmbedResponse':
        formattedMessage = `${cl.orange(`[ EMBED RESPONSE (${typedData.totalEmbeddings} embeddings) ]`)}\n${divider}\n`;
        typedData.value.forEach((embedding, i) => {
          formattedMessage += cl.white(
            `Embedding ${i + 1}: [${embedding.sample.join(', ')}${embedding.truncated ? ', ...' : ''}] (length: ${embedding.length})`
          );
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'ChatResponseUsage': {
        formattedMessage = `${cl.greenBright('\n[ CHAT RESPONSE USAGE ]')}\n`;
        const usage = typedData.value;
        formattedMessage += `${cl.white('AI:')} ${usage.ai}\n`;
        formattedMessage += `${cl.white('Model:')} ${usage.model}\n`;
        if (usage.tokens) {
          formattedMessage += `${cl.white('Total Tokens:')} ${usage.tokens.totalTokens}\n`;
          formattedMessage += `${cl.white('Prompt Tokens:')} ${usage.tokens.promptTokens}\n`;
          formattedMessage += `${cl.white('Completion Tokens:')} ${usage.tokens.completionTokens}\n`;
          if (usage.tokens.thoughtsTokens !== undefined) {
            formattedMessage += `${cl.white('Thoughts Tokens:')} ${usage.tokens.thoughtsTokens}\n`;
          }
          if (usage.tokens.reasoningTokens !== undefined) {
            formattedMessage += `${cl.white('Reasoning Tokens:')} ${usage.tokens.reasoningTokens}\n`;
          }
          if (usage.tokens.cacheCreationTokens !== undefined) {
            formattedMessage += `${cl.white('Cache Creation Tokens:')} ${usage.tokens.cacheCreationTokens}\n`;
          }
          if (usage.tokens.cacheReadTokens !== undefined) {
            formattedMessage += `${cl.white('Cache Read Tokens:')} ${usage.tokens.cacheReadTokens}\n`;
          }
          if (usage.tokens.serviceTier !== undefined) {
            formattedMessage += `${cl.white('Service Tier:')} ${usage.tokens.serviceTier}\n`;
          }
        }
        formattedMessage += divider;
        break;
      }
      case 'ChatResponseCitations': {
        formattedMessage = `${cl.blueBright('\n[ CHAT RESPONSE CITATIONS ]')}\n`;
        typedData.value.forEach((citation) => {
          formattedMessage += `${cl.white('- ')}${cl.cyan(citation.title || citation.url)}\n`;
          if (citation.description) {
            formattedMessage += `  ${cl.gray(citation.description)}\n`;
          }
        });
        formattedMessage += divider;
        break;
      }
      default:
        formattedMessage = cl.gray(JSON.stringify(typedData, null, 2));
    }

    output(formattedMessage);
  };
};

export const defaultLogger: AxLoggerFunction = axCreateDefaultColorLogger();

// Factory function to create a text-only logger (no colors) with customizable output
export const axCreateDefaultTextLogger = (
  output: (message: string) => void = defaultOutput
): AxLoggerFunction => {
  const divider = '─'.repeat(60);
  return (message: AxLoggerData) => {
    const typedData = message;
    let formattedMessage = '';

    switch (typedData.name) {
      case 'ChatRequestChatPrompt':
        formattedMessage = `\n[ CHAT REQUEST Step ${typedData.step} ]\n${divider}\n`;
        typedData.value.forEach((msg, i) => {
          formattedMessage += formatChatMessage(msg);
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        formattedMessage += `\n${divider}`; // Keep closing for steps
        break;
      case 'FunctionResults':
        formattedMessage = `\n[ FUNCTION RESULTS ]\n${divider}\n`;
        typedData.value.forEach((result, i) => {
          formattedMessage += `Function: ${result.functionId}\nResult: ${result.result}`;
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'ChatResponseResults':
        formattedMessage = '\n[ CHAT RESPONSE ]\n';
        typedData.value.forEach((result, i) => {
          const lines: string[] = [];
          if (result.thoughtBlock?.data || result.thought) {
            lines.push(
              `[thought${result.thoughtBlock?.encrypted ? ' (redacted)' : ''}] ` +
                (result.thoughtBlock?.data ?? result.thought ?? '')
            );
          }
          if (result.content) {
            lines.push(result.content);
          }
          if (lines.length === 0) {
            lines.push('[No content]');
          }
          formattedMessage += lines.join('\n');
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'ChatResponseStreamingResult': {
        // const streamingContent =
        //   typedData.value.delta || typedData.value.content || '';
        // // Add newline prefix if this is actual content (not just a delta)
        // formattedMessage = streamingContent;
        return;
      }
      case 'ChatResponseStreamingDoneResult': {
        formattedMessage = '\n[ CHAT RESPONSE ]\n';
        if (typedData.value.content) {
          formattedMessage += typedData.value.content;
        }
        if (typedData.value.thoughtBlock?.data || typedData.value.thought) {
          formattedMessage += `\n`;
          formattedMessage +=
            `[thought${typedData.value.thoughtBlock?.encrypted ? ' (redacted)' : ''}] ` +
            (typedData.value.thoughtBlock?.data ??
              typedData.value.thought ??
              '');
        }
        if (typedData.value.functionCalls) {
          formattedMessage += JSON.stringify(
            typedData.value.functionCalls,
            null,
            2
          );
        }
        break;
      }
      case 'FunctionError':
        formattedMessage = `\n[ FUNCTION ERROR #${typedData.index} ]\n${divider}\n${typedData.fixingInstructions}\nError: ${typedData.error}`;
        break;
      case 'ValidationError':
        formattedMessage = `\n[ VALIDATION ERROR #${typedData.index} ]\n${divider}\n${typedData.fixingInstructions}\nError: ${typedData.error}`;
        break;
      case 'AssertionError':
        formattedMessage = `\n[ ASSERTION ERROR #${typedData.index} ]\n${divider}\n${typedData.fixingInstructions}\nError: ${typedData.error}`;
        break;
      case 'ResultPickerUsed':
        formattedMessage = `[ RESULT PICKER ]\n${divider}\nSelected sample ${typedData.selectedIndex + 1} of ${typedData.sampleCount} (${typedData.latency.toFixed(2)}ms)`;
        break;
      case 'Notification':
        formattedMessage = `[ NOTIFICATION ${typedData.id} ]\n${divider}\n${typedData.value}`;
        break;
      case 'EmbedRequest':
        formattedMessage = `[ EMBED REQUEST ${typedData.embedModel} ]\n${divider}\n`;
        typedData.value.forEach((text, i) => {
          formattedMessage += `Text ${i + 1}: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`;
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'EmbedResponse':
        formattedMessage = `[ EMBED RESPONSE (${typedData.totalEmbeddings} embeddings) ]\n${divider}\n`;
        typedData.value.forEach((embedding, i) => {
          formattedMessage += `Embedding ${i + 1}: [${embedding.sample.join(', ')}${embedding.truncated ? ', ...' : ''}] (length: ${embedding.length})`;
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'ChatResponseUsage': {
        formattedMessage = '\n[ CHAT RESPONSE USAGE ]\n';
        const textUsage = typedData.value;
        formattedMessage += `AI: ${textUsage.ai}\n`;
        formattedMessage += `Model: ${textUsage.model}\n`;
        if (textUsage.tokens) {
          formattedMessage += `Total Tokens: ${textUsage.tokens.totalTokens}\n`;
          formattedMessage += `Prompt Tokens: ${textUsage.tokens.promptTokens}\n`;
          formattedMessage += `Completion Tokens: ${textUsage.tokens.completionTokens}\n`;
          if (textUsage.tokens.thoughtsTokens !== undefined) {
            formattedMessage += `Thoughts Tokens: ${textUsage.tokens.thoughtsTokens}\n`;
          }
          if (textUsage.tokens.reasoningTokens !== undefined) {
            formattedMessage += `Reasoning Tokens: ${textUsage.tokens.reasoningTokens}\n`;
          }
          if (textUsage.tokens.cacheCreationTokens !== undefined) {
            formattedMessage += `Cache Creation Tokens: ${textUsage.tokens.cacheCreationTokens}\n`;
          }
          if (textUsage.tokens.cacheReadTokens !== undefined) {
            formattedMessage += `Cache Read Tokens: ${textUsage.tokens.cacheReadTokens}\n`;
          }
          if (textUsage.tokens.serviceTier !== undefined) {
            formattedMessage += `Service Tier: ${textUsage.tokens.serviceTier}\n`;
          }
        }
        formattedMessage += `${divider}\n`;
        break;
      }
      case 'ChatResponseCitations': {
        formattedMessage = '\n[ CHAT RESPONSE CITATIONS ]\n';
        typedData.value.forEach((citation) => {
          formattedMessage += `- ${citation.title || citation.url}\n`;
          if (citation.description) {
            formattedMessage += `  ${citation.description}\n`;
          }
        });
        formattedMessage += `${divider}\n`;
        break;
      }
      default:
        formattedMessage = JSON.stringify(typedData, null, 2);
    }

    output(formattedMessage);
  };
};
