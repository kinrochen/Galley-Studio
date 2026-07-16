export type GenerationStage =
  | "reading"
  | "loading-skill"
  | "generating"
  | "saving";

export type GenerationModelEvent =
  | {
      readonly type: "prompt";
      readonly text: string;
      readonly at: number;
    }
  | {
      readonly type: "request-start";
      readonly requestId: number;
      readonly at: number;
    }
  | {
      readonly type: "text-delta";
      readonly requestId: number;
      readonly text: string;
      readonly at: number;
    }
  | {
      readonly type: "request-complete";
      readonly requestId: number;
      readonly elapsedMs: number;
      readonly at: number;
    };
