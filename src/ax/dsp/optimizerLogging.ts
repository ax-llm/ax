import { ColorLog } from '../util/log.js';
import type {
  AxOptimizerLoggerData,
  AxOptimizerLoggerFunction,
} from './optimizerTypes.js';

// Default output function that writes to stdout
const defaultOutput = (message: string): void => {
  console.log(message);
};

/**
 * Factory function to create a default optimizer logger with color formatting
 */
export const axCreateDefaultOptimizerColorLogger = (
  output: (message: string) => void = defaultOutput
): AxOptimizerLoggerFunction => {
  const cl = new ColorLog();
  const lightDivider = cl.gray('─'.repeat(50));
  const heavyDivider = cl.gray('━'.repeat(50));

  return (data: AxOptimizerLoggerData) => {
    let formattedMessage = '';

    switch (data.name) {
      case 'OptimizationStart':
        formattedMessage =
          `\n${cl.blueBright('● ')}${cl.whiteBright('Optimization Started')}\n` +
          `${lightDivider}\n` +
          `  ${cl.white('Optimizer:')} ${cl.cyan(data.value.optimizerType)}\n` +
          `  ${cl.white('Examples:')} ${cl.green(data.value.exampleCount.toString())} training, ${cl.green(data.value.validationCount.toString())} validation\n` +
          `  ${cl.white('Config:')} ${cl.white(JSON.stringify(data.value.config).slice(0, 80))}${JSON.stringify(data.value.config).length > 80 ? '...' : ''}\n` +
          `${heavyDivider}\n`;
        break;

      case 'RoundProgress':
        {
          const config = data.value.configuration || {};
          const configParts = [];
          
          // Add temperature if present
          if (config.temperature !== undefined && typeof config.temperature === 'number') {
            configParts.push(`T=${config.temperature.toFixed(2)}`);
          }
          
          // Add bootstrapped demos if present
          if (config.bootstrappedDemos !== undefined) {
            configParts.push(`demos=${config.bootstrappedDemos}`);
          }
          
          // Add any other numeric configs
          Object.entries(config).forEach(([key, value]) => {
            if (key !== 'temperature' && key !== 'bootstrappedDemos' && key !== 'trialNumber' && typeof value === 'number') {
              configParts.push(`${key}=${value.toFixed(2)}`);
            }
          });
          
          const improvement = data.value.currentScore - data.value.bestScore;
          const improvementStr = improvement > 0 
            ? cl.greenBright(` ↑${improvement.toFixed(3)}`)
            : improvement < 0 
              ? cl.red(` ↓${Math.abs(improvement).toFixed(3)}`)
              : '';
          
          formattedMessage =
            `${cl.yellow('● ')}${cl.whiteBright(`Round ${data.value.round}/${data.value.totalRounds}`)}` +
            (config.trialNumber !== undefined ? cl.gray(` [Trial #${config.trialNumber}]`) : '') + '\n' +
            `  ${cl.white('Score:')} ${cl.green(data.value.currentScore.toFixed(3))} ${cl.white('(best:')} ${cl.greenBright(data.value.bestScore.toFixed(3))}${cl.white(')')}${improvementStr}\n` +
            (configParts.length > 0 ? `  ${cl.white('Config:')} ${cl.cyan(configParts.join(', '))}\n` : '');
        }
        break;

      case 'EarlyStopping':
        formattedMessage =
          `\n${cl.red('● ')}${cl.whiteBright('Early Stopping')}\n` +
          `${lightDivider}\n` +
          `  ${cl.white('Round:')} ${cl.yellow(data.value.round.toString())}\n` +
          `  ${cl.white('Reason:')} ${cl.yellow(data.value.reason)}\n` +
          `  ${cl.white('Final Score:')} ${cl.green(data.value.finalScore.toFixed(3))}\n` +
          `${heavyDivider}\n`;
        break;

      case 'OptimizationComplete':
        {
          let explanationSection = '';
          
          // Add human-readable explanation if available
          if (data.value.explanation) {
            explanationSection += `\n${cl.blueBright('📊 Summary:')}\n  ${cl.white(data.value.explanation)}\n`;
          }
          
          // Add performance assessment if available
          if (data.value.performanceAssessment) {
            explanationSection += `\n${cl.yellowBright('⚡ Performance:')}\n  ${cl.white(data.value.performanceAssessment)}\n`;
          }
          
          // Add recommendations if available
          if (data.value.recommendations && data.value.recommendations.length > 0) {
            explanationSection += `\n${cl.greenBright('💡 Recommendations:')}\n`;
            data.value.recommendations.forEach((rec: string, idx: number) => {
              explanationSection += `  ${cl.white(`${idx + 1}.`)} ${cl.white(rec)}\n`;
            });
          }
          
          formattedMessage =
            `\n${cl.green('● ')}${cl.whiteBright('Optimization Complete')}\n` +
            `${lightDivider}\n` +
            `  ${cl.white('Best Score:')} ${cl.greenBright(data.value.bestScore.toFixed(3))}\n` +
            `  ${cl.white('Best Config:')} ${cl.cyan(JSON.stringify(data.value.bestConfiguration).slice(0, 80))}${JSON.stringify(data.value.bestConfiguration).length > 80 ? '...' : ''}\n` +
            `  ${cl.white('Total Calls:')} ${cl.white(data.value.stats?.totalCalls?.toString() || 'N/A')}\n` +
            `  ${cl.white('Success Rate:')} ${cl.green(`${(((data.value.stats?.successfulDemos || 0) / Math.max(data.value.stats?.totalCalls || 1, 1)) * 100).toFixed(1)}%`)}\n` +
            explanationSection +
            `${heavyDivider}\n`;
        }
        break;

      case 'ConfigurationProposal':
        formattedMessage =
          `${cl.magenta('● ')}${cl.whiteBright(`${data.value.type} Proposals`)} ${cl.white(`(${data.value.count})`)}\n` +
          `  ${cl.white('Candidates:')} ${cl.white(
            data.value.proposals
              .slice(0, 2)
              .map((p) =>
                typeof p === 'string'
                  ? `"${p.slice(0, 40)}..."`
                  : `${JSON.stringify(p).slice(0, 40)}...`
              )
              .join(', ')
          )}\n`;
        break;

      case 'BootstrappedDemos':
        formattedMessage =
          `${cl.cyan('● ')}${cl.whiteBright('Bootstrapped Demos')} ${cl.white(`(${data.value.count})`)}\n` +
          `  ${cl.white('Generated:')} ${cl.green(data.value.count.toString())} demonstration examples\n`;
        break;

      case 'BestConfigFound':
        formattedMessage =
          `${cl.green('● ')}${cl.whiteBright('Best Configuration Found')}\n` +
          `  ${cl.white('Score:')} ${cl.greenBright(data.value.score.toFixed(3))}\n` +
          `  ${cl.white('Config:')} ${cl.cyan(JSON.stringify(data.value.config).slice(0, 80))}${JSON.stringify(data.value.config).length > 80 ? '...' : ''}\n`;
        break;

      default:
        formattedMessage =
          `${cl.red('● ')}${cl.whiteBright('Unknown Event')}\n` +
          `  ${cl.white(JSON.stringify(data).slice(0, 100))}${JSON.stringify(data).length > 100 ? '...' : ''}\n`;
    }

    output(formattedMessage);
  };
};

/**
 * Factory function to create a text-only optimizer logger (no colors)
 */
export const axCreateDefaultOptimizerTextLogger = (
  output: (message: string) => void = defaultOutput
): AxOptimizerLoggerFunction => {
  const divider = '─'.repeat(60);

  return (data: AxOptimizerLoggerData) => {
    let formattedMessage = '';

    switch (data.name) {
      case 'OptimizationStart':
        formattedMessage =
          `[ OPTIMIZATION START: ${data.value.optimizerType} ]
${divider}
` +
          `Config: ${JSON.stringify(data.value.config, null, 2)}
` +
          `Examples: ${data.value.exampleCount}, Validation: ${data.value.validationCount}
` +
          `${divider}`;
        break;
      case 'RoundProgress':
        formattedMessage =
          `[ ROUND ${data.value.round}/${data.value.totalRounds} ]
` +
          `Current Score: ${data.value.currentScore.toFixed(3)}, Best: ${data.value.bestScore.toFixed(3)}
` +
          `Config: ${JSON.stringify(data.value.configuration)}
` +
          `${divider}`;
        break;
      case 'EarlyStopping':
        formattedMessage =
          `[ EARLY STOPPING at Round ${data.value.round} ]
` +
          `Reason: ${data.value.reason}
` +
          `Final Score: ${data.value.finalScore.toFixed(3)}
` +
          `${divider}`;
        break;
      case 'OptimizationComplete':
        formattedMessage =
          `[ OPTIMIZATION COMPLETE ]
${divider}
` +
          `Best Score: ${data.value.bestScore.toFixed(3)}
` +
          `Best Config: ${JSON.stringify(data.value.bestConfiguration)}
` +
          `Stats: ${JSON.stringify(data.value.stats, null, 2)}
` +
          `${divider}`;
        break;
      case 'ConfigurationProposal':
        formattedMessage =
          `[ CONFIG PROPOSAL: ${data.value.type} ]
` +
          `Count: ${data.value.count}
` +
          `Proposals: ${JSON.stringify(data.value.proposals.slice(0, 3), null, 2)} ${data.value.proposals.length > 3 ? '... (truncated)' : ''}
` +
          `${divider}`;
        break;
      case 'BootstrappedDemos':
        formattedMessage =
          `[ BOOTSTRAPPED DEMOS ]
` +
          `Count: ${data.value.count}
` +
          `Demos: ${JSON.stringify(data.value.demos.slice(0, 2), null, 2)} ${data.value.demos.length > 2 ? '... (truncated)' : ''}
` +
          `${divider}`;
        break;
      case 'BestConfigFound':
        formattedMessage =
          `[ BEST CONFIG FOUND ]
` +
          `Score: ${data.value.score.toFixed(3)}
` +
          `Config: ${JSON.stringify(data.value.config)}
` +
          `${divider}`;
        break;
      default:
        formattedMessage = `[ UNKNOWN OPTIMIZER EVENT ]
${JSON.stringify(data)}
${divider}`;
    }

    output(formattedMessage);
  };
};

/**
 * Default optimizer logger instance with color formatting
 */
export const axDefaultOptimizerLogger = axCreateDefaultOptimizerColorLogger();
