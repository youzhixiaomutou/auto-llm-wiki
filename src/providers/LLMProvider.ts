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

export interface LLMProvider {
  complete(request: CompleteRequest): Promise<string>;
}
