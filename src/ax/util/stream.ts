import {
  type Transformer,
  TransformStream,
  type TransformStreamDefaultController,
} from 'stream/web'

export interface TextDecoderCommon {
  readonly encoding: string
  readonly fatal: boolean
  readonly ignoreBOM: boolean
}

class TextDecodeTransformer
  implements Transformer<ArrayBuffer | Uint8Array, string>
{
  private decoder

  constructor() {
    this.decoder = new TextDecoder()
  }

  transform(
    chunk: ArrayBuffer | Uint8Array,
    controller: TransformStreamDefaultController<string>
  ) {
    if (!(chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk))) {
      throw new TypeError('Input data must be a BufferSource')
    }
    const text = this.decoder.decode(chunk, { stream: true })
    if (text.length !== 0) {
      controller.enqueue(text)
    }
  }

  flush(controller: TransformStreamDefaultController<string>) {
    const text = this.decoder.decode()
    if (text.length !== 0) {
      controller.enqueue(text)
    }
  }
}

export class TextDecoderStreamPolyfill extends TransformStream<
  ArrayBuffer | Uint8Array,
  string
> {
  constructor() {
    super(new TextDecodeTransformer())
  }
}
