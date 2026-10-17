import { DefaultAzureCredential } from '@azure/identity';

export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly modelId: string;
  embed(texts: string[]): Promise<number[][]>;
}

const DIMENSIONS = 1536;

/** Azure is the first adapter. Other deployments implement this same contract. */
export class AzureEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMENSIONS;
  readonly modelId: string;
  private readonly endpoint: string;
  private readonly credential = new DefaultAzureCredential();

  constructor() {
    const endpoint = process.env['AI_EMBEDDING_ENDPOINT'];
    const modelId = process.env['AI_EMBEDDING_DEPLOYMENT'];
    if (!endpoint || !modelId) {
      throw new Error('AI_EMBEDDING_NOT_CONFIGURED');
    }
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search) {
      throw new Error('AI_EMBEDDING_ENDPOINT_INVALID');
    }
    this.endpoint = `${parsed.origin}/openai/v1/embeddings`;
    this.modelId = modelId;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (
      texts.length < 1 ||
      texts.length > 16 ||
      texts.some((text) => !text || text.length > 6000)
    ) {
      throw new Error('AI_EMBEDDING_INPUT_INVALID');
    }
    const token = await this.credential.getToken('https://cognitiveservices.azure.com/.default');
    if (!token) {
      throw new Error('AI_EMBEDDING_AUTH_UNAVAILABLE');
    }
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.modelId, input: texts, dimensions: DIMENSIONS }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`AI_EMBEDDING_HTTP_${response.status}`);
    }
    const data: unknown = await response.json();
    if (!isEmbeddingResponse(data, texts.length)) {
      throw new Error('AI_EMBEDDING_RESPONSE_INVALID');
    }
    return data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}

function isEmbeddingResponse(
  value: unknown,
  count: number
): value is {
  data: Array<{ index: number; embedding: number[] }>;
} {
  if (!value || typeof value !== 'object' || !('data' in value) || !Array.isArray(value.data)) {
    return false;
  }
  if (value.data.length !== count) {
    return false;
  }
  const indexes = new Set<number>();
  for (const item of value.data) {
    if (
      !item ||
      typeof item !== 'object' ||
      !Number.isInteger(item.index) ||
      indexes.has(item.index)
    ) {
      return false;
    }
    indexes.add(item.index);
    if (
      !Array.isArray(item.embedding) ||
      item.embedding.length !== DIMENSIONS ||
      item.embedding.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n))
    ) {
      return false;
    }
  }
  return [...indexes].every((index) => index >= 0 && index < count);
}
