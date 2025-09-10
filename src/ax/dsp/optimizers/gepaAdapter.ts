export interface AxGEPAEvaluationBatch<Traj = any, Out = any> {
  outputs: Out[];
  scores: number[];
  trajectories?: Traj[] | null;
}

export interface AxGEPAAdapter<Datum = any, Traj = any, Out = any> {
  evaluate(
    batch: readonly Datum[],
    candidate: Readonly<Record<string, string>>,
    captureTraces?: boolean
  ):
    | Promise<AxGEPAEvaluationBatch<Traj, Out>>
    | AxGEPAEvaluationBatch<Traj, Out>;

  make_reflective_dataset(
    candidate: Readonly<Record<string, string>>,
    evalBatch: Readonly<AxGEPAEvaluationBatch<Traj, Out>>,
    componentsToUpdate: readonly string[]
  ): Record<string, any[]>;

  propose_new_texts?: (
    candidate: Readonly<Record<string, string>>,
    reflectiveDataset: Readonly<Record<string, any[]>>,
    componentsToUpdate: readonly string[]
  ) => Promise<Record<string, string>> | Record<string, string>;
}
