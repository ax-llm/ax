export class ColorLog {
  // ANSI escape codes for different colors
  private readonly ANSI_WHITE_BRIGHT = '\x1b[97m';
  private readonly ANSI_GREEN_BRIGHT = '\x1b[92m';
  private readonly ANSI_BLUE_BRIGHT = '\x1b[94m';
  private readonly ANSI_RED_BRIGHT = '\x1b[91m';

  private readonly ANSI_YELLOW = '\x1b[93m';
  private readonly ANSI_RED = '\x1b[91m';
  private readonly ANSI_RESET = '\x1b[0m';
  private readonly ANSI_ORANGE = '\x1b[38;5;208m';
  private readonly ANSI_WHITE = '\x1b[37m';
  private readonly ANSI_CYAN_BRIGHT = '\x1b[96m';
  private readonly ANSI_MAGENTA_BRIGHT = '\x1b[95m';
  private readonly ANSI_GRAY = '\x1b[90m';

  private readonly ANSI_GREEN = '\x1b[32m';
  private readonly ANSI_CYAN = '\x1b[36m';
  private readonly ANSI_MAGENTA = '\x1b[35m';
  private readonly ANSI_BLUE = '\x1b[34m';
  private readonly ANSI_YELLOW_DIM = '\x1b[33m';

  // Method to wrap text with the specified ANSI color code
  private colorize(text: string, colorCode: string): string {
    return `${colorCode}${text}${this.ANSI_RESET}`;
  }

  // Public methods to colorize text in various colors
  public whiteBright(text: string): string {
    return this.colorize(text, this.ANSI_WHITE_BRIGHT);
  }

  public greenBright(text: string): string {
    return this.colorize(text, this.ANSI_GREEN_BRIGHT);
  }

  public blueBright(text: string): string {
    return this.colorize(text, this.ANSI_BLUE_BRIGHT);
  }

  public redBright(text: string): string {
    return this.colorize(text, this.ANSI_RED_BRIGHT);
  }

  public white(text: string): string {
    return this.colorize(text, this.ANSI_WHITE);
  }

  public yellow(text: string): string {
    return this.colorize(text, this.ANSI_YELLOW);
  }

  public red(text: string): string {
    return this.colorize(text, this.ANSI_RED);
  }

  public orange(text: string): string {
    return this.colorize(text, this.ANSI_ORANGE);
  }

  public cyanBright(text: string): string {
    return this.colorize(text, this.ANSI_CYAN_BRIGHT);
  }

  public magentaBright(text: string): string {
    return this.colorize(text, this.ANSI_MAGENTA_BRIGHT);
  }

  public gray(text: string): string {
    return this.colorize(text, this.ANSI_GRAY);
  }

  public green(text: string): string {
    return this.colorize(text, this.ANSI_GREEN);
  }

  public cyan(text: string): string {
    return this.colorize(text, this.ANSI_CYAN);
  }

  public magenta(text: string): string {
    return this.colorize(text, this.ANSI_MAGENTA);
  }

  public blue(text: string): string {
    return this.colorize(text, this.ANSI_BLUE);
  }

  public yellowDim(text: string): string {
    return this.colorize(text, this.ANSI_YELLOW_DIM);
  }
}
