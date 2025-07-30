import type { AxTunable, AxUsable } from './types.js';

type AxInstanceRegistryItem<T extends AxTunable<IN, OUT>, IN, OUT> = T &
  AxUsable;

export class AxInstanceRegistry<T extends AxTunable<IN, OUT>, IN, OUT> {
  private reg: Set<AxInstanceRegistryItem<T, IN, OUT>>; // To track keys for iteration

  constructor() {
    this.reg = new Set();
  }

  register(instance: AxInstanceRegistryItem<T, IN, OUT>): void {
    this.reg.add(instance);
  }

  *[Symbol.iterator]() {
    const items = Array.from(this.reg);
    for (let i = 0; i < items.length; i++) {
      yield items[i];
    }
  }
}
