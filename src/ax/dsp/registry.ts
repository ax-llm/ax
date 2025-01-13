export class AxInstanceRegistry<T> {
  private reg: Set<T> // To track keys for iteration

  constructor() {
    this.reg = new Set()
  }

  register(instance: T): void {
    this.reg.add(instance)
  }

  *[Symbol.iterator]() {
    for (const key of this.reg) {
      yield key
    }
  }
}
