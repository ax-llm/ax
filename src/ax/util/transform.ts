import {
  type Transformer,
  TransformStream,
  type TransformStreamDefaultController,
} from 'stream/web'

class TypeTransformer<I, O> implements Transformer<I, O> {
  private buffer?: O[]
  private doneCallback?: (args0: readonly O[]) => Promise<void>
  private transformFn: (arg0: I) => O

  constructor(
    transformFn: (arg0: I) => O,
    doneCallback?: (args0: readonly O[]) => Promise<void>
  ) {
    this.transformFn = transformFn
    this.doneCallback = doneCallback
    this.buffer = doneCallback ? [] : undefined
  }

  async transform(obj: I, controller: TransformStreamDefaultController<O>) {
    const val = this.transformFn(obj)
    if (val) {
      controller.enqueue(val)
      this.buffer?.push(val)
    }
  }

  async flush(controller: TransformStreamDefaultController<O>) {
    await this.doneCallback?.(this.buffer ?? [])
    controller.terminate()
  }
}

export class RespTransformStream<I, O> extends TransformStream<I, O> {
  constructor(
    transformFn: (arg0: I) => O,
    doneCallback?: (args0: readonly O[]) => Promise<void>
  ) {
    super(new TypeTransformer<I, O>(transformFn, doneCallback))
  }
}
