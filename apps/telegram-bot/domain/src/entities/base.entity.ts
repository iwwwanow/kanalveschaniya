export abstract class Entity<T> {
  constructor(public readonly id: T) {}

  equals(other: Entity<T>): boolean {
    return this.id === other.id;
  }
}
