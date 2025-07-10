import type {
  AxChatRequest,
  AxLoggerData,
  AxLoggerFunction,
} from '../ai/types.js';
import { ColorLog } from '../util/log.js';

const colorLog = new ColorLog();

// Default output function that writes to stdout
const defaultOutput = (message: string): void => {
  process.stdout.write(message);
};

// Helper function to format chat message for display
const formatChatMessage = (
  msg: AxChatRequest['chatPrompt'][number],
  hideContent?: boolean
) => {
  switch (msg.role) {
    case 'system':
      return `─── System: ───\n${msg.content}`;
    case 'function':
      return `─── Function Result: ───\n${msg.result}`;
    case 'user': {
      if (typeof msg.content === 'string') {
        return `─── User: ───\n${msg.content}`;
      }
      const items = msg.content.map((item) => {
        if (item.type === 'text') {
          return item.text;
        }
        if (item.type === 'image') {
          return hideContent ? '[Image]' : `[Image: ${item.image}]`;
        }
        if (item.type === 'audio') {
          return hideContent ? '[Audio]' : `[Audio: ${item.data}]`;
        }
        return '[Unknown content type]';
      });
      return `─── User: ───\n${items.join('\n')}`;
    }
    case 'assistant': {
      let result = '─── Assistant:';
      if (msg.name) {
        result += ` ${msg.name}`;
      }
      result += ' ───\n';

      if (msg.content) {
        result += msg.content;
      }

      if (msg.functionCalls && msg.functionCalls.length > 0) {
        if (msg.content) {
          result += '\n';
        }
        result += '─── Function Calls ───\n';
        msg.functionCalls.forEach((call, i) => {
          const params =
            typeof call.function.params === 'string'
              ? call.function.params
              : JSON.stringify(call.function.params, null, 2);
          result += `${i + 1}. ${call.function.name}(${params}) [id: ${call.id}]`;
          if (i < msg.functionCalls!.length - 1) {
            result += '\n';
          }
        });
      }

      if (
        !msg.content &&
        (!msg.functionCalls || msg.functionCalls.length === 0)
      ) {
        result += '[No content]';
      }

      return result;
    }
    default:
      return `─── Unknown Role: ───\n${JSON.stringify(msg)}`;
  }
};

// Factory function to create a default logger with customizable output
export const axCreateDefaultColorLogger = (
  output: (message: string) => void = defaultOutput
): AxLoggerFunction => {
  return (message: AxLoggerData) => {
    const typedData = message;
    let formattedMessage = '';

    switch (typedData.name) {
      case 'ChatRequestChatPrompt':
        formattedMessage = `${typedData.step > 0 ? '\n\n' : ''}─── [Step ${typedData.step}] Chat Request ───\n`;
        typedData.value.forEach((msg, i) => {
          formattedMessage += formatChatMessage(msg);
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      case 'FunctionResults':
        formattedMessage = '\n─── Function Results ───\n';
        typedData.value.forEach((result, i) => {
          formattedMessage += `Function: ${result.functionId}\nResult: ${result.result}`;
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      case 'ChatResponseResults':
        formattedMessage = '\n─── Chat Response ───\n';
        typedData.value.forEach((result, i) => {
          formattedMessage += result.content || '[No content]';
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      case 'ChatResponseStreamingResult':
        // Don't show streaming markers inline with content - just show the content
        formattedMessage =
          typedData.value.delta || typedData.value.content || '';
        break;
      case 'FunctionError':
        formattedMessage = `\n─── Function Error #${typedData.index} ───\n${typedData.fixingInstructions}\nError: ${typedData.error}`;
        break;
      case 'ValidationError':
        formattedMessage = `\n─── Validation Error #${typedData.index} ───\n${typedData.fixingInstructions}\nError: ${typedData.error}`;
        break;
      case 'AssertionError':
        formattedMessage = `\n─── Assertion Error #${typedData.index} ───\n${typedData.fixingInstructions}\nError: ${typedData.error}`;
        break;
      case 'ResultPickerUsed':
        formattedMessage = `─── Result Picker ───\nSelected sample ${typedData.selectedIndex + 1} of ${typedData.sampleCount} (${typedData.latency.toFixed(2)}ms)`;
        break;
      case 'Notification':
        formattedMessage = `─── Notification [${typedData.id}] ───\n${typedData.value}`;
        break;
      case 'EmbedRequest':
        formattedMessage = `─── Embed Request [${typedData.embedModel}] ───\n`;
        typedData.value.forEach((text, i) => {
          formattedMessage += `Text ${i + 1}: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`;
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      case 'EmbedResponse':
        formattedMessage = `─── Embed Response (${typedData.totalEmbeddings} embeddings) ───\n`;
        typedData.value.forEach((embedding, i) => {
          formattedMessage += `Embedding ${i + 1}: [${embedding.sample.join(', ')}${embedding.truncated ? ', ...' : ''}] (length: ${embedding.length})`;
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      default:
        formattedMessage = JSON.stringify(typedData, null, 2);
    }

    output(colorLog.white(formattedMessage));
  };
};

export const defaultLogger: AxLoggerFunction = axCreateDefaultColorLogger();

// Factory function to create a text-only logger (no colors) with customizable output
export const axCreateDefaultTextLogger = (
  output: (message: string) => void = defaultOutput
): AxLoggerFunction => {
  return (message: AxLoggerData) => {
    const typedData = message;
    let formattedMessage = '';

    switch (typedData.name) {
      case 'ChatRequestChatPrompt':
        formattedMessage = `${typedData.step > 0 ? '\n\n' : ''}─── [Step ${typedData.step}] Chat Request ───\n`;
        typedData.value.forEach((msg, i) => {
          formattedMessage += formatChatMessage(msg);
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      case 'FunctionResults':
        formattedMessage = '─── Function Results ───\n';
        typedData.value.forEach((result, i) => {
          formattedMessage += `Function: ${result.functionId}\nResult: ${result.result}`;
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      case 'ChatResponseResults':
        formattedMessage = '\n─── Chat Response ───\n';
        typedData.value.forEach((result, i) => {
          formattedMessage += result.content || '[No content]';
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      case 'ChatResponseStreamingResult':
        // Don't show streaming markers inline with content - just show the content
        formattedMessage =
          typedData.value.delta || typedData.value.content || '';
        break;
      case 'FunctionError':
        formattedMessage = `\n─── Function Error #${typedData.index} ───\n${typedData.fixingInstructions}\nError: ${typedData.error}`;
        break;
      case 'ValidationError':
        formattedMessage = `\n─── Validation Error #${typedData.index} ───\n${typedData.fixingInstructions}\nError: ${typedData.error}`;
        break;
      case 'AssertionError':
        formattedMessage = `\n─── Assertion Error #${typedData.index} ───\n${typedData.fixingInstructions}\nError: ${typedData.error}`;
        break;
      case 'ResultPickerUsed':
        formattedMessage = `─── Result Picker ───\nSelected sample ${typedData.selectedIndex + 1} of ${typedData.sampleCount} (${typedData.latency.toFixed(2)}ms)`;
        break;
      case 'Notification':
        formattedMessage = `─── Notification [${typedData.id}] ───\n${typedData.value}`;
        break;
      case 'EmbedRequest':
        formattedMessage = `─── Embed Request [${typedData.embedModel}] ───\n`;
        typedData.value.forEach((text, i) => {
          formattedMessage += `Text ${i + 1}: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`;
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      case 'EmbedResponse':
        formattedMessage = `─── Embed Response (${typedData.totalEmbeddings} embeddings) ───\n`;
        typedData.value.forEach((embedding, i) => {
          formattedMessage += `Embedding ${i + 1}: [${embedding.sample.join(', ')}${embedding.truncated ? ', ...' : ''}] (length: ${embedding.length})`;
          if (i < typedData.value.length - 1) formattedMessage += '\n';
        });
        break;
      default:
        formattedMessage = JSON.stringify(typedData, null, 2);
    }

    output(formattedMessage);
  };
};

/**
 * Factory function to create an enhanced optimizer logger with clean visual formatting
 * that works for all optimizer types using semantic tags for proper categorization
 */
export const axCreateOptimizerLogger = (
  output: (message: string) => void = (msg) => process.stdout.write(msg)
): AxLoggerFunction => {
  const baseLogger = axCreateDefaultColorLogger(output);

  return (message: AxLoggerData) => {
    // Handle typed logger data by delegating to base logger
    baseLogger(message);
  };
};

/**
 * Default optimizer logger instance
 */
export const axDefaultOptimizerLogger = axCreateOptimizerLogger();
