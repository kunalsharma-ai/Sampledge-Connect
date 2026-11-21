/**
 * The AI engine seam. `BasicEngine` runs inside the API with no model; `ModelEngine` calls the
 * organization's own OpenAI-compatible model server. Feature code (AiService) only talks to
 * this interface, after it has checked what the caller may read.
 */

/** One message as the engine sees it. Already access-checked; text is user data, never instructions. */
export interface TranscriptLine {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  at: Date;
}

export interface Member {
  userId: string;
  name: string;
}

export interface RawActionItem {
  text: string;
  /** A member name as written; the service maps it to a userId. */
  assignee: string | null;
  due: string | null;
  messageId: string | null;
}

export interface SummaryResult {
  summary: string;
  highlights: string[];
  decisions: string[];
  actionItems: RawActionItem[];
  openQuestions: string[];
}

export interface SummarizeInput {
  title: string;
  agenda?: string;
  lines: TranscriptLine[];
  members: Member[];
}

export interface AiEngineImpl {
  readonly kind: 'basic' | 'model';
  /** Chat model name (model engine) or null. */
  readonly chatModel: string | null;
  /** Identifies the vector space; vectors from different ids are never compared. */
  readonly embeddingModelId: string;
  summarize(input: SummarizeInput): Promise<SummaryResult>;
  embed(texts: string[]): Promise<number[][]>;
  /** Answers from `sources` only. */
  answer(input: {
    question: string;
    history: { role: 'user' | 'assistant'; text: string }[];
    sources: (TranscriptLine & { where: string })[];
  }): Promise<string>;
  /** null when the engine cannot translate (basic). */
  translate(text: string, targetLanguage: string): Promise<string | null>;
  suggestReplies(input: {
    lines: TranscriptLine[];
    meId: string;
    meName: string;
  }): Promise<string[]>;
}

/** Thrown when the model server fails; the service falls back to the basic engine. */
export class ModelUnavailableError extends Error {}
