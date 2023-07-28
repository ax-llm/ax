import chalk from 'chalk';

import {
  AIGenerateTextTrace,
  FunctionExec,
  GenerateTextModelConfig,
  TextModelInfo,
} from '../text/types';

export class ConsoleLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private print(message: string, value: any, indent = 0): void {
    const prefix = ' '.repeat(indent * 2);
    console.log(
      `${prefix}${chalk.underline(message)}: ${
        value !== undefined ? chalk.bold(value) : chalk.gray('<not-set>')
      }`
    );
  }

  private printModelInfo(info: Readonly<TextModelInfo | undefined>): void {
    if (!info) return;

    console.log(chalk.green(`\n📘 Model Info:`));
    this.print('ID', info.id, 1);
    this.print('Currency', info.currency, 1);
    this.print('Character Is Token', info.characterIsToken, 1);
    this.print('Prompt Token Cost Per 1K', info.promptTokenCostPer1K, 1);
    this.print(
      'Completion Token Cost Per 1K',
      info.completionTokenCostPer1K,
      1
    );
    this.print('Max Tokens', info.maxTokens, 1);
    this.print('One TPM', info.oneTPM, 1);
  }

  private printModelConfig(
    config: Readonly<GenerateTextModelConfig | undefined>
  ): void {
    if (!config) return;

    console.log(chalk.yellow(`\n🛠️  Model Config:`));
    Object.entries(config).forEach(([key, value]) => {
      this.print(key, value, 1);
    });
  }

  private printFunctionExec(
    functionExecs: Readonly<FunctionExec[] | undefined>
  ): void {
    if (!functionExecs) return;

    console.log(chalk.blue(`\n🚀 Function Executions:`));
    functionExecs.forEach((func, i) => {
      this.print(`Function ${i + 1}`, func.name, 1);
      this.print('Arguments', JSON.stringify(func.args), 1);
      this.print('Result', func.result, 1);
      this.print('Result Value', JSON.stringify(func.resultValue), 1);
      this.print('Reasoning', func.reasoning?.join(', '), 1);
      if (func.parsingError) {
        this.print('Parsing Error', func.parsingError.error, 1);
        this.print('Data', func.parsingError.data, 1);
      }
    });
  }

  public log(traces: readonly AIGenerateTextTrace[]): void {
    traces.forEach((trace, i) => {
      console.log(chalk.bold.cyan(`\n🔎 Trace ${i + 1}\n` + '_'.repeat(100)));
      this.print('Trace ID', trace.traceID, 1);
      this.print('Session ID', trace.sessionID, 1);

      this.printModelInfo(trace.request.modelInfo);
      this.printModelConfig(trace.request.modelConfig);

      if (trace.response) {
        console.log(chalk.magenta(`\n📝 Response:`));
        this.print('Model Response Time', trace.response.modelResponseTime, 1);
        this.print(
          'Embed Model Response Time',
          trace.response.embedModelResponseTime,
          1
        );
        this.printFunctionExec(trace.response.functions);
        if (trace.response.parsingError) {
          this.print('Parsing Error', trace.response.parsingError.error, 1);
          this.print('Data', trace.response.parsingError.data, 1);
        }
        if (trace.response.apiError) {
          console.log(chalk.red(`\n❌ API Error:`));
          this.print('Name', trace.response.apiError.name, 1);
          this.print('Message', trace.response.apiError.message, 1);
          this.print('Stack', trace.response.apiError.stack, 1);
        }
      }
    });
  }
}
