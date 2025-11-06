export class StartCommandResponse {
  constructor(public readonly text: string) { }
}

export class HandleStartCommandUseCase {
  execute(): StartCommandResponse {
    // TODO locales
    const startCommandResponse = `start-command-response`;
    return new StartCommandResponse(startCommandResponse);
  }
}

