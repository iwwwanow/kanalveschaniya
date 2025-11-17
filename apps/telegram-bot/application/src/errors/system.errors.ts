export class DatabaseConnectionError extends Error {
  constructor(message: string) {
    super(`Database error: ${message}`);
    this.name = 'DatabaseConnectionError';
  }
}

export class FileSystemError extends Error {
  constructor(message: string) {
    super(`File system error: ${message}`);
    this.name = 'FileSystemError';
  }
}
