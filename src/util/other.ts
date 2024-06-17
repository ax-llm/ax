// eslint-disable-next-line @typescript-eslint/naming-convention
export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
