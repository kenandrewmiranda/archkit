// Chat domain — pure functions, no I/O
export interface Message {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  timestamp: number;
}

export interface ChatState {
  messages: Message[];
  participants: Set<string>;
}

export function addMessage(state: ChatState, msg: Message): ChatState {
  return {
    ...state,
    messages: [...state.messages, msg],
  };
}

export function validateMessage(content: string): { valid: boolean; error?: string } {
  if (!content || content.trim().length === 0) return { valid: false, error: "Empty message" };
  if (content.length > 5000) return { valid: false, error: "Message exceeds 5000 chars" };
  return { valid: true };
}
