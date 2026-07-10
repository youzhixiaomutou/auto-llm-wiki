export interface CompleteRequest {
  apiKey: string;
  apiUrl?: string;
  model: string;
  prompt: string;
}

export interface VisionCompleteRequest {
  apiKey: string;
  apiUrl?: string;
  model: string;
  prompt: string;
  imageDataUrl: string;
}

export interface ConnectionTestRequest {
  apiKey: string;
  apiUrl?: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  apiKey: string;
  apiUrl?: string;
  model: string;
  messages: ChatMessage[];
  onToken?: (token: string) => void;
}

export interface LLMProvider {
  readonly providerType: string;
  complete(request: CompleteRequest): Promise<string>;
  completeVision(request: VisionCompleteRequest): Promise<string>;
  chat(request: ChatRequest): Promise<string>;
  testConnection(request: ConnectionTestRequest): Promise<void>;
}
