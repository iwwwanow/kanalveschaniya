export class MessageResponse {
  constructor(public readonly text: string) { }
}

export class HandleMessageUseCase {
  execute(): MessageResponse {
    // TODO locales
    const messageResponse = `message-response`;
    return new MessageResponse(messageResponse);
  }
}
