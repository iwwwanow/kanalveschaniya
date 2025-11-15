// TODO refactor
export class ResourceId {
  constructor(private readonly value: string) {
    if (!this.isValid(value)) {
      throw new Error('Invalid ResourceId');
    }
  }

  private isValid(value: string): boolean {
    // TODO check resource id
    return /^[a-zA-Z0-9_-]{8,}$/.test(value);
  }

  toString(): string { return this.value; }
  equals(other: ResourceId): boolean { return this.value === other.value; }
}

export class ResourceSourceUrl {
  constructor(private readonly value: string) {
    if (!this.isValid(value)) {
      throw new Error('Invalid ResourceSourceUrl');
    }
  }

  private isValid(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  toString(): string { return this.value; }
  equals(other: ResourceSourceUrl): boolean { return this.value === other.value; }
}

export class QueueTaskId {
  constructor(private readonly value: string) {
    if (!this.isValid(value)) {
      throw new Error('Invalid QueueTaskId');
    }
  }

  private isValid(value: string): boolean {
    // TODO check task id
    return /^[a-zA-Z0-9_-]{8,}$/.test(value);
  }

  toString(): string { return this.value; }
  equals(other: QueueTaskId): boolean { return this.value === other.value; }
}

export class QueueTaskPriority {
  constructor(private readonly value: number) {
    if (!this.isValid(value)) {
      throw new Error('Invalid QueueTaskPriority');
    }
  }

  private isValid(value: number): boolean {
    return this.isValidType(value) && this.isValidRange(value);
  }

  private isValidType(value: number): boolean {
    return typeof value === 'number' && !isNaN(value);
  }

  private isValidRange(value: number): boolean {
    // TODO constants
    return value >= -1 && value <= 10;
  }

  toString(): string { return this.value.toString(); }

  getValue(): number { return this.value }

  equals(other: QueueTaskPriority): boolean { return this.value === other.value; }
}

// TODO destructure
export enum TaskStatus {
  Pending = 'pending',
  Processing = 'processing',
  Downloaded = 'downloaded',
  Error = 'error',
}

export class QueueTaskStatus {
  constructor(private value: TaskStatus) {
    if (!this.isValid(value)) {
      throw new Error('Invalid QueueTaskStatus');
    }
  }

  private isValid(value: TaskStatus): boolean {
    return Object.values(TaskStatus).includes(value);
  }

  toString(): string { return this.value; }
  getValue(): TaskStatus { return this.value }
  setValue(value: TaskStatus): void { this.value = value }
  equals(other: QueueTaskStatus): boolean { return this.value === other.value; }
}

export class TelegramChatId {
  // TODO is valid
  constructor(private readonly value: string) { }
  toString(): string { return this.value; }
  equals(other: TelegramChatId): boolean { return this.value === other.value; }
}

export class TelegramMessageId {
  // TODO is valid
  constructor(private readonly value: string) { }
  toString(): string { return this.value; }
  equals(other: TelegramMessageId): boolean { return this.value === other.value; }
}
