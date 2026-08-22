/** bge wants an instruction prefix on queries and none on passages. */
export type EmbedKind = 'query' | 'passage';

export interface Embedder {
  readonly id: string;
  readonly dim: number;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

let instance: Embedder | null = null;
let loading: Promise<Embedder> | null = null;

export async function getEmbedder(): Promise<Embedder> {
  if (instance) return instance;
  // Concurrent callers during boot must share one model load, not race three.
  loading ??= import('./local.js').then(async m => {
    instance = await m.createLocalEmbedder();
    return instance;
  });
  return loading;
}

export function embedderReady(): boolean {
  return instance !== null;
}

export async function embedOne(text: string, kind: EmbedKind): Promise<number[]> {
  const embedder = await getEmbedder();
  const [vector] = await embedder.embed([text], kind);
  if (!vector) throw new Error(`${embedder.id} returned no embedding`);
  return vector;
}

/** Load and run the model once at boot so the first real recall is not a 3–5 s wait. */
export async function warmEmbedder(): Promise<void> {
  const embedder = await getEmbedder();
  await embedder.embed(['warmup'], 'query');
}
