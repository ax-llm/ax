import type { AxLoggerFunction, AxLoggerTag } from '../ai/types.js';
import { ColorLog } from '../util/log.js';

const colorLog = new ColorLog();

// Default output function that writes to stdout
const defaultOutput = (message: string): void => {
  process.stdout.write(message);
};

// Factory function to create a default logger with customizable output
export const axCreateDefaultLogger = (
  output: (message: string) => void = defaultOutput
): AxLoggerFunction => {
  return (message: string, options?: { tags?: AxLoggerTag[] }) => {
    const tags = options?.tags ?? [];
    let formattedMessage = message;

    // Step 1: Pick color function based on semantic tags
    let colorFunction: (text: string) => string = (text) => text; // default no color

    if (tags.includes('warning') || tags.includes('discovery')) {
      colorFunction = (text) => colorLog.yellow(text);
    } else if (tags.includes('error')) {
      colorFunction = (text) => colorLog.red(text);
    } else if (tags.includes('success') || tags.includes('responseContent')) {
      colorFunction = (text) => colorLog.greenBright(text);
    } else if (
      tags.includes('systemContent') ||
      tags.includes('assistantContent')
    ) {
      colorFunction = (text) => colorLog.blueBright(text);
    } else if (tags.includes('functionName')) {
      colorFunction = (text) => colorLog.whiteBright(text);
    } else if (tags.includes('functionArg')) {
      colorFunction = (text) => colorLog.blueBright(text);
    } else if (tags.includes('functionResult')) {
      colorFunction = (text) => colorLog.yellow(text);
    }

    // Step 2: Add prefix based on tag type
    if (
      tags.includes('responseStart') ||
      tags.includes('systemStart') ||
      tags.includes('userStart') ||
      tags.includes('assistantStart') ||
      tags.includes('error') ||
      tags.includes('functionName') ||
      tags.includes('functionArg')
    ) {
      formattedMessage = `\n${formattedMessage}`;
    }

    // Step 3: Add postfix based on tag type
    if (
      tags.includes('responseEnd') ||
      tags.includes('systemEnd') ||
      tags.includes('userEnd') ||
      tags.includes('assistantStart') ||
      tags.includes('error') ||
      tags.includes('functionEnd')
    ) {
      formattedMessage = `${formattedMessage}\n`;
    }

    // Step 4: Apply color function and output
    output(colorFunction(formattedMessage));
  };
};

// Factory function to create a text-only logger (no colors) with customizable output
export const axCreateDefaultTextLogger = (
  output: (message: string) => void = defaultOutput
): AxLoggerFunction => {
  return (message: string, options?: { tags?: AxLoggerTag[] }) => {
    const tags = options?.tags ?? [];
    let formattedMessage = message;

    // Step 1: No color function needed for text logger

    // Step 2: Add prefix based on tag type
    if (
      tags.includes('responseStart') ||
      tags.includes('systemStart') ||
      tags.includes('userStart') ||
      tags.includes('assistantStart') ||
      tags.includes('error') ||
      tags.includes('functionName') ||
      tags.includes('functionArg')
    ) {
      formattedMessage = `\n${formattedMessage}`;
    }

    // Step 3: Add postfix based on tag type
    if (
      tags.includes('responseEnd') ||
      tags.includes('systemEnd') ||
      tags.includes('userEnd') ||
      tags.includes('assistantStart') ||
      tags.includes('error') ||
      tags.includes('functionEnd')
    ) {
      formattedMessage = `${formattedMessage}\n`;
    }

    // Step 4: Output without color
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
  const baseLogger = axCreateDefaultLogger(output);

  // Track state for better visual flow
  let isFirstPhase = true;

  return (message: string, options) => {
    const tags = options?.tags ?? [];
    let formattedMessage = message;

    // Use tags for semantic formatting instead of string pattern matching
    if (tags.includes('optimizer')) {
      if (tags.includes('start')) {
        const trialsMatch =
          message.match(/with (\d+) trials?/) || message.match(/(\d+) trials?/);
        const optimizerMatch = message.match(
          /(MIPROv2|BootstrapFewshot|[A-Z][a-zA-Z]+)/
        );
        const optimizerName = optimizerMatch ? optimizerMatch[1] : 'Optimizer';

        if (trialsMatch?.[1]) {
          formattedMessage = `\n┌─ ${optimizerName} optimization (${trialsMatch[1]} trials)\n`;
        } else {
          formattedMessage = `\n┌─ ${optimizerName} optimization\n`;
        }
        isFirstPhase = true;
      } else if (tags.includes('config')) {
        if (message.includes('examples') && message.includes('training')) {
          const match =
            message.match(
              /(\d+) examples for training and (\d+) for validation/
            ) || message.match(/(\d+) training.*?(\d+) validation/);
          if (match?.[1] && match[2]) {
            formattedMessage = `│  Dataset: ${match[1]} training, ${match[2]} validation\n`;
          } else {
            const simpleMatch = message.match(/(\d+) examples/);
            if (simpleMatch?.[1]) {
              formattedMessage = `│  Dataset: ${simpleMatch[1]} examples\n`;
            }
          }
        } else if (message.includes('teacher')) {
          formattedMessage = '│  Using teacher model\n';
        } else {
          formattedMessage = `│  ${message}\n`;
        }
      } else if (tags.includes('phase')) {
        if (isFirstPhase) {
          formattedMessage = `├─ ${message}\n`;
          isFirstPhase = false;
        } else {
          formattedMessage = `├─ ${message}\n`;
        }
      } else if (tags.includes('result')) {
        if (message.includes('Generated') || message.includes('Selected')) {
          const match = message.match(/(\d+)/);
          if (match?.[1]) {
            formattedMessage = `│  ✓ ${message}\n`;
          } else {
            formattedMessage = `│  ✓ ${message}\n`;
          }
        } else if (message.includes('configuration')) {
          formattedMessage = '│  Applied best configuration\n';
        } else {
          formattedMessage = `│  ${message}\n`;
        }
      } else if (tags.includes('progress')) {
        formattedMessage = `│  ${message}\n`;
      } else if (tags.includes('complete')) {
        const scoreMatch = message.match(/(score|performance):\s*([\d.]+)/);
        if (scoreMatch?.[2]) {
          const score = Number.parseFloat(scoreMatch[2]);
          const percentage =
            score <= 1 ? `${(score * 100).toFixed(1)}%` : score.toFixed(3);
          formattedMessage = `├─ Complete! Best: ${percentage}\n`;
        } else if (message.includes('Bootstrap')) {
          formattedMessage = `├─ ${message}\n`;
        } else {
          formattedMessage = '├─ Optimization complete\n';
        }
      } else if (tags.includes('checkpoint')) {
        if (message.includes('Resuming')) {
          formattedMessage = `│  ${message}\n`;
        } else {
          const match =
            message.match(/checkpoint:\s*(.+)/) ||
            message.match(/Saved\s+(.+)/);
          if (match?.[1]) {
            formattedMessage = `└─ Saved: ${match[1]}\n`;
          } else {
            formattedMessage = '└─ Checkpoint saved\n';
          }
        }
      }
    }

    // Handle non-optimizer messages with basic formatting
    else if (tags.includes('discovery')) {
      if (message.includes('Found') && message.includes('examples')) {
        const match = message.match(/Found (\d+)/);
        if (match?.[1]) {
          formattedMessage = `│  Found ${match[1]} examples\n`;
        }
      }
    }

    // Handle errors and warnings
    if (tags.includes('error')) {
      formattedMessage = `\n✗ ${message}\n`;
    } else if (tags.includes('warning')) {
      formattedMessage = `\n⚠ ${message}\n`;
    } else if (tags.includes('success') && !tags.includes('optimizer')) {
      formattedMessage = `✓ ${message}\n`;
    }

    // Use the base logger for color formatting and output
    baseLogger(formattedMessage, options);
  };
};

/**
 * Default optimizer logger instance
 */
export const axDefaultOptimizerLogger = axCreateOptimizerLogger();
