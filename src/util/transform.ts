import {
  type Transformer,
  TransformStream,
  type TransformStreamDefaultController
} from 'stream/web';

class JSONTransformer<O> implements Transformer<string, O> {
  async transform(
    obj: string,
    controller: TransformStreamDefaultController<O>
  ) {
    (obj.split('\n') ?? [])
      .map(extractJson)
      .map<O>((v) => {
        try {
          return v && v.length > 0 ? JSON.parse(v as string) : null;
        } catch (e: unknown) {
          return null;
        }
      })
      .filter((v) => v)
      .forEach((v) => v && controller.enqueue(v));
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export class JSONStringifyStream<O> extends TransformStream<string, O> {
  constructor() {
    super(new JSONTransformer<O>());
  }
}

class TypeTransformer<I, O> implements Transformer<I, O> {
  private buffer?: O[];
  private doneCallback?: (args0: readonly O[]) => Promise<void>;
  private transformFn: (arg0: I) => O;

  constructor(
    transformFn: (arg0: I) => O,
    doneCallback?: (args0: readonly O[]) => Promise<void>
  ) {
    this.transformFn = transformFn;
    this.doneCallback = doneCallback;
    this.buffer = doneCallback ? [] : undefined;
  }

  async transform(obj: I, controller: TransformStreamDefaultController<O>) {
    const val = this.transformFn(obj);
    if (val) {
      controller.enqueue(val);
      this.buffer?.push(val);
    }
  }

  async flush(controller: TransformStreamDefaultController<O>) {
    await this.doneCallback?.(this.buffer ?? []);
    controller.terminate();
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export class RespTransformStream<I, O> extends TransformStream<I, O> {
  constructor(
    transformFn: (arg0: I) => O,
    doneCallback?: (args0: readonly O[]) => Promise<void>
  ) {
    super(new TypeTransformer<I, O>(transformFn, doneCallback));
  }
}

const extractJson = (str: string): string | null => {
  const startIndex = str.indexOf('{');
  const endIndex = str.lastIndexOf('}');

  if (startIndex !== -1 && endIndex !== -1) {
    return str.substring(startIndex, endIndex + 1);
  }

  return null;
};
