import type {
  AxChatRequest,
  AxLoggerData,
  AxLoggerFunction,
} from '../ai/types.js';
import { ColorLog } from '../util/log.js';

const _colorLog = new ColorLog();

// Default output function that writes to stdout
const defaultOutput = (message: string): void => {
  process.stdout.write(message);
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
          if (i < msg.functionCalls!.length - 1) {
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
  const divider = cl.gray('─'.repeat(60));
  return (message: AxLoggerData) => {
    const typedData = message;
    let formattedMessage = '';

    switch (typedData.name) {
      case 'ChatRequestChatPrompt':
        formattedMessage = `${typedData.step > 0 ? `\n${divider}\n` : ''}${cl.blueBright(`[ CHAT REQUEST Step ${typedData.step} ]`)}\n${divider}\n`;
        typedData.value.forEach((msg, i) => {
          formattedMessage += formatChatMessage(msg, undefined, cl);
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        formattedMessage += `\n${divider}`; // Keep closing for steps
        break;
      case 'FunctionResults':
        formattedMessage = `\n${cl.yellow('[ FUNCTION RESULTS ]')}\n${divider}\n`;
        typedData.value.forEach((result, i) => {
          formattedMessage += cl.yellowDim(
            `Function: ${result.functionId}\nResult: ${result.result}`
          );
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'ChatResponseResults':
        formattedMessage = `\n${cl.cyanBright('[ CHAT RESPONSE ]')}\n${divider}\n`;
        typedData.value.forEach((result, i) => {
          formattedMessage += cl.cyan(result.content || '[No content]');
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'ChatResponseStreamingResult':
        formattedMessage = cl.cyanBright(
          typedData.value.delta || typedData.value.content || ''
        );
        break;
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
        formattedMessage = `${typedData.step > 0 ? `\n${divider}\n` : ''}[ CHAT REQUEST Step ${typedData.step} ]\n${divider}\n`;
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
        formattedMessage = `\n[ CHAT RESPONSE ]\n${divider}\n`;
        typedData.value.forEach((result, i) => {
          formattedMessage += result.content || '[No content]';
          if (i < typedData.value.length - 1)
            formattedMessage += `\n${divider}\n`;
        });
        break;
      case 'ChatResponseStreamingResult':
        formattedMessage =
          typedData.value.delta || typedData.value.content || '';
        break;
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
      default:
        formattedMessage = JSON.stringify(typedData, null, 2);
    }

    output(formattedMessage);
  };
};
