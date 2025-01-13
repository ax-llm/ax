export class ColorLog {
  // ANSI escape codes for different colors
  private readonly ANSI_WHITE_BRIGHT = '\x1b[97m'
  private readonly ANSI_GREEN_BRIGHT = '\x1b[92m'
  private readonly ANSI_BLUE_BRIGHT = '\x1b[94m'
  private readonly ANSI_YELLOW = '\x1b[93m'
  private readonly ANSI_RED = '\x1b[91m'
  private readonly ANSI_RESET = '\x1b[0m'

  // Method to wrap text with the specified ANSI color code
  private colorize(text: string, colorCode: string): string {
    return `${colorCode}${text}${this.ANSI_RESET}`
  }

  // Public methods to colorize text in various colors
  public whiteBright(text: string): string {
    return this.colorize(text, this.ANSI_WHITE_BRIGHT)
  }

  public greenBright(text: string): string {
    return this.colorize(text, this.ANSI_GREEN_BRIGHT)
  }

  public blueBright(text: string): string {
    return this.colorize(text, this.ANSI_BLUE_BRIGHT)
  }

  public yellow(text: string): string {
    return this.colorize(text, this.ANSI_YELLOW)
  }

  public red(text: string): string {
    return this.colorize(text, this.ANSI_RED)
  }
}
