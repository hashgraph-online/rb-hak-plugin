import type {
  ChatConversationHandle,
  ConversationMode,
  SessionEncryptionSummary,
} from '@hashgraphonline/standards-sdk';

export interface StoredConversationHandle {
  handleId: string;
  sessionId: string;
  mode: ConversationMode;
  summary: SessionEncryptionSummary | null | undefined;
}

export class RegistryBrokerConversationStore {
  private readonly handles = new Map<string, ChatConversationHandle>();

  register(handle: ChatConversationHandle): StoredConversationHandle {
    const handleId = this.createHandleId();
    this.handles.set(handleId, handle);
    return {
      handleId,
      sessionId: handle.sessionId,
      mode: handle.mode,
      summary: handle.summary ?? null,
    };
  }

  get(handleId: string): ChatConversationHandle {
    const handle = this.handles.get(handleId);
    if (!handle) {
      throw new Error(`Conversation handle not found: ${handleId}`);
    }
    return handle;
  }

  release(handleId: string): boolean {
    return this.handles.delete(handleId);
  }

  private createHandleId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}
